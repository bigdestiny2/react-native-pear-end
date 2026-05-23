// PearEnd — main class. Wraps Worklet.start + BareKit.IPC.
//
// STATUS: SKELETON. Implementation lands when the reference integration's
// MobilePearEnd.js / worklet-rpc.mjs source arrives via the handover. The
// signatures here are intentionally stable so consumer code can be
// written against them now.
//
// What's encoded already:
//   - TextEncoder-on-Android handling (in start())
//   - Lifecycle wiring intent (in suspend/teardown signatures)
//   - Typed RPC contract (in PearEndHandle)
//
// What awaits the handover:
//   - The actual IPC framing (sync RPC over BareKit.IPC)
//   - The boot-stage event names + sequencing
//   - The teardown order (close swarm → drain corestore → close drives)
//   - Concrete crash detection

import type {
  PearEndOptions,
  PearEndHandle,
  WorkletBundle
} from './types.js'

/**
 * Static entry point. Creates a worklet, starts it, awaits `'ready'`,
 * returns a typed handle for RPC + events + lifecycle.
 *
 * @example
 * ```ts
 * const pear = await PearEnd.start({
 *   bundle: require('./worklet-bundle'),
 *   storage: RNFS.DocumentDirectoryPath
 * })
 *
 * const result = await pear.rpc.call('vault:unlock', { passphrase })
 * for await (const ev of pear.events('note-added')) {
 *   updateUI(ev)
 * }
 * ```
 */
export class PearEnd {
  /**
   * Start a worklet and return a handle.
   *
   * The handle resolves when the worklet emits `'ready'`. If the worklet
   * crashes during boot, the returned Promise rejects with the error.
   */
  static async start (_opts: PearEndOptions): Promise<PearEndHandle> {
    // TODO(handover): implement against MobilePearEnd.js reference.
    //
    // Sketch:
    //   const { Worklet } = require('react-native-bare-kit')
    //   const w = new Worklet()
    //   // 1. Encode bundle bytes (CRITICAL — Android silently no-ops on string)
    //   const source = encodeBundle(opts.bundle)
    //   w.start('/app.bundle', source)
    //   // 2. Construct IPC RPC SYNC (async handshake hangs on RN)
    //   const rpc = new SyncRpc(w.IPC, opts.defaultTimeoutMs)
    //   // 3. Register lifecycle hooks (AppState → suspend/teardown)
    //   const lifecycle = wireLifecycle(w, opts)
    //   // 4. Wait for 'ready' event, capture boot-stage trail for crash recovery
    //   await waitForReady(w, opts.onCrash)
    //   // 5. Return handle
    //   return new PearEndHandleImpl(w, rpc, lifecycle)
    throw new Error(
      'PearEnd.start: SKELETON — awaiting reference integration handover. ' +
      'See ARCHITECTURE.md and TROUBLESHOOTING.md for the design contract.'
    )
  }
}

/**
 * Encode a worklet bundle into the bytes shape that Worklet.start requires.
 *
 * On Android, Worklet.start silently no-ops if given a string — it requires
 * Uint8Array. iOS accepts both. We always normalize to bytes for safety.
 *
 * Internal — exported only for testing. Consumers should not call this.
 */
export function encodeBundle (bundle: WorkletBundle): Uint8Array {
  if (bundle.source instanceof Uint8Array) return bundle.source
  return new TextEncoder().encode(String(bundle.source))
}
