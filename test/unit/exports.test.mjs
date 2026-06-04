// exports.test — verifies the public API surface matches what the
// README and TypeScript types promise. Catches accidental removals,
// renames, or skeleton symbols leaking.

import test from 'node:test'
import assert from 'node:assert/strict'

test('main export surface includes PearEnd + error classes + constants', async () => {
  const m = await import('../../dist/index.js')

  assert.ok(m.PearEnd, 'PearEnd class exported')
  assert.equal(typeof m.PearEnd.start, 'function', 'PearEnd.start is a function')

  assert.ok(m.PearEndRpcError, 'PearEndRpcError class exported')
  assert.ok(m.PearEndTimeoutError, 'PearEndTimeoutError class exported')

  assert.equal(typeof m.ARGON2_MEMLIMIT_MOBILE, 'number')
  assert.equal(typeof m.ARGON2_MEMLIMIT_DESKTOP, 'number')
  assert.equal(typeof m.DEFAULT_RPC_TIMEOUT_MS, 'number')
  assert.equal(typeof m.LONG_RPC_TIMEOUT_MS, 'number')
  assert.equal(typeof m.SYNC_READY_TIMEOUT_MS, 'number')
})

test('error classes carry the expected fields', () => {
  // Dynamic import inside the test to keep this self-contained
  return import('../../dist/index.js').then((m) => {
    const rpcErr = new m.PearEndRpcError('boom', 'E_TEST', 'TestError')
    assert.equal(rpcErr.message, 'boom')
    assert.equal(rpcErr.code, 'E_TEST')
    assert.equal(rpcErr.remoteName, 'TestError')
    assert.equal(rpcErr.name, 'PearEndRpcError')
    assert.ok(rpcErr instanceof Error)

    const timeoutErr = new m.PearEndTimeoutError('vault:unlock', 30_000)
    assert.match(timeoutErr.message, /vault:unlock/)
    assert.match(timeoutErr.message, /30000/)
    assert.equal(timeoutErr.command, 'vault:unlock')
    assert.equal(timeoutErr.timeoutMs, 30_000)
    assert.equal(timeoutErr.name, 'PearEndTimeoutError')
    assert.ok(timeoutErr instanceof Error)
  })
})

test('PearEnd.start rejects clearly when react-native-bare-kit is absent', async () => {
  // Under the plain-Node test runtime there is no Metro `require` and no
  // react-native-bare-kit, so start() must fail with a helpful message rather
  // than a ReferenceError or a hang.
  const m = await import('../../dist/index.js')
  await assert.rejects(
    () => m.PearEnd.start({
      bundle: { source: 'x', platform: 'android' },
      storage: '/tmp'
    }),
    /react-native-bare-kit|require/i,
    'error explains the missing native runtime'
  )
})
