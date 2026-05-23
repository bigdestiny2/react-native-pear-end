// constants.test — verifies the empirical defaults are exactly the
// values documented in TROUBLESHOOTING.md. These constants ARE the
// contract — changing them breaks downstream consumers' cross-device
// key derivation, so they should never drift accidentally.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ARGON2_MEMLIMIT_MOBILE,
  ARGON2_MEMLIMIT_DESKTOP,
  DEFAULT_RPC_TIMEOUT_MS,
  LONG_RPC_TIMEOUT_MS,
  SYNC_READY_TIMEOUT_MS
} from '../../dist/constants.js'

test('ARGON2_MEMLIMIT_MOBILE === 64 MB (libsodium INTERACTIVE)', () => {
  assert.equal(ARGON2_MEMLIMIT_MOBILE, 64 * 1024 * 1024)
  assert.equal(ARGON2_MEMLIMIT_MOBILE, 67_108_864, 'literal byte value')
})

test('ARGON2_MEMLIMIT_DESKTOP === 256 MB (libsodium MODERATE)', () => {
  assert.equal(ARGON2_MEMLIMIT_DESKTOP, 256 * 1024 * 1024)
  assert.equal(ARGON2_MEMLIMIT_DESKTOP, 268_435_456, 'literal byte value')
})

test('DEFAULT_RPC_TIMEOUT_MS === 30s', () => {
  assert.equal(DEFAULT_RPC_TIMEOUT_MS, 30_000)
})

test('LONG_RPC_TIMEOUT_MS === 120s (covers DHT lookup + UDX hole punch)', () => {
  assert.equal(LONG_RPC_TIMEOUT_MS, 120_000)
})

test('SYNC_READY_TIMEOUT_MS === 15s (Autobase open + first replicate)', () => {
  assert.equal(SYNC_READY_TIMEOUT_MS, 15_000)
})

test('mobile memlimit is strictly smaller than desktop (sanity)', () => {
  assert.ok(ARGON2_MEMLIMIT_MOBILE < ARGON2_MEMLIMIT_DESKTOP)
})

test('long timeout > default timeout (sanity)', () => {
  assert.ok(LONG_RPC_TIMEOUT_MS > DEFAULT_RPC_TIMEOUT_MS)
})
