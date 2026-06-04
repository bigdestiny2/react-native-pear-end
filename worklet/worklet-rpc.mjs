// Length-prefixed JSON RPC over a BareKit.IPC byte stream — worklet (Bare) side.
//
// Ported from the production PearBrowser backend (backend/rpc.js), the
// implementation that boots end-to-end on iOS + Android. The wire format,
// retry/backoff, and buffer-overflow recovery are preserved exactly. The one
// deliberate change from the original is dropping the `bare-events` dependency
// in favour of a tiny built-in listener map, so the bundled worklet helper
// pulls in nothing extra.
//
// Wire format (MUST stay byte-for-byte identical to the React Native side in
// src/ipc.ts):
//
//   <8-char ASCII-hex length prefix><JSON body>
//
//   request: { id, cmd, data }
//   reply:   { id, result }            (success)
//            { id, error }             (failure; error is { message, code, name })
//   event:   { event, data }
//
// On the Bare side we have a global Buffer, so encoding/decoding uses
// Buffer.from() / chunk.toString() (UTF-8). The RN side produces the identical
// UTF-8 bytes with a small dependency-free codec — see src/ipc.ts.

const MAX_MESSAGE_LEN = 10_000_000 // 10 MB ceiling for a single framed message
const MAX_BUFFER_LEN = 20_000_000 // 20 MB ceiling for the unparsed read buffer

export class WorkletRpc {
  constructor (ipc) {
    this._ipc = ipc
    this._nextId = 1
    this._pending = new Map() // id -> { resolve, reject, timer, msg }
    this._handlers = new Map() // cmd -> async handler(params) -> result
    this._listeners = new Map() // internal event name -> fn[]
    this._buffer = ''
    this._connectionState = 'connected'

    // Retry configuration (exponential backoff on transient write failures).
    this._MAX_RETRIES = 3
    this._RETRY_BASE_DELAY = 1000

    ipc.on('data', (data) => this._onData(data))
    ipc.on('close', () => this._setConnectionState('disconnected'))
    ipc.on('error', (err) => {
      this.emit('error', { type: 'ipc-error', message: err && err.message, error: err })
    })
  }

  // --- minimal internal emitter (for 'error' / 'state-change' diagnostics) ---

  on (event, fn) {
    const list = this._listeners.get(event) || []
    list.push(fn)
    this._listeners.set(event, list)
    return () => {
      const idx = list.indexOf(fn)
      if (idx >= 0) list.splice(idx, 1)
    }
  }

  emit (event, ...args) {
    const list = this._listeners.get(event)
    if (!list) return
    for (const fn of list.slice()) {
      try { fn(...args) } catch (err) {
        console.error(`[pear-end] internal listener for '${event}' threw:`, err)
      }
    }
  }

  // --- connection state ---

  getState () { return this._connectionState }

  _setConnectionState (state) {
    const prevState = this._connectionState
    this._connectionState = state
    this.emit('state-change', { prevState, currentState: state })
  }

  // --- registration ---

  /** Register a command handler: handle(name, async params => result). */
  handle (cmd, fn) { this._handlers.set(cmd, fn) }

  // --- outbound ---

  /** Send a request to the RN side and await its reply. */
  request (cmd, data, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++
      const msg = { id, cmd, data }

      const timer = setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id)
          reject(new Error(`RPC timeout: cmd ${cmd}`))
        }
      }, timeout)

      this._pending.set(id, { resolve, reject, timer, msg })
      this._send(msg)
    })
  }

  /** Push an event up to the RN side (no reply expected). */
  event (evt, data) { this._send({ event: evt, data }) }

  _reply (id, result, error) {
    if (error) {
      this._send({ id, error: serializeError(error) })
    } else {
      this._send({ id, result })
    }
  }

  _send (msg, retryCount = 0) {
    try {
      if (this._connectionState === 'disconnected') {
        throw new Error('IPC connection is disconnected')
      }
      const json = JSON.stringify(msg)
      const buf = Buffer.from(json.length.toString(16).padStart(8, '0') + json)
      this._ipc.write(buf)
    } catch (err) {
      // Retry transient write failures with exponential backoff.
      if (retryCount < this._MAX_RETRIES) {
        const delay = this._RETRY_BASE_DELAY * Math.pow(2, retryCount)
        setTimeout(() => this._send(msg, retryCount + 1), delay)
        return
      }

      this.emit('error', { type: 'send-failed', message: err.message, msg, retries: retryCount })

      // If this was a request with a pending promise, reject it.
      if (msg.id && this._pending.has(msg.id)) {
        const pending = this._pending.get(msg.id)
        clearTimeout(pending.timer)
        this._pending.delete(msg.id)
        pending.reject(new Error(`RPC send failed after ${retryCount} retries: ${err.message}`))
      }
    }
  }

  // --- inbound ---

  _onData (chunk) {
    this._buffer += chunk.toString()

    // Prevent the buffer from growing unbounded — preserve any valid tail.
    if (this._buffer.length > MAX_BUFFER_LEN) {
      this.emit('error', { type: 'buffer-overflow', message: `Buffer exceeded ${MAX_BUFFER_LEN} bytes` })
      let preserved = ''
      for (let i = Math.max(0, this._buffer.length - MAX_MESSAGE_LEN); i < this._buffer.length; i++) {
        if (i + 8 <= this._buffer.length) {
          const len = parseInt(this._buffer.slice(i, i + 8), 16)
          if (!isNaN(len) && len > 0 && len <= MAX_MESSAGE_LEN && this._buffer.length >= i + 8 + len) {
            preserved = this._buffer.slice(i)
            break
          }
        }
      }
      this._buffer = preserved
      if (!preserved) return
    }

    while (this._buffer.length >= 8) {
      const lenHex = this._buffer.slice(0, 8)
      const len = parseInt(lenHex, 16)

      if (isNaN(len) || len <= 0 || len > MAX_MESSAGE_LEN) {
        this.emit('error', { type: 'protocol-error', message: `Invalid message length: ${len}` })
        // Try to resynchronise on the next plausible length prefix.
        let nextValid = -1
        for (let i = 2; i < Math.min(this._buffer.length, 100); i += 2) {
          const tryLen = parseInt(this._buffer.slice(i, i + 8), 16)
          if (!isNaN(tryLen) && tryLen > 0 && tryLen <= MAX_MESSAGE_LEN) {
            nextValid = i
            break
          }
        }
        if (nextValid > 0) {
          this._buffer = this._buffer.slice(nextValid)
          continue
        }
        this._buffer = ''
        return
      }

      if (this._buffer.length < 8 + len) break // incomplete frame

      const json = this._buffer.slice(8, 8 + len)
      this._buffer = this._buffer.slice(8 + len)

      let msg
      try {
        msg = JSON.parse(json)
      } catch (err) {
        this.emit('error', { type: 'json-parse-error', message: err.message, json: json.substring(0, 500) })
        continue
      }
      this._processMessage(msg)
    }
  }

  async _processMessage (msg) {
    // Reply to one of our own requests.
    if (msg.id && (msg.result !== undefined || msg.error)) {
      const pending = this._pending.get(msg.id)
      if (pending) {
        clearTimeout(pending.timer)
        this._pending.delete(msg.id)
        if (msg.error) pending.reject(deserializeError(msg.error))
        else pending.resolve(msg.result)
      }
      return
    }

    // Push event from the RN side.
    if (msg.event !== undefined) {
      this.emit('event', msg.event, msg.data)
      this.emit(`event:${msg.event}`, msg.data)
      return
    }

    // Incoming request from the RN side.
    if (msg.id && msg.cmd !== undefined) {
      const handler = this._handlers.get(msg.cmd)
      if (!handler) {
        this._reply(msg.id, null, `Unknown command: ${msg.cmd}`)
        return
      }
      try {
        const result = await handler(msg.data)
        this._reply(msg.id, result === undefined ? null : result)
      } catch (err) {
        this._reply(msg.id, null, err)
      }
    }
  }

  close () {
    this._setConnectionState('disconnecting')
    for (const [, pending] of this._pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('RPC connection closed'))
    }
    this._pending.clear()
    this._handlers.clear()
    this._listeners.clear()
    this._buffer = ''
    if (this._ipc && typeof this._ipc.end === 'function') this._ipc.end()
    this._setConnectionState('disconnected')
  }
}

// Errors travel the wire as { message, code, name } so the RN side can
// reconstruct a typed PearEndRpcError. A bare string is also accepted for
// forward/backward tolerance.
function serializeError (error) {
  if (typeof error === 'string') return { message: error, code: 'ERR_WORKLET', name: 'Error' }
  return {
    message: error && error.message ? error.message : String(error),
    code: (error && error.code) || 'ERR_WORKLET',
    name: (error && error.name) || 'Error'
  }
}

function deserializeError (error) {
  if (typeof error === 'string') return new Error(error)
  const e = new Error(error.message || 'RPC error')
  if (error.code) e.code = error.code
  if (error.name) e.name = error.name
  return e
}
