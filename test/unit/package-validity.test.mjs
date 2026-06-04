// package-validity.test — sanity checks on package.json structure that
// would otherwise be caught only at publish time (or worse, by a confused
// consumer doing `npm install` against a broken manifest).

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

async function loadPkg () {
  return JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
}

test('package.json: valid JSON + required fields present', async () => {
  const pkg = await loadPkg()
  assert.equal(pkg.name, 'react-native-pear-end')
  assert.ok(pkg.version, 'has version')
  assert.ok(pkg.description, 'has description')
  assert.equal(pkg.license, 'Apache-2.0')
})

test('package.json: exports point at files we actually compile', async () => {
  const pkg = await loadPkg()
  const exports = pkg.exports
  assert.ok(exports['.'], 'root export defined')
  assert.equal(exports['.'].default, './dist/index.js')
  assert.equal(exports['.'].types, './dist/index.d.ts')
  assert.equal(exports['./worklet'].default, './worklet/index.mjs')
  assert.equal(exports['./constants'].default, './dist/constants.js')
})

test('package.json: bin script points at the CLI we ship', async () => {
  const pkg = await loadPkg()
  assert.equal(pkg.bin['pear-end-pack'], './bin/pear-end-pack.js')
})

test('package.json: peer deps include react-native + react-native-bare-kit + bare-pack', async () => {
  const pkg = await loadPkg()
  assert.ok(pkg.peerDependencies['react-native'], 'react-native peer dep')
  assert.ok(pkg.peerDependencies['react-native-bare-kit'], 'bare-kit peer dep')
  assert.ok(pkg.peerDependencies['bare-pack'], 'bare-pack peer dep')
})

test('package.json: files manifest includes everything we publish', async () => {
  const pkg = await loadPkg()
  const expected = ['dist/', 'src/', 'worklet/', 'bin/', 'README.md', 'LICENSE']
  for (const f of expected) {
    assert.ok(pkg.files.includes(f), `files manifest includes ${f}`)
  }
})

test('package.json: engines.node is set (Bare ecosystem needs >=20)', async () => {
  const pkg = await loadPkg()
  assert.ok(pkg.engines.node, 'engines.node declared')
  assert.match(pkg.engines.node, />=20/, 'requires Node 20+')
})
