// Public TypeScript surface for react-native-pear-end.
//
// These types describe the API a consumer sees. Implementation details
// (the IPC framing, the Worklet handle, the bundle bytes) are kept off
// this surface so the contract is stable across internal refactors.

/**
 * Options for `PearEnd.start()` — the main entrypoint.
 */
export interface PearEndOptions {
  /**
   * The Bare worklet bundle to load. Typically `require('./worklet-bundle')`
   * after running `pear-end-pack` against your worklet entrypoint, which
   * generates platform-specific `worklet.android.bundle.js` /
   * `worklet.ios.bundle.js` files plus a Metro shim that resolves them.
   */
  bundle: WorkletBundle

  /**
   * Absolute path to the directory where the worklet should persist
   * state (corestore, RocksDB, etc.). Typically
   * `RNFS.DocumentDirectoryPath` or similar.
   */
  storage: string

  /**
   * If true, RN's `AppState → background` transition triggers an RPC
   * call to a `'lock'` method on the worklet. Use this for vault-style
   * apps that should drop decrypted state when backgrounded.
   * Default: false.
   */
  lockOnBackground?: boolean

  /**
   * Per-RPC-command timeout overrides. Specific commands that may legitimately
   * take longer than the default 30s — pairing flows, vault creation, large
   * downloads — can be marked here. Falls back to `defaultTimeoutMs`.
   *
   * Example:
   *   longRunningTimeouts: { 'pair:accept': 120_000, 'vault:create': 120_000 }
   */
  longRunningTimeouts?: Record<string, number>

  /**
   * Default RPC call timeout in milliseconds. Default: 30_000.
   */
  defaultTimeoutMs?: number

  /**
   * Optional crash handler. Fires when the worklet emits an unhandled
   * error or aborts. `lastBootStage` is the most recent `'boot'` stage
   * event the worklet emitted before crashing — useful for debugging
   * which subsystem was initializing.
   */
  onCrash?: (info: { error: Error; lastBootStage?: string }) => void
}

/**
 * The bundle shape produced by `pear-end-pack`. Opaque to consumers —
 * just import the platform-shim file and pass it through.
 */
export interface WorkletBundle {
  readonly source: Uint8Array | string
  readonly platform: 'android' | 'ios'
}

/**
 * The handle returned by `PearEnd.start()`. Owns the worklet lifecycle.
 */
export interface PearEndHandle {
  /**
   * Typed RPC interface. Calls a command on the worklet by name.
   * Throws on timeout. Errors thrown inside the worklet are surfaced
   * as Error instances with `.code` and `.cause` populated.
   */
  readonly rpc: {
    call<TParams = unknown, TResult = unknown>(
      command: string,
      params?: TParams
    ): Promise<TResult>
  }

  /**
   * AsyncIterable of streamed events on a named channel. Channels are
   * declared by the worklet via `defineWorklet({ events: [...] })`.
   * Iteration ends when the worklet tears down.
   */
  events<TPayload = unknown>(channel: string): AsyncIterable<TPayload>

  /**
   * Suspend the worklet. By default this is a no-op (the Bare runtime
   * keeps running). If `lockOnBackground` is true, this calls the
   * `'lock'` RPC method on the worklet.
   */
  suspend(): Promise<void>

  /**
   * Tear down the worklet. After this resolves, the worklet has called
   * its `Bare.on('teardown')` handler, closed all subsystems, and the
   * process is exiting. The PearEndHandle becomes unusable.
   */
  teardown(): Promise<void>
}

/**
 * Error subclass thrown by RPC calls when the worklet returns an error.
 * Carries the worklet-side error code + the original message.
 */
export class PearEndRpcError extends Error {
  readonly code: string
  readonly remoteName: string

  constructor (message: string, code: string, remoteName: string) {
    super(message)
    this.name = 'PearEndRpcError'
    this.code = code
    this.remoteName = remoteName
  }
}

/**
 * Error subclass thrown by RPC calls that exceeded their timeout.
 * The worklet may still be processing the request — the timeout only
 * abandons the waiting Promise on the RN side.
 */
export class PearEndTimeoutError extends Error {
  readonly command: string
  readonly timeoutMs: number

  constructor (command: string, timeoutMs: number) {
    super(`RPC call ${command} timed out after ${timeoutMs}ms`)
    this.name = 'PearEndTimeoutError'
    this.command = command
    this.timeoutMs = timeoutMs
  }
}
