// cli-help.test — verifies the pear-end-pack CLI loads + responds to
// --help without crashing on syntax errors or bad imports.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', '..', 'bin', 'pear-end-pack.js')

test('pear-end-pack --help exits 0 and prints usage', () => {
  const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, `exit code (stderr: ${result.stderr})`)
  assert.match(result.stdout, /pear-end-pack/, 'mentions own name')
  assert.match(result.stdout, /Usage:/, 'shows usage header')
  assert.match(result.stdout, /--out/, 'documents --out')
  assert.match(result.stdout, /--platforms/, 'documents --platforms')
})

test('pear-end-pack with no args shows help + exits non-zero', () => {
  const result = spawnSync('node', [CLI], { encoding: 'utf8' })
  assert.notEqual(result.status, 0, 'exits non-zero with no args')
  assert.match(result.stdout, /Usage:/, 'still shows usage')
})

test('pear-end-pack with bogus entry surfaces skeleton error clearly', () => {
  const result = spawnSync('node', [CLI, 'nonexistent.mjs'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  // Should hit the SKELETON guard, not crash with a missing-file error,
  // because the CLI doesn't yet validate paths before reaching it.
  assert.match(result.stderr, /SKELETON/, 'mentions SKELETON status')
})
