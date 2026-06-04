// rpc-roundtrip.test — the real verification. Wires the worklet-side RPC
// (worklet/worklet-rpc.mjs) to the React Native side (dist/ipc.js) across a
// byte-accurate in-memory bridge that mimics the native IPC duplex, then
// exercises request/reply, events, errors, timeouts, and the full
// defineWorklet → boot → ready flow — all without a native build.
//
// This is what proves the ported wire protocol is internally consistent: the
// exact bytes one side writes are the bytes the other side parses.

import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { PearEndRpc } from '../../dist/ipc.js'
import { WorkletRpc } from '../../worklet/worklet-rpc.mjs'

// A faithful stand-in for the BareKit IPC duplex. Bytes written on one end are
// delivered to the other end's 'data' listener on a later microtask, exactly
// like the real native bridge: the RN side receives a Uint8Array, the worklet
// (Bare) side receives a Buffer.
function makeBridge () {
  const rnIpc = new EventEmitter()
  const workletIpc = new EventEmitter()
  rnIpc.write = (u8) => { const buf = Buffer.from(u8); queueMicrotask(() => workletIpc.emit('data', buf)) }
  workletIpc.write = (buf) => { const u8 = new Uint8Array(buf); queueMicrotask(() => rnIpc.emit('data', u8)) }
  rnIpc.end = () => {}
  workletIpc.end = () => {}
  return { rnIpc, workletIpc }
}

test('request/reply round-trips RN → worklet → RN', async () => {
  const { rnIpc, workletIpc } = makeBridge()
  const worklet = new WorkletRpc(workletIpc)
  worklet.handle('echo', async ({ msg }) => ({ echoed: msg }))

  const rn = new PearEndRpc(rnIpc)
  const res = await rn.request('echo', { msg: 'hello' }, 2000)
  assert.deepEqual(res, { echoed: 'hello' })
})

test('non-ASCII payloads round-trip intact in both directions (UTF-8 framing)', async () => {
  // Regression: the RN side once decoded with latin1 (String.fromCharCode per
  // byte), which desynced the length-prefixed frames on any multi-byte char and
  // silently dropped the message. Exercise accents, CJK, an em dash and an
  // astral-plane emoji (surrogate pair) end-to-end, RN → worklet → RN.
  const { rnIpc, workletIpc } = makeBridge()
  const worklet = new WorkletRpc(workletIpc)
  worklet.handle('echo', async ({ msg }) => ({ echoed: msg, len: msg.length }))

  const rn = new PearEndRpc(rnIpc)
  const payload = 'café ☕ — 日本語 — 🚀 — Ω≈ç√∫'
  const res = await rn.request('echo', { msg: payload }, 2000)
  assert.equal(res.echoed, payload)
  assert.equal(res.len, payload.length)
})

test('worklet handler errors surface as PearEndRpcError with code', async () => {
  const { rnIpc, workletIpc } = makeBridge()
  const worklet = new WorkletRpc(workletIpc)
  worklet.handle('boom', async () => {
    const e = new Error('kaboom')
    e.code = 'E_BOOM'
    throw e
  })

  const rn = new PearEndRpc(rnIpc)
  await assert.rejects(() => rn.request('boom', {}, 2000), (err) => {
    assert.equal(err.name, 'PearEndRpcError')
    assert.equal(err.message, 'kaboom')
    assert.equal(err.code, 'E_BOOM')
    return true
  })
})

test('unknown command rejects with a clear error', async () => {
  const { rnIpc, workletIpc } = makeBridge()
  // eslint-disable-next-line no-new
  new WorkletRpc(workletIpc)
  const rn = new PearEndRpc(rnIpc)
  await assert.rejects(() => rn.request('does-not-exist', {}, 2000), /Unknown command/)
})

test('worklet events stream to the RN side', async () => {
  const { rnIpc, workletIpc } = makeBridge()
  const worklet = new WorkletRpc(workletIpc)
  const rn = new PearEndRpc(rnIpc)

  const got = new Promise((resolve) => rn.onEvent('tick', resolve))
  worklet.event('tick', { n: 7 })
  assert.deepEqual(await got, { n: 7 })
})

test('multiple concurrent requests correlate by id', async () => {
  const { rnIpc, workletIpc } = makeBridge()
  const worklet = new WorkletRpc(workletIpc)
  worklet.handle('double', async ({ n }) => ({ n: n * 2 }))

  const rn = new PearEndRpc(rnIpc)
  const results = await Promise.all([
    rn.request('double', { n: 1 }, 2000),
    rn.request('double', { n: 2 }, 2000),
    rn.request('double', { n: 3 }, 2000)
  ])
  assert.deepEqual(results, [{ n: 2 }, { n: 4 }, { n: 6 }])
})

test('request times out with PearEndTimeoutError', async () => {
  const { rnIpc, workletIpc } = makeBridge()
  const worklet = new WorkletRpc(workletIpc)
  worklet.handle('hang', () => new Promise(() => {})) // never resolves

  const rn = new PearEndRpc(rnIpc)
  await assert.rejects(() => rn.request('hang', {}, 100), (err) => {
    assert.equal(err.name, 'PearEndTimeoutError')
    assert.equal(err.command, 'hang')
    return true
  })
})

test('defineWorklet boot → ready, lifecycle wiring, and commands all work', async () => {
  const { rnIpc, workletIpc } = makeBridge()

  // Inject the Bare worklet globals the helper expects.
  const bareHandlers = {}
  globalThis.BareKit = { IPC: workletIpc }
  globalThis.Bare = { on: (ev, fn) => { bareHandlers[ev] = fn }, argv: ['/tmp/storage'] }

  try {
    const { defineWorklet } = await import('../../worklet/index.mjs')

    const stages = []
    let suspended = false
    defineWorklet({
      async boot ({ progress }) {
        progress('opening', 'Opening storage…')
        progress('joining', 'Joining the swarm…')
        return { ok: true, port: 4242 }
      },
      commands: {
        add: async ({ a, b }) => ({ sum: a + b })
      },
      events: ['ping'],
      async suspend () { suspended = true }
    })

    const rn = new PearEndRpc(rnIpc)
    rn.onEvent('pear-end/boot', (d) => stages.push(d.stage))

    const ready = await new Promise((resolve) => rn.onEvent('pear-end/ready', resolve))
    assert.deepEqual(ready, { ok: true, port: 4242 })

    const sum = await rn.request('add', { a: 2, b: 3 }, 2000)
    assert.deepEqual(sum, { sum: 5 })

    // Lifecycle hooks were registered on the Bare global; firing suspend runs
    // the consumer hook.
    assert.equal(typeof bareHandlers.suspend, 'function')
    bareHandlers.suspend()
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(suspended, true)

    // Boot progress reached the RN side in order.
    assert.deepEqual(stages, ['opening', 'joining'])
  } finally {
    delete globalThis.BareKit
    delete globalThis.Bare
  }
})

test('defineWorklet boot failure emits a boot-error the RN side can see', async () => {
  const { rnIpc, workletIpc } = makeBridge()
  globalThis.BareKit = { IPC: workletIpc }
  globalThis.Bare = { on: () => {}, argv: [] }

  try {
    // Fresh module instance so the one-shot defineWorklet guard doesn't trip.
    const { defineWorklet } = await import('../../worklet/index.mjs?case=bootfail')

    const rn = new PearEndRpc(rnIpc)
    const errEvent = new Promise((resolve) => rn.onEvent('pear-end/error', resolve))

    defineWorklet({
      async boot ({ progress }) {
        progress('opening', 'Opening storage…')
        throw new Error('disk on fire')
      }
    })

    const err = await errEvent
    assert.equal(err.type, 'boot-error')
    assert.equal(err.message, 'disk on fire')
    assert.equal(err.lastBootStage, 'opening')
  } finally {
    delete globalThis.BareKit
    delete globalThis.Bare
  }
})
