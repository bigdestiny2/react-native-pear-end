// Consumer-facing worklet helper. Importable from your worklet
// entrypoint to declaratively register RPC commands + event channels.
//
// STATUS: SKELETON. Real RPC wiring lands when the reference handover
// arrives. The defineWorklet() shape is the stable contract — consumer
// worklet code can be written against it now.
//
// Usage in a Bare worklet (compiled by `pear-end-pack`):
//
//   import { defineWorklet } from 'react-native-pear-end/worklet'
//   import Hypercore from 'hypercore'
//
//   defineWorklet({
//     commands: {
//       'vault:unlock': async ({ passphrase }) => {
//         const key = await argon2id(passphrase, salt, {
//           memlimit: 64 * 1024 * 1024, // ARGON2_MEMLIMIT_MOBILE
//           opslimit: 3
//         })
//         return { ok: true }
//       },
//       'note:add': async ({ text }) => {
//         await core.append(text)
//         emit('note-added', { text, at: Date.now() })
//         return { ok: true }
//       }
//     },
//     events: ['note-added', 'sync-progress', 'peer-connected'],
//     boot: async ({ stage }) => {
//       // Optional: called with stage events during init. Allows logging
//       // which subsystem is starting if you want it.
//     },
//     suspend: async () => {
//       // Optional: called on AppState → background. Default = no-op.
//     },
//     teardown: async () => {
//       // Optional: called on Bare.on('teardown'). Close subsystems here.
//     }
//   })

/**
 * Declarative worklet definition. Call exactly once at the top of your
 * worklet entrypoint. The framework wires up RPC + events + lifecycle.
 *
 * @param {object} def
 * @param {Object<string, Function>} def.commands -
 *   Map of command name → async handler. Handler receives params from
 *   the RN call, returns the result. Throw to surface an RPC error
 *   on the RN side.
 * @param {string[]} [def.events] -
 *   Array of channel names the worklet may emit to. Pre-declaring
 *   helps the framework validate emits and helps RN-side codegen.
 * @param {(stage: { stage: string, message?: string }) => Promise<void>} [def.boot] -
 *   Optional hook called with boot stage events. Useful for logging.
 * @param {() => Promise<void>} [def.suspend] -
 *   Optional hook called on AppState → background.
 * @param {() => Promise<void>} [def.teardown] -
 *   Optional hook called on Bare.on('teardown'). Place subsystem
 *   shutdown here (close swarms, drain corestore, etc).
 */
export function defineWorklet (def) {
  // TODO(handover): implement against worklet-rpc.mjs reference.
  //
  // Sketch:
  //   1. Construct RPC SYNC (BareKit.IPC bytes channel)
  //   2. Register def.commands as RPC handlers (gate on bootErr/ready state)
  //   3. Provide global `emit(channel, payload)` for command handlers
  //   4. Run boot() with stage events: 'init', 'corestore-opened',
  //      'swarm-joined', etc. Capture lastBootStage for crash recovery.
  //   5. Wire Bare.on('suspend') → def.suspend
  //   6. Wire Bare.on('teardown') → def.teardown → process.exit(0)
  //
  throw new Error(
    'defineWorklet: SKELETON — awaiting reference integration handover. ' +
    'See ARCHITECTURE.md for the design contract.'
  )
}

/**
 * Emit an event to the RN side. Available globally inside command
 * handlers (the framework sets it up). Re-exported here for clarity.
 *
 * @param {string} channel - channel name declared in defineWorklet({ events })
 * @param {any} payload - JSON-serializable payload
 */
export function emit (channel, payload) {
  // TODO(handover): implement against worklet-rpc.mjs.
  throw new Error('emit: SKELETON — awaiting reference integration handover.')
}
