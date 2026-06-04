#!/usr/bin/env node

// pear-end-pack — a thin wrapper around `bare-pack --linked` with sane
// defaults for the React Native + Bare integration. It produces one linked
// bundle per platform and (optionally) the Metro platform-shim files that let
// you `import bundle from './worklet-bundle'` and get the right one per OS.
//
// The invocation mirrors what the production PearBrowser/PearPaste apps ship:
//
//   bare-pack --linked --host ios-arm64 --host ios-arm64-simulator <entry> -o <out>/worklet.ios.bundle.mjs
//   bare-pack --linked --host android-arm64 --host android-arm     <entry> -o <out>/worklet.android.bundle.mjs
//
// Usage:
//   pear-end-pack [options] <worklet-entrypoint>
//
// Options:
//   --out <dir>        Output directory (default: ./worklet-bundles)
//   --platforms <list> Comma-separated: android,ios (default: android,ios)
//   --host <list>      Override host ABIs (comma-separated, applied to every
//                      platform). Defaults: android-arm64,android-arm for
//                      Android; ios-arm64,ios-arm64-simulator for iOS.
//   --no-shim          Do not generate the Metro platform-shim files
//   --verbose, -v      Print each bare-pack invocation + bundle size + timing
//   --help, -h         Show this help

import { argv, exit, env } from 'node:process'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { resolve, join, isAbsolute } from 'node:path'

function help () {
  console.log(`pear-end-pack — bare-pack wrapper for the RN + Bare integration

Usage:
  pear-end-pack [options] <worklet-entrypoint>

Options:
  --out <dir>        Output directory (default: ./worklet-bundles)
  --platforms <list> Comma-separated (default: android,ios)
  --host <list>      Override host ABIs, comma-separated
                     (default android: android-arm64,android-arm;
                      ios: ios-arm64,ios-arm64-simulator)
  --no-shim          Skip generating the Metro platform-shim files
  --verbose, -v      Verbose output
  --help, -h         Show this help

Example:
  pear-end-pack --out app/worklet backend/worklet.mjs
`)
}

function parseArgs (args) {
  const opts = {
    out: './worklet-bundles',
    platforms: ['android', 'ios'],
    hosts: null,
    shim: true,
    verbose: false,
    entry: null
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--help' || a === '-h') return { help: true }
    else if (a === '--verbose' || a === '-v') opts.verbose = true
    else if (a === '--no-shim') opts.shim = false
    else if (a === '--shim') opts.shim = true
    else if (a === '--out') opts.out = args[++i]
    else if (a === '--platforms') opts.platforms = String(args[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--host' || a === '--abis') opts.hosts = String(args[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (a.startsWith('-')) { console.error(`pear-end-pack: unknown option '${a}'`); return { error: true } }
    else opts.entry = a
  }
  return opts
}

function hostsFor (platform, override) {
  if (override && override.length) return override
  // Defaults cover real devices + the usual dev targets. iOS includes the
  // simulator host — without it the bundle won't run in the iOS Simulator.
  // Android includes 32-bit arm. For Android emulators add android-x64 /
  // android-ia32 via --host. Mirrors the host set PearBrowser/PearPaste ship.
  if (platform === 'android') return ['android-arm64', 'android-arm']
  if (platform === 'ios') return ['ios-arm64', 'ios-arm64-simulator']
  return [`${platform}-arm64`]
}

function runBarePack (entryAbs, hosts, outFile, verbose) {
  const bin = env.PEAR_END_BARE_PACK || 'bare-pack'
  const args = ['--linked']
  for (const h of hosts) { args.push('--host', h) }
  args.push(entryAbs, '-o', outFile)

  if (verbose) console.log(`  $ ${bin} ${args.join(' ')}`)
  const started = Date.now()
  const res = spawnSync(bin, args, { stdio: verbose ? 'inherit' : 'pipe', encoding: 'utf8' })

  if (res.error && res.error.code === 'ENOENT') {
    console.error(
      `pear-end-pack: could not find '${bin}'. Install it in your project ` +
      "(npm i -D bare-pack) or set PEAR_END_BARE_PACK to its path."
    )
    return false
  }
  if (res.status !== 0) {
    console.error(`pear-end-pack: bare-pack failed for ${outFile} (exit ${res.status}).`)
    if (!verbose && res.stderr) console.error(res.stderr.trim())
    return false
  }
  if (verbose) {
    const ms = Date.now() - started
    let size = 0
    try { size = statSync(outFile).size } catch {}
    console.log(`  → ${outFile} (${(size / 1024 / 1024).toFixed(2)} MB, ${ms} ms)`)
  }
  return true
}

function writeShims (outDir, builtPlatforms) {
  // Per-platform CommonJS shims. Metro resolves `worklet-bundle` to the
  // `.android`/`.ios` variant by platform; each exports a WorkletBundle the
  // consumer can pass straight to `PearEnd.start({ bundle })`.
  for (const platform of builtPlatforms) {
    const bundleRequire = `./worklet.${platform}.bundle.mjs`
    const body =
      `// Generated by pear-end-pack. Do not edit.\n` +
      `const mod = require('${bundleRequire}')\n` +
      `const source = mod && mod.default !== undefined ? mod.default : mod\n` +
      `module.exports = { source, platform: '${platform}' }\n`
    writeFileSync(join(outDir, `worklet-bundle.${platform}.js`), body)
  }
  // Base resolution target (used when Metro has no platform-specific match,
  // and for type tooling). Prefer ios, fall back to whatever was built.
  const fallback = builtPlatforms.includes('ios') ? 'ios' : builtPlatforms[0]
  writeFileSync(
    join(outDir, 'worklet-bundle.js'),
    `// Generated by pear-end-pack. Do not edit.\n` +
    `module.exports = require('./worklet-bundle.${fallback}.js')\n`
  )
}

function main () {
  const args = argv.slice(2)
  if (args.length === 0) { help(); exit(1) }

  const opts = parseArgs(args)
  if (opts.help) { help(); exit(0) }
  if (opts.error) { exit(1) }

  if (!opts.entry) { console.error('pear-end-pack: missing <worklet-entrypoint>.'); help(); exit(1) }

  const entryAbs = isAbsolute(opts.entry) ? opts.entry : resolve(process.cwd(), opts.entry)
  if (!existsSync(entryAbs)) {
    console.error(`pear-end-pack: entrypoint not found: ${entryAbs}`)
    exit(1)
  }
  if (!opts.platforms.length) { console.error('pear-end-pack: no platforms selected.'); exit(1) }

  const outDir = isAbsolute(opts.out) ? opts.out : resolve(process.cwd(), opts.out)
  mkdirSync(outDir, { recursive: true })

  const built = []
  for (const platform of opts.platforms) {
    if (platform !== 'android' && platform !== 'ios') {
      console.error(`pear-end-pack: unsupported platform '${platform}' (expected android or ios).`)
      exit(1)
    }
    const outFile = join(outDir, `worklet.${platform}.bundle.mjs`)
    console.log(`pear-end-pack: packing ${platform} → ${outFile}`)
    if (!runBarePack(entryAbs, hostsFor(platform, opts.hosts), outFile, opts.verbose)) exit(1)
    built.push(platform)
  }

  if (opts.shim) {
    writeShims(outDir, built)
    if (opts.verbose) console.log(`  → wrote Metro shims (worklet-bundle.js + per-platform)`)
  }

  console.log(`pear-end-pack: done (${built.join(', ')}).`)
}

main()
