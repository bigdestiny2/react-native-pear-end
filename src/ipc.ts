// Length-prefixed JSON RPC over a BareKit.IPC byte stream — React Native side.
//
// Ported from two production Pear-on-RN apps (PearBrowser, PearPaste). The wire
// format is byte-for-byte identical to the worklet side (worklet/worklet-rpc.mjs).
//
// The codec below is hand-rolled UTF-8 on purpose, for two reasons: (1) zero
// runtime deps on the RN side, and (2) it buffers a multi-byte sequence split
// across two native reads — which a per-chunk `b4a.toString()` can mis-decode.
// It is full UTF-8, NOT latin1 (a latin1 per-byte decode was the original
// corruption bug): the length prefix counts UTF-16 code units (matching the
// worklet's `json.length`) while the body is UTF-8, so the frame is byte-for-
// byte what the worklet side's `Buffer.from(...)` produces and non-ASCII
// payloads (names, emoji) round-trip losslessly. The proven source apps use
// `b4a` here and it works; this is the dependency-free equivalent. See
// TROUBLESHOOTING.md.

import { PearEndRpcError, PearEndTimeoutError } from './types.js'

/** The subset of the BareKit IPC duplex we depend on. */
export interface IpcLike {
  on(event: 'data', cb: (chunk: Uint8Array) => void): void
  on(event: 'close', cb: () => void): void
  on(event: 'error', cb: (err: any) => void): void
  write(bytes: Uint8Array): void
  end?(): void
}

type ConnectionState = 'connected' | 'disconnecting' | 'disconnected'

interface PendingRequest {
  resolve: (value: any) => void
  reject: (err: any) => void
  timer: ReturnType<typeof setTimeout>
  command: string
  timeoutMs: number
}

interface WireError {
  message?: string
  code?: string
  name?: string
}

const MAX_MESSAGE_LEN = 10_000_000 // 10 MB ceiling for a single framed message
const MAX_BUFFER_LEN = 20_000_000 // 20 MB ceiling for the unparsed read buffer

/**
 * Low-level RPC transport. `PearEnd` builds the public handle on top of this;
 * it is exported so the framing can be unit-tested against a fake IPC without
 * a native build.
 */
export class PearEndRpc {
  private ipc: IpcLike
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private eventListeners = new Map<string, Array<(data: any) => void>>()
  private buffer = ''
  private pendingBytes: number[] = [] // incomplete trailing UTF-8 sequence between chunks
  private connectionState: ConnectionState = 'connected'

  // Retry configuration (exponential backoff on transient write failures).
  private readonly MAX_RETRIES = 3
  private readonly RETRY_BASE_DELAY = 1000

  constructor (ipc: IpcLike) {
    this.ipc = ipc
    ipc.on('data', (data: Uint8Array) => this.onData(data))
    ipc.on('close', () => this.setConnectionState('disconnected'))
    ipc.on('error', (err: any) => this.dispatchEvent('pear-end/error', {
      type: 'ipc-error',
      message: err && err.message ? err.message : String(err)
    }))
  }

  getState (): ConnectionState { return this.connectionState }

  private setConnectionState (state: ConnectionState) { this.connectionState = state }

  // --- events ---

  /** Subscribe to a worklet-emitted channel. Returns an unsubscribe fn. */
  onEvent (channel: string, cb: (data: any) => void): () => void {
    const list = this.eventListeners.get(channel) || []
    list.push(cb)
    this.eventListeners.set(channel, list)
    return () => {
      const idx = list.indexOf(cb)
      if (idx >= 0) list.splice(idx, 1)
    }
  }

  private dispatchEvent (channel: string, data: any) {
    const list = this.eventListeners.get(channel)
    if (!list) return
    for (const cb of list.slice()) {
      try { cb(data) } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[pear-end] listener for '${channel}' threw:`, err)
      }
    }
  }

  // --- request/reply ---

  /**
   * Call a command on the worklet and await its result. Rejects with
   * PearEndTimeoutError on timeout, or PearEndRpcError if the worklet handler
   * threw.
   */
  request (command: string, params: any = {}, timeoutMs = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const msg = { id, cmd: command, data: params }

      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new PearEndTimeoutError(command, timeoutMs))
        }
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timer, command, timeoutMs })
      this.send(msg)
    })
  }

  // --- wire protocol ---

  private send (msg: any, retryCount = 0) {
    try {
      if (this.connectionState === 'disconnected') {
        throw new Error('IPC connection is disconnected')
      }

      const json = JSON.stringify(msg)
      // Header length is counted in UTF-16 code units (matches the worklet
      // side's `json.length`); the body is UTF-8 so multi-byte text survives.
      const header = json.length.toString(16).padStart(8, '0')
      const body = utf8Encode(json)

      const buf = new Uint8Array(8 + body.length)
      for (let i = 0; i < 8; i++) buf[i] = header.charCodeAt(i) // 8 ASCII header bytes
      buf.set(body, 8)
      this.ipc.write(buf)
    } catch (err: any) {
      if (retryCount < this.MAX_RETRIES) {
        const delay = this.RETRY_BASE_DELAY * Math.pow(2, retryCount)
        setTimeout(() => this.send(msg, retryCount + 1), delay)
        return
      }
      // Max retries reached — reject the pending request if there is one.
      if (msg.id && this.pending.has(msg.id)) {
        const pending = this.pending.get(msg.id)!
        clearTimeout(pending.timer)
        this.pending.delete(msg.id)
        pending.reject(new Error(`RPC send failed after ${retryCount} retries: ${err.message}`))
      }
    }
  }

  private onData (chunk: Uint8Array) {
    // Decode bytes → string as UTF-8 ourselves (dependency-free), holding back
    // any incomplete trailing multi-byte sequence so a sequence split across two
    // native reads isn't mis-decoded.
    this.buffer += this.decodeUtf8Stream(chunk)

    // Prevent the buffer from growing unbounded — preserve any valid tail.
    if (this.buffer.length > MAX_BUFFER_LEN) {
      let preserved = ''
      for (let i = Math.max(0, this.buffer.length - MAX_MESSAGE_LEN); i < this.buffer.length; i++) {
        if (i + 8 <= this.buffer.length) {
          const len = parseInt(this.buffer.slice(i, i + 8), 16)
          if (!isNaN(len) && len > 0 && len <= MAX_MESSAGE_LEN && this.buffer.length >= i + 8 + len) {
            preserved = this.buffer.slice(i)
            break
          }
        }
      }
      this.buffer = preserved
      if (!preserved) return
    }

    while (this.buffer.length >= 8) {
      const lenHex = this.buffer.slice(0, 8)
      const len = parseInt(lenHex, 16)

      if (isNaN(len) || len <= 0 || len > MAX_MESSAGE_LEN) {
        // Try to resynchronise on the next plausible length prefix.
        let nextValid = -1
        for (let i = 2; i < Math.min(this.buffer.length, 100); i += 2) {
          const tryLen = parseInt(this.buffer.slice(i, i + 8), 16)
          if (!isNaN(tryLen) && tryLen > 0 && tryLen <= MAX_MESSAGE_LEN) {
            nextValid = i
            break
          }
        }
        if (nextValid > 0) {
          this.buffer = this.buffer.slice(nextValid)
          continue
        }
        this.buffer = ''
        return
      }

      if (this.buffer.length < 8 + len) break // incomplete frame

      const json = this.buffer.slice(8, 8 + len)
      this.buffer = this.buffer.slice(8 + len)

      try {
        this.processMessage(JSON.parse(json))
      } catch {
        // Drop the unparseable frame and keep going.
      }
    }
  }

  // Decode a chunk of UTF-8 bytes to a string. Any bytes that form an
  // incomplete multi-byte sequence at the tail are stashed in `pendingBytes`
  // and prepended to the next chunk, so a character split across two native
  // reads is never corrupted.
  private decodeUtf8Stream (chunk: Uint8Array): string {
    const bytes = this.pendingBytes.length
      ? this.pendingBytes.concat(Array.from(chunk))
      : Array.from(chunk)
    this.pendingBytes = []

    let str = ''
    let i = 0
    const n = bytes.length
    while (i < n) {
      const b0 = bytes[i]
      let need: number
      if (b0 < 0x80) need = 1
      else if (b0 < 0xe0) need = 2
      else if (b0 < 0xf0) need = 3
      else need = 4

      if (i + need > n) { this.pendingBytes = bytes.slice(i); break } // incomplete tail

      if (need === 1) {
        str += String.fromCharCode(b0)
      } else if (need === 2) {
        str += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f))
      } else if (need === 3) {
        str += String.fromCharCode(
          ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
        )
      } else {
        let cp = ((b0 & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) |
          ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)
        cp -= 0x10000
        str += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
      }
      i += need
    }
    return str
  }

  private processMessage (msg: any) {
    // Reply to one of our requests.
    if (msg.id && (msg.result !== undefined || msg.error)) {
      const pending = this.pending.get(msg.id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(msg.id)
        if (msg.error) pending.reject(toRpcError(msg.error))
        else pending.resolve(msg.result)
      }
      return
    }

    // Push event from the worklet.
    if (msg.event !== undefined) {
      this.dispatchEvent(msg.event, msg.data)
    }
  }

  close () {
    this.setConnectionState('disconnecting')
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('RPC connection closed'))
    }
    this.pending.clear()
    this.eventListeners.clear()
    this.buffer = ''
    this.pendingBytes = []
    if (this.ipc && typeof this.ipc.end === 'function') this.ipc.end()
    this.setConnectionState('disconnected')
  }
}

// Hand-rolled UTF-8 encoder (dependency-free — no Buffer/b4a needed on the RN
// side). Matches the bytes the worklet side's `Buffer.from(str)` produces, so
// the two halves of the wire protocol are byte-for-byte identical. Surrogate
// pairs are combined into a single code point so astral chars (emoji) encode
// correctly.
function utf8Encode (str: string): Uint8Array {
  const bytes: number[] = []
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        i++
      }
    }
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      )
    }
  }
  return Uint8Array.from(bytes)
}

// Worklet errors arrive as { message, code, name } (a bare string is also
// tolerated). Reconstruct a typed PearEndRpcError for the caller.
function toRpcError (error: string | WireError): PearEndRpcError {
  if (typeof error === 'string') return new PearEndRpcError(error, 'ERR_WORKLET', 'Error')
  return new PearEndRpcError(
    error.message || 'RPC error',
    error.code || 'ERR_WORKLET',
    error.name || 'Error'
  )
}
