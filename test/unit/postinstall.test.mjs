// postinstall.test — verifies the postinstall hook doesn't crash, even
// in environments where react-native-bare-kit isn't present (which is
// the normal install path before peer deps are resolved).

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOOK = join(__dirname, '..', '..', 'postinstall.js')

test('postinstall.js exits 0 even without react-native-bare-kit installed', async () => {
  // Run in a temp dir so the consumer-node_modules lookup misses cleanly.
  const cwd = await mkdtemp(join(tmpdir(), 'pearend-postinstall-test-'))
  try {
    const result = spawnSync('node', [HOOK], { cwd, encoding: 'utf8' })
    assert.equal(result.status, 0, `exit 0 (stderr: ${result.stderr})`)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('postinstall.js never throws on malformed package.json paths', async () => {
  // Verifies the catch-all error swallow so npm install never fails
  // because of a postinstall bug.
  const cwd = await mkdtemp(join(tmpdir(), 'pearend-postinstall-test-'))
  try {
    const result = spawnSync('node', [HOOK], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, FORCE_BAD_PATH: '1' }
    })
    assert.equal(result.status, 0, 'always exits 0')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
