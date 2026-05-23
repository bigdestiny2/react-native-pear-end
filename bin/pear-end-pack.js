#!/usr/bin/env node

// pear-end-pack — CLI wrapper around `bare-pack --linked` with sane
// defaults for the RN+Bare integration. Generates per-platform bundles
// and Metro shim files.
//
// STATUS: SKELETON. Real bare-pack invocation lands with the handover.
//
// Usage:
//
//   pear-end-pack [options] <worklet-entrypoint>
//
// Options:
//
//   --out <dir>      Output directory. Default: ./worklet-bundles
//   --platforms <list>
//                    Comma-separated list. Default: android,ios
//   --abis <list>    Override default ABIs.
//                    Default android: android-arm64,android-arm,android-ia32,android-x64
//                    Default ios: ios-arm64,ios-arm64-simulator
//   --shim           Also generate Metro platform-shim files
//                    (worklet-bundle.android.js, worklet-bundle.ios.js).
//                    Default: true
//   --verbose, -v    Print the bare-pack invocation + bundle size + timing
//   --help, -h       Show this help

import { argv, exit } from 'node:process'

function help () {
  console.log(`pear-end-pack — bare-pack wrapper for RN+Bare integration

Usage:
  pear-end-pack [options] <worklet-entrypoint>

Options:
  --out <dir>        Output directory (default: ./worklet-bundles)
  --platforms <list> Comma-separated (default: android,ios)
  --abis <list>      Override default ABIs per platform
  --shim             Generate Metro platform-shim files (default: true)
  --verbose, -v      Verbose output
  --help, -h         Show this help

Example:
  pear-end-pack --out mobile/backend backend/worklet.mjs
`)
}

const args = argv.slice(2)
if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  help()
  exit(args.length === 0 ? 1 : 0)
}

// TODO(handover): implement against reference integration's bare-pack
// invocation. Sketch:
//
//   1. Resolve entrypoint to absolute path
//   2. For each platform in --platforms:
//      a. Spawn `bare-pack --linked --host <abi1> --host <abi2> ... \
//                          --out <out>/worklet.<platform>.bundle.js \
//                          <entrypoint>`
//      b. Capture stdout/stderr, surface errors clearly
//   3. If --shim, write:
//      <out>/worklet-bundle.android.js:
//        module.exports = require('./worklet.android.bundle')
//      <out>/worklet-bundle.ios.js:
//        module.exports = require('./worklet.ios.bundle')
//   4. If --verbose, print bundle sizes + total time

console.error(
  'pear-end-pack: SKELETON — awaiting reference integration handover. ' +
  'See ARCHITECTURE.md for the design contract.'
)
exit(1)
