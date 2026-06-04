# Changelog

All notable changes to `react-native-pear-end` are documented here.
Dates in YYYY-MM-DD. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0-beta.1] — 2026-06-04

First beta. The package is **pure JS/TS** — no native module, no Gradle
plugin, no iOS Pod (it does vendor two `patch-package` patches you apply
in your app). Everything else native is delegated to
`react-native-bare-kit` (runtime) and `bare-pack` (bundler). The RPC
protocol, worklet lifecycle helper, bundle CLI, and constants are
implemented and covered by a `node --test` unit suite (33/33 passing).
The end-to-end on-device path is ported from the production PearBrowser +
PearPaste apps but has not been re-verified in this packaged form — see
the Status section of the README.

### Added

- **RN runtime wrapper** (`src/PearEnd.ts`): `PearEnd.start({ bundle,
  storage, ... })` loads `react-native-bare-kit` through the Metro
  `require` at call time, starts a `Worklet`, and gates on the worklet's
  `ready` event (`readyTimeoutMs`, default 30s). Returns a
  `PearEndHandle` with `rpc.call()`, `events()`, `suspend()`,
  `teardown()`. Passes the bundle as **bytes on both platforms** — a
  string silently no-ops on Android (JNI) and empirically fails to run
  the worklet on iOS too; bytes are the only path that boots on both.
- **Synchronous length-prefixed JSON RPC** (`src/ipc.ts` ⇄
  `worklet/worklet-rpc.mjs`): `<8-char ASCII-hex length><JSON body>`
  framing over `BareKit.IPC`. Constructors return immediately — no
  async handshake to stall on the RN bridge (the `bare-rpc` async
  handshake can hang there). Per-request caller-side timeouts, retry
  with backoff on transient write failures, and resync on
  oversized/garbled buffers.
- **Dependency-free UTF-8 codec** on the RN side, byte-identical to the
  worklet side's `Buffer.from(...)`, with the decoder holding back an
  incomplete trailing multi-byte sequence between native reads (a single
  per-chunk decode can mis-handle a sequence split across reads). The
  proven source apps use `b4a` (also UTF-8) here; this is the
  dependency-free equivalent. The real bug it avoids was a *latin1*
  decode, not UTF-8. Non-ASCII (incl. astral-plane emoji via surrogate
  pairs) round-trips losslessly.
- **Worklet helper** (`worklet/index.mjs`): `defineWorklet({ boot,
  commands, events, suspend, resume, teardown })`. Registers command
  handlers and a built-in graceful-teardown command
  (`pear-end/teardown`); wires `Bare.on('suspend')` → `IPC.unref()` and
  `Bare.on('resume')` → `IPC.ref()` plus optional hooks; runs `boot(ctx)`
  with `ctx.progress(stage, message)` streaming boot-stage events and the
  resolved value becoming the `ready` payload. No `bare-events`
  dependency — a tiny built-in listener map keeps the helper
  dependency-free.
- **Bundle CLI** (`bin/pear-end-pack.js`): wraps `bare-pack --linked`
  with sane defaults. Default hosts cover real devices **and** the usual
  dev targets — `android-arm64,android-arm` for Android and
  `ios-arm64,ios-arm64-simulator` for iOS (without the simulator host the
  bundle won't run in the iOS Simulator). Writes one self-contained
  ES-module bundle per platform plus the Metro platform shims, so a
  consumer can `import bundle from './worklet-bundles/worklet-bundle'`
  and get the right one per OS — no Metro transformer needed. Validates
  the entrypoint up front and fails clearly if `bare-pack` isn't
  installed (honors `PEAR_END_BARE_PACK`).
- **Vendored patches** (`patches/`): two `patch-package` patches lifted
  from the production apps — `device-file+2.3.1.patch` (Android-reinstall
  inode/mtime crash) and `fs-native-extensions+1.5.0.patch` (32-bit ARM
  `tryLock` EINVAL). Not auto-applied; copy into your app's `patches/`
  and run `patch-package`.
- **Constants** (`src/constants.ts`): `ARGON2_MEMLIMIT_MOBILE` (64 MB,
  avoids OOM on phones with < 2 GB RAM), `ARGON2_MEMLIMIT_DESKTOP`
  (256 MB), `DEFAULT_RPC_TIMEOUT_MS`, `LONG_RPC_TIMEOUT_MS`,
  `SYNC_READY_TIMEOUT_MS`.
- **Public TypeScript surface** (`src/types.ts`): `PearEndOptions`,
  `WorkletBundle`, `PearEndHandle`, `PearEndRpcError`,
  `PearEndTimeoutError`.
- **Docs**: README (scope, honest status, usage, ownership/donation
  intent), ARCHITECTURE (the four parts + wire format), TROUBLESHOOTING
  (empirical learnings, each tagged *SDK handles this* vs *You handle
  this*).
- **Unit suite** (`test/unit/`, `node --test`): RPC request/reply, error
  propagation with codes, unknown-command handling, event streaming,
  concurrent id correlation, timeouts, the non-ASCII UTF-8 round-trip
  regression, and `defineWorklet` boot→ready / boot-failure paths.

### Known limitations

- On-device boot, the Metro bundle round trip, and lifecycle behavior
  against the live Bare runtime are inherited from the source
  application but **not** re-verified in this packaged form.
- This SDK ships **no** fix for iOS xcframework staging, `bare-link`
  rooting in monorepos, `device-file` mtime on Android reinstall, or
  `fs-native-extensions` EINVAL on 32-bit ARM. These are documented in
  TROUBLESHOOTING as *You handle this* (with practical stopgaps), not
  solved here.

### Open ecosystem questions

- **iOS xcframework staging** — no canonical RN mechanism yet for staging
  Bare native-addon xcframeworks alongside `react-native-bare-kit`'s Pod.
- **App Store JavaScriptCore policy** — Bare embeds V8 + libuv; whether
  Apple accepts this in review is empirically unproven for
  Bare-embedding apps.
- **Naming** — currently unscoped `react-native-pear-end`; may change if
  community feedback prefers another shape.
