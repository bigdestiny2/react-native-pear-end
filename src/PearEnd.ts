// PearEnd — main entry point. Wraps `new Worklet()` + Worklet.start + the
// BareKit.IPC RPC, and resolves once the worklet emits its ready signal.
//
// Ported from two production Pear-on-React-Native apps (PearBrowser and
// PearPaste) — the boot flow + app/lib RPC. The pieces that matter and are
// reproduced exactly:
//
//   - The bundle is passed as BYTES on both platforms. A string silently
//     no-ops over Android's JNI, and the iOS string path empirically also
//     fails to run the worklet (start() resolves but the worklet JS never
//     executes); bytes are the only reliable path. See TROUBLESHOOTING.md.
//   - A ready event gates start(); a boot-error or a timeout rejects it.
//   - `react-native-bare-kit` is loaded through the RN/Metro `require` at call
//     time, so this module imports cleanly under plain Node (tests) and only
//     touches native code when you actually call start() on a device.

import type { PearEndOptions, PearEndHandle, WorkletBundle } from './types.js'
import { PearEndRpc } from './ipc.js'
import { DEFAULT_RPC_TIMEOUT_MS } from './constants.js'

// Reserved channels — MUST match worklet/index.mjs on the worklet side.
const CH_READY = 'pear-end/ready'
const CH_ERROR = 'pear-end/error'
const CH_BOOT = 'pear-end/boot'
const CMD_TEARDOWN = 'pear-end/teardown'

const DEFAULT_READY_TIMEOUT_MS = 30_000

/**
 * Static entry point. Creates a worklet, starts it with your packed bundle,
 * waits for `ready`, and returns a typed handle for RPC + events + lifecycle.
 *
 * @example
 * ```ts
 * const pear = await PearEnd.start({
 *   bundle: require('./worklet-bundle'), // produced by `pear-end-pack`
 *   storage: Paths.document.uri.replace('file://', '') + '/myapp'
 * })
 *
 * const result = await pear.rpc.call('vault:unlock', { passphrase })
 * for await (const ev of pear.events('note-added')) updateUI(ev)
 * ```
 */
export class PearEnd {
  static async start (opts: PearEndOptions): Promise<PearEndHandle> {
    const bareKit = requireNative('react-native-bare-kit')
    const Worklet = bareKit && bareKit.Worklet
    if (typeof Worklet !== 'function') {
      throw new Error(
        'react-native-pear-end: react-native-bare-kit is not available. Install it ' +
        'as a dependency and rebuild the native app (PearEnd.start runs only on device).'
      )
    }

    const worklet = new Worklet()
    const rpc = new PearEndRpc(worklet.IPC)

    let lastBootStage: string | undefined
    rpc.onEvent(CH_BOOT, (d: any) => { if (d && d.stage) lastBootStage = d.stage })
    rpc.onEvent(CH_ERROR, (d: any) => {
      if (opts.onCrash) {
        opts.onCrash({
          error: toError(d && d.message, d && d.stack),
          lastBootStage: (d && d.lastBootStage) || lastBootStage
        })
      }
    })

    // Pass the bundle as bytes on BOTH platforms. The string path silently
    // no-ops on Android (JNI) and empirically fails to run the worklet on iOS
    // too; bytes are the only path proven to boot on both (PearBrowser/
    // PearPaste). Verified on the iOS Simulator: string → worklet never runs;
    // bytes → full boot.
    const source: Uint8Array = encodeBundle(opts.bundle)

    try {
      worklet.start('/app.bundle', source, [opts.storage])
    } catch (err: any) {
      rpc.close()
      throw new Error(`react-native-pear-end: Worklet.start failed: ${err && err.message ? err.message : err}`)
    }

    await waitForReady(rpc, opts, () => lastBootStage)
    return createHandle(worklet, rpc, opts)
  }
}

/**
 * Encode a worklet bundle into the bytes shape Worklet.start requires. Both
 * platforms need bytes (the string path no-ops on Android and fails to run the
 * worklet on iOS), so this is always the right call. Internal; exported for
 * testing.
 */
export function encodeBundle (bundle: WorkletBundle): Uint8Array {
  if (bundle.source instanceof Uint8Array) return bundle.source
  return new TextEncoder().encode(String(bundle.source))
}

// --- internals ---

function waitForReady (
  rpc: PearEndRpc,
  opts: PearEndOptions,
  getStage: () => string | undefined
): Promise<void> {
  const timeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const cleanup = () => { clearTimeout(timer); offReady(); offError() }

    const offReady = rpc.onEvent(CH_READY, () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    })

    const offError = rpc.onEvent(CH_ERROR, (d: any) => {
      if (settled || !d || d.type !== 'boot-error') return
      settled = true
      cleanup()
      reject(toError(d.message, d.stack))
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      const stage = getStage()
      reject(new Error(
        `react-native-pear-end: worklet did not become ready within ${timeoutMs}ms` +
        (stage ? ` (last boot stage: ${stage})` : '')
      ))
    }, timeoutMs)
  })
}

function createHandle (worklet: any, rpc: PearEndRpc, opts: PearEndOptions): PearEndHandle {
  const resolveTimeout = (command: string): number =>
    (opts.longRunningTimeouts && opts.longRunningTimeouts[command]) ??
    opts.defaultTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS

  return {
    rpc: {
      call<TParams = unknown, TResult = unknown> (command: string, params?: TParams): Promise<TResult> {
        return rpc.request(command, params ?? {}, resolveTimeout(command)) as Promise<TResult>
      }
    },

    events<TPayload = unknown> (channel: string): AsyncIterable<TPayload> {
      return makeEventIterable<TPayload>(rpc, channel)
    },

    async suspend (): Promise<void> {
      if (opts.lockOnBackground) {
        try { await rpc.request('lock', {}, resolveTimeout('lock')) } catch { /* best-effort */ }
      }
      try { if (typeof worklet.suspend === 'function') worklet.suspend() } catch { /* best-effort */ }
    },

    async teardown (): Promise<void> {
      // Let the worklet close its subsystems gracefully, then terminate.
      try { await rpc.request(CMD_TEARDOWN, {}, resolveTimeout(CMD_TEARDOWN)) } catch { /* best-effort */ }
      try { if (typeof worklet.terminate === 'function') worklet.terminate() } catch { /* best-effort */ }
      rpc.close()
    }
  }
}

function makeEventIterable<T> (rpc: PearEndRpc, channel: string): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator] (): AsyncIterator<T> {
      const queue: T[] = []
      const waiters: Array<(r: IteratorResult<T>) => void> = []
      let done = false

      const off = rpc.onEvent(channel, (data: T) => {
        const waiter = waiters.shift()
        if (waiter) waiter({ value: data, done: false })
        else queue.push(data)
      })

      const end = (): IteratorResult<T> => {
        if (!done) { done = true; off() }
        let w = waiters.shift()
        while (w) { w({ value: undefined as any, done: true }); w = waiters.shift() }
        return { value: undefined as any, done: true }
      }

      return {
        next (): Promise<IteratorResult<T>> {
          if (queue.length) return Promise.resolve({ value: queue.shift() as T, done: false })
          if (done) return Promise.resolve({ value: undefined as any, done: true })
          return new Promise((resolve) => waiters.push(resolve))
        },
        return (): Promise<IteratorResult<T>> {
          return Promise.resolve(end())
        }
      }
    }
  }
}

function toError (message?: string, stack?: string): Error {
  const e = new Error(message || 'worklet error')
  if (stack) e.stack = stack
  return e
}

/**
 * Load a native/RN module via the Metro (or Node CJS) `require` that exists at
 * call time. Authored as a literal `require` so Metro binds its module-local
 * resolver; never reached under the plain-Node test runtime.
 */
function requireNative (id: string): any {
  // @ts-ignore — `require` is provided by the React Native (Metro) runtime.
  return require(id)
}
