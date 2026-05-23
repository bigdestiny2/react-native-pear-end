#!/usr/bin/env node

// postinstall.js — applies vendored patches and verifies bare-kit version.
//
// Runs on `npm install`. Two responsibilities:
//
//   1. Apply patches in patches/ via patch-package (when populated)
//   2. Verify react-native-bare-kit major version matches what we're
//      pinned against. Warn loudly if mismatch — we can't fail because
//      consumers may legitimately want to test against pre-release
//      bare-kit versions.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main () {
  // STATUS: SKELETON. Real patch + version logic lands with the handover.

  // 1. Apply patches (when patches/ is populated)
  // TODO(handover): once we have the fs-native-extensions + device-file
  // patches from the reference integration, this section will:
  //
  //   const { execSync } = await import('node:child_process')
  //   try {
  //     execSync('npx patch-package', { stdio: 'inherit', cwd: process.cwd() })
  //   } catch (err) {
  //     console.warn('postinstall: patch-package failed — patches may not apply correctly.')
  //   }

  // 2. Verify bare-kit version
  try {
    const ourPkg = JSON.parse(await readFile(join(__dirname, 'package.json'), 'utf8'))
    const bareKitRange = ourPkg.peerDependencies['react-native-bare-kit']
    // Walk up looking for the consumer's installed bare-kit
    // (best-effort; npm doesn't expose this cleanly in postinstall).
    const consumerBareKitPath = join(
      process.cwd(),
      'node_modules',
      'react-native-bare-kit',
      'package.json'
    )
    try {
      const bareKit = JSON.parse(await readFile(consumerBareKitPath, 'utf8'))
      console.log(
        `react-native-pear-end: detected react-native-bare-kit@${bareKit.version}` +
        ` (peer range: ${bareKitRange})`
      )
      // TODO: semver compare and warn on mismatch
    } catch (_) {
      // bare-kit not installed yet — that's fine, npm install order
      // doesn't guarantee peer deps land first. The consumer will see
      // the peer warning from npm itself.
    }
  } catch (err) {
    console.warn('react-native-pear-end postinstall: version check skipped:', err.message)
  }
}

main().catch((err) => {
  // Never fail the install — postinstall failures are confusing to debug
  // and the patches are the only critical thing here.
  console.warn('react-native-pear-end postinstall: non-fatal error:', err.message)
})
