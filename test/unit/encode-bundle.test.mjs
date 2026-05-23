// encode-bundle.test — verifies the TextEncoder-on-Android handling
// in PearEnd.encodeBundle is correct. This is the one piece of real
// implementation we can test before the handover lands.

import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeBundle } from '../../dist/PearEnd.js'

test('encodeBundle: Uint8Array source passes through unchanged', () => {
  const source = new Uint8Array([0x48, 0x69])
  const result = encodeBundle({ source, platform: 'android' })
  assert.equal(result, source, 'same reference')
  assert.deepEqual(Array.from(result), [0x48, 0x69])
})

test('encodeBundle: string source is UTF-8 encoded to bytes', () => {
  const result = encodeBundle({ source: 'Hi', platform: 'android' })
  assert.ok(result instanceof Uint8Array, 'returns Uint8Array')
  assert.deepEqual(Array.from(result), [0x48, 0x69], 'ASCII encoding correct')
})

test('encodeBundle: multibyte string encodes correctly (UTF-8)', () => {
  // 'Café' is 5 bytes in UTF-8: C(0x43), a(0x61), f(0x66), é(0xC3 0xA9)
  const result = encodeBundle({ source: 'Café', platform: 'ios' })
  assert.equal(result.byteLength, 5)
  assert.deepEqual(Array.from(result), [0x43, 0x61, 0x66, 0xC3, 0xA9])
})

test('encodeBundle: empty string yields empty Uint8Array', () => {
  const result = encodeBundle({ source: '', platform: 'android' })
  assert.equal(result.byteLength, 0)
})

test('encodeBundle: large string round-trips without truncation', () => {
  const large = 'x'.repeat(100_000)
  const result = encodeBundle({ source: large, platform: 'android' })
  assert.equal(result.byteLength, 100_000)
})
