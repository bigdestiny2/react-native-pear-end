# Architecture

How `react-native-pear-end` sits between your app, `react-native-bare-kit`, and your Bare worklet — and what it actually does. This package is **pure JS/TS**: no native module, no Gradle plugin, no iOS Pod. Everything native is delegated to `react-native-bare-kit` (runtime) and `bare-pack` (bundler). It does additionally **vendor two `patch-package` patches** for Bare native-addon issues on Android (you apply them in your app — see [Vendored patches](#vendored-patches-patches)).

## Where this sits

```
┌────────────────────────────────────────────────────────────┐
│ Your React Native app                                      │
│   - UI in TSX / React                                      │
│   - Calls: PearEnd.start() / pear.rpc.call(...) / events() │
└─────────────────┬──────────────────────────────────────────┘
                  │  typed RPC over BareKit.IPC
┌─────────────────▼──────────────────────────────────────────┐
│ react-native-pear-end  (this package — JS/TS only)         │
│   - RN wrapper:     PearEnd.start + sync RPC framing       │
│   - Worklet helper: defineWorklet (boot/commands/events)   │
│   - Bundle CLI:     pear-end-pack (wraps bare-pack)        │
│   - Constants:      argon2 memlimits, RPC timeouts         │
└─────────────────┬──────────────────────────────────────────┘
                  │  consumes (autolinked)
┌─────────────────▼──────────────────────────────────────────┐
│ react-native-bare-kit  (Holepunch)                         │
│   - V8 + libuv compiled for Android/iOS                    │
│   - Worklet API + BareKit.IPC                              │
└─────────────────┬──────────────────────────────────────────┘
                  │  loads
┌─────────────────▼──────────────────────────────────────────┐
│ Your Bare worklet (lives in your repo)                     │
│   - corestore + hyperdrive + autobase + hyperbee           │
│   - hyperswarm + hyperdht over UDX                         │
│   - hypercore-crypto, sodium-native, rocksdb-native, etc.  │
│   - Packed into a bundle by `pear-end-pack`                │
└────────────────────────────────────────────────────────────┘
```

It doesn't reimplement Bare or the Pear primitives. It packages the request/reply, events, lifecycle, and bundling glue.

## The four parts

### 1. RN runtime wrapper (`src/`)

`src/PearEnd.ts`:
- `PearEnd.start({ bundle, storage, ... })` loads `react-native-bare-kit` through the Metro `require` at call time (so the module imports cleanly under plain Node for tests, and only touches native code on device), instantiates `new Worklet()`, and starts it.
- **Platform bundle handling:** the bundle is passed as **bytes on both platforms**. A string silently no-ops over Android's JNI, and the iOS string path empirically fails to run the worklet too (start() resolves but the worklet JS never executes); bytes are the only path proven to boot on both. `encodeBundle()` uses `TextEncoder` (fine off the hot IPC path).
- Gates on the worklet's `ready` event (`readyTimeoutMs`, default 30s). A boot-error or timeout rejects `start()`.
- Returns a `PearEndHandle`: `rpc.call(command, params)`, `events(channel)` (an `AsyncIterable`), `suspend()`, `teardown()`.

`src/ipc.ts` — the RN side of the RPC:
- A small **synchronous** length-prefixed JSON protocol over `BareKit.IPC`. No async handshake (the `bare-rpc` async handshake can hang over the RN bridge — see TROUBLESHOOTING).
- **Wire format:** `<8-char ASCII-hex length><JSON body>`, where the length counts UTF-16 code units and the body is UTF-8.
  - request: `{ id, cmd, data }`
  - reply: `{ id, result }` (success) or `{ id, error }` (failure; `error` is `{ message, code, name }`)
  - event: `{ event, data }`
- **Codec:** UTF-8 on both sides. The proven source apps use `b4a` (which is UTF-8) and it works fine on the bridge; this SDK hand-rolls the same UTF-8 encode/decode to stay dependency-free **and** to hold back an incomplete trailing multi-byte sequence between native reads (a single per-chunk decode can mis-handle a sequence split across reads). The bytes are identical to what the worklet side's `Buffer.from(...)` produces. The real bug this avoids was a *latin1* decode, not UTF-8.
- Per-request caller-side timeouts (the waiting Promise rejects with `PearEndTimeoutError`; the worklet keeps processing — there is no cancellation primitive). Transient write failures retry with exponential backoff. Oversized/garbled buffers trigger a resync.

Lifecycle is part of the handle, not a separate module: `suspend()` optionally calls a `lock` RPC (when `lockOnBackground` is set) then `worklet.suspend()`; `teardown()` sends a graceful-shutdown RPC, then `worklet.terminate()`, then closes the IPC. You wire these to RN's `AppState`/unmount yourself.

### 2. Worklet helper (`worklet/`)

`worklet/index.mjs` — `defineWorklet({ boot, commands, events, suspend, resume, teardown })`:
- Construct the worklet-side RPC from `BareKit.IPC`, register command handlers, and a built-in graceful-teardown command (`pear-end/teardown`).
- Wire `Bare.on('suspend')` → `IPC.unref()` and `Bare.on('resume')` → `IPC.ref()` (plus your optional hooks), so a backgrounded app lets the process idle.
- Run `boot(ctx)`: `ctx.progress(stage, message)` streams boot-stage events to the RN side (and records the last stage for crash diagnostics); the resolved value becomes the `ready` payload. If `boot()` throws, an error event carrying the last stage is emitted and the RN-side `start()` rejects.
- `emit(channel, payload)` pushes an event to the RN side (also available on `ctx`).

`worklet/worklet-rpc.mjs` — the Bare-side mirror of `src/ipc.ts`:
- Same wire format. Encoding uses Bare's global `Buffer`; decoding uses `chunk.toString()`.
- Retry/backoff on write failures, buffer-overflow recovery, and protocol-error resync — preserved from the production implementation this was ported from.
- No `bare-events` dependency: a tiny built-in listener map keeps the bundled helper dependency-free.

Reserved channels (`pear-end/ready`, `pear-end/error`, `pear-end/boot`) and the `pear-end/teardown` command are shared constants between the two halves.

### 3. Bundle CLI (`bin/pear-end-pack.js`)

- Wraps `bare-pack --linked --host <platform>-arm64 <entry> -o <out>` with sane defaults (`--out`, `--platforms`, `--host` override, `--no-shim`, `--verbose`).
- Writes one bundle per platform (`worklet.android.bundle.mjs`, `worklet.ios.bundle.mjs`). `bare-pack` emits each as a self-contained ES module that `export default`s the bundle source string — so no Metro transformer is needed.
- Generates the Metro platform shims (`worklet-bundle.js` + `worklet-bundle.android.js` / `worklet-bundle.ios.js`), each exporting `{ source, platform }`, so the consumer can `import bundle from './worklet-bundles/worklet-bundle'` and get the right one per OS.
- Validates the worklet entrypoint exists up front and fails clearly if `bare-pack` isn't installed (or honors `PEAR_END_BARE_PACK`).

### 4. Constants (`src/constants.ts`)

- `ARGON2_MEMLIMIT_MOBILE = 64 MB` — avoids OOM on phones with < 2 GB RAM.
- `ARGON2_MEMLIMIT_DESKTOP = 256 MB` — exported so cross-device code can use one named value (Argon2id is deterministic: a passphrase derived with different memlimits yields different keys, so a vault encrypted on one device won't unlock on another — see TROUBLESHOOTING).
- `DEFAULT_RPC_TIMEOUT_MS`, `LONG_RPC_TIMEOUT_MS`, `SYNC_READY_TIMEOUT_MS` — timeout defaults.

## Vendored patches (`patches/`)

Two `patch-package` patches for Bare native-addon issues that otherwise crash the worklet on Android, lifted verbatim from the production apps:

- `device-file+2.3.1.patch` — stops the "Invalid device file, was modified" crash on Android reinstall (inode/mtime mismatch; the FDLock already guarantees single-process exclusivity).
- `fs-native-extensions+1.5.0.patch` — treats `tryLock` `EINVAL` as "acquired" on 32-bit ARM (the advisory lock is redundant for a single-process app).

These are **not** auto-applied — a library shouldn't mutate its consumer's `node_modules` on install. Copy them into your app's `patches/` and run `patch-package` (see TROUBLESHOOTING.md). They're pinned to the addon versions the apps shipped (`device-file@2.3.1`, `fs-native-extensions@1.5.0`); confirm yours match before applying.

## Open questions (ecosystem-level; this SDK documents, does not solve)

### iOS xcframework staging

`react-native-bare-kit` ships its own xcframework via its iOS Pod, but Bare native addons (`udx-native`, `sodium-native`, etc.) ship as separate xcframeworks. The `bare-android`/`bare-ios` examples stage these via `addons.yml + xcodegen` for native-only apps; that doesn't map cleanly onto RN's Pod-based build, and there's no canonical RN mechanism yet. If you've solved this, please open an issue.

### App Store JavaScriptCore policy

Apple historically requires JavaScriptCore for embedded JS; Bare embeds V8 + libuv. Whether Apple accepts this in review is empirically unproven — no known Bare-embedding app has been through review. Budget for it.

### `bare-link` rooting in monorepos

`react-native-bare-kit`'s link step roots `bare-link` at the RN host project's `node_modules`, which can miss addons installed at a workspaces parent. The real fix is a `--root` flag upstream.

## File layout

```
react-native-pear-end/
├── README.md
├── ARCHITECTURE.md         (this file)
├── TROUBLESHOOTING.md
├── CHANGELOG.md
├── LICENSE
├── package.json
├── tsconfig.json
│
├── src/
│   ├── index.ts            (public exports)
│   ├── PearEnd.ts          (main class: Worklet + start + lifecycle handle)
│   ├── ipc.ts              (RN-side sync RPC + UTF-8 codec)
│   ├── constants.ts        (memory + timeout constants)
│   └── types.ts            (TypeScript types + error classes)
│
├── worklet/
│   ├── index.mjs           (defineWorklet API)
│   └── worklet-rpc.mjs     (Bare-side RPC mirror)
│
├── bin/
│   └── pear-end-pack.js    (bare-pack wrapper CLI)
│
├── patches/                (vendored patch-package patches; apply in your app)
│   ├── device-file+2.3.1.patch
│   └── fs-native-extensions+1.5.0.patch
│
├── examples/
└── test/
    └── unit/               (node --test suite)
```
