// Consumer-facing worklet helper. Import this from your Bare worklet
// entrypoint (the file you pass to `pear-end-pack`) to declaratively register
// RPC commands, event channels, and lifecycle hooks.
//
// This is the worklet half of react-native-pear-end. It is wired to the same
// mechanism the production PearBrowser backend uses (backend/index.js +
// backend/rpc.js): a length-prefixed JSON RPC over BareKit.IPC, a boot()
// sequence that emits stage progress then a `ready` signal, and lifecycle
// hooks driven by Bare.on('suspend' | 'resume') plus an RN-initiated teardown.
//
// Usage:
//
//   import { defineWorklet, emit } from 'react-native-pear-end/worklet'
//   import Hyperswarm from 'hyperswarm'
//   import Corestore from 'corestore'
//
//   let store, swarm
//
//   defineWorklet({
//     async boot ({ progress }) {
//       const storagePath = Bare.argv[0] || './storage'
//       progress('corestore', 'Opening storage…')
//       store = new Corestore(storagePath)
//       await store.ready()
//       progress('swarm', 'Joining the swarm…')
//       swarm = new Hyperswarm()
//       swarm.on('connection', (conn) => store.replicate(conn))
//       return { ok: true } // becomes the `ready` payload on the RN side
//     },
//     commands: {
//       'note:add': async ({ text }) => {
//         // ... append to a hypercore ...
//         emit('note-added', { text, at: Date.now() })
//         return { ok: true }
//       }
//     },
//     events: ['note-added'],
//     async teardown () {
//       if (swarm) await swarm.destroy()
//       if (store) await store.close()
//     }
//   })

import { WorkletRpc } from './worklet-rpc.mjs'

// Reserved channels — MUST match the constants in src/ipc.ts on the RN side.
// Consumer event names starting with `pear-end/` are reserved.
const CH_READY = 'pear-end/ready'
const CH_ERROR = 'pear-end/error'
const CH_BOOT = 'pear-end/boot'
const CMD_TEARDOWN = 'pear-end/teardown'

let _rpc = null
let _declaredEvents = new Set()
let _lastBootStage

/**
 * Emit an event to the React Native side. Available as an import and also
 * passed into command/boot handlers via their context object.
 *
 * @param {string} channel - a channel declared in defineWorklet({ events })
 * @param {any} payload - JSON-serialisable payload
 */
export function emit (channel, payload) {
  if (!_rpc) throw new Error('emit() called before defineWorklet()')
  if (
    _declaredEvents.size > 0 &&
    !_declaredEvents.has(channel) &&
    !channel.startsWith('pear-end/')
  ) {
    console.warn(`[pear-end] emit('${channel}'): channel not declared in defineWorklet({ events })`)
  }
  _rpc.event(channel, payload)
}

/**
 * Declarative worklet definition. Call exactly once at the top of your worklet
 * entrypoint. Wires up RPC + events + lifecycle and kicks off boot().
 *
 * @param {object} def
 * @param {Object<string, (params:any)=>Promise<any>>} [def.commands]
 *   Map of command name → async handler. The handler receives the params sent
 *   from `handle.rpc.call(name, params)` and returns the result. Throw to
 *   surface an error on the RN side (reconstructed as PearEndRpcError).
 * @param {string[]} [def.events]
 *   Channel names this worklet may emit to. Pre-declaring lets the helper warn
 *   on typos; it does not otherwise restrict emits.
 * @param {(ctx:{emit:typeof emit, progress:(stage:string,message?:string)=>void})=>Promise<any>} [def.boot]
 *   Async startup. Open your corestore/swarm/etc here. Call `progress(stage,
 *   message)` to drive the boot splash on the RN side and to record the last
 *   stage for crash diagnostics. The resolved value becomes the `ready`
 *   payload delivered to `PearEnd.start()`. If boot throws, the RN-side start
 *   promise rejects and `onCrash` fires with the last stage.
 * @param {()=>Promise<void>} [def.suspend]
 *   Optional. Runs after the runtime is told to idle (AppState → background).
 *   IPC is automatically unref'd first.
 * @param {()=>Promise<void>} [def.resume]
 *   Optional. Runs when the app returns to the foreground. IPC is re-ref'd
 *   first.
 * @param {()=>Promise<void>} [def.teardown]
 *   Optional. Runs when the RN side calls `handle.teardown()`. Close swarms,
 *   drain corestore, etc. After it resolves the RN side terminates the worklet.
 * @returns {WorkletRpc} the underlying RPC instance (escape hatch).
 */
export function defineWorklet (def) {
  if (_rpc) throw new Error('defineWorklet() called more than once')
  if (typeof BareKit === 'undefined' || typeof Bare === 'undefined') {
    throw new Error('defineWorklet() must run inside a Bare worklet (BareKit/Bare globals missing)')
  }

  const { IPC } = BareKit
  const rpc = new WorkletRpc(IPC)
  _rpc = rpc
  _declaredEvents = new Set(def.events || [])

  // Register consumer command handlers.
  for (const [name, fn] of Object.entries(def.commands || {})) {
    rpc.handle(name, fn)
  }

  // Built-in graceful teardown command. The RN side calls this before
  // terminating the worklet (mirrors PearBrowser's CMD_STOP → shutdown()).
  rpc.handle(CMD_TEARDOWN, async () => {
    if (def.teardown) await def.teardown()
    return { ok: true }
  })

  // Lifecycle — the proven mechanism from backend/index.js:
  //   suspend → IPC.unref() (lets the process idle while backgrounded)
  //   resume  → IPC.ref()
  Bare.on('suspend', () => {
    try { IPC.unref() } catch {}
    if (def.suspend) {
      Promise.resolve(def.suspend()).catch((e) => console.error('[pear-end] suspend hook threw:', e))
    }
  })
  Bare.on('resume', () => {
    try { IPC.ref() } catch {}
    if (def.resume) {
      Promise.resolve(def.resume()).catch((e) => console.error('[pear-end] resume hook threw:', e))
    }
  })

  // Boot. Emit stage progress, then a ready signal on success; on failure emit
  // an error event carrying the last stage (mirrors backend/index.js
  // boot().catch()).
  const ctx = {
    emit,
    progress (stage, message) {
      _lastBootStage = stage
      rpc.event(CH_BOOT, { stage, message })
    }
  }

  ;(async () => {
    let result
    try {
      result = def.boot ? await def.boot(ctx) : undefined
    } catch (err) {
      rpc.event(CH_BOOT, { stage: 'error', message: err.message })
      rpc.event(CH_ERROR, {
        type: 'boot-error',
        message: err.message,
        stack: err.stack,
        lastBootStage: _lastBootStage
      })
      return
    }
    rpc.event(CH_READY, result === undefined ? {} : result)
  })()

  return rpc
}
