# Changelog

All notable changes to `react-native-pear-end` are documented here.
Dates in YYYY-MM-DD.

## [Unreleased]

### Scaffolded

- Package layout: `src/`, `worklet/`, `android/`, `ios/`, `bin/`,
  `patches/`, `postinstall.js`
- README documenting scope, ownership, donation intent
- ARCHITECTURE.md describing the 5-layer design (build-system,
  bundler, JS wrapper, worklet helper, patches+memory)
- TROUBLESHOOTING.md encoding empirical learnings (TextEncoder gotcha,
  dynamic-import limitation, argon2id OOM, EINVAL on 32-bit ARM,
  device-file mtime, bare-rpc handshake hang, lifecycle defaults,
  APK size + ABI splits, App Store JSC concern)
- TypeScript public surface: `PearEnd.start()`, `PearEndHandle`,
  `PearEndRpcError`, `PearEndTimeoutError`, `PearEndOptions`,
  `WorkletBundle`
- Memory tuning constants: `ARGON2_MEMLIMIT_MOBILE`,
  `ARGON2_MEMLIMIT_DESKTOP`, `DEFAULT_RPC_TIMEOUT_MS`,
  `LONG_RPC_TIMEOUT_MS`, `SYNC_READY_TIMEOUT_MS`
- Worklet-side `defineWorklet({ commands, events, boot, suspend,
  teardown })` API shape
- Gradle plugin skeleton (`io.pearend.gradle`) registering
  `pearEndLinkBareAddons` + `pearEndBundleWorklet`, wired to preBuild
- iOS Podspec skeleton (xcframework staging mechanism TBD pending
  reference handover)
- CLI skeleton: `pear-end-pack`
- Postinstall hook skeleton: `patch-package` apply + bare-kit version
  verification

### Awaiting reference integration handover

- Actual Gradle task implementations (the bare-link rooting fix)
- Vendored patches (`fs-native-extensions+1.5.0.patch`,
  `device-file+2.3.1.patch`)
- IPC framing details (sync RPC over BareKit.IPC)
- Boot stage event names + sequencing
- Teardown order (swarm → corestore → drives)
- Concrete `bare-pack` invocation flags
- iOS xcframework staging mechanism

### Open ecosystem questions

- iOS xcframework staging — no documented mechanism in RN context;
  coordinating with Holepunch
- App Store JavaScriptCore policy — empirically unproven for
  Bare-embedding apps
- Naming — currently unscoped `react-native-pear-end`; may rename
  if community feedback prefers another shape
