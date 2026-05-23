# Architecture

This document describes how `react-native-pear-end` sits between three existing things and what it does to glue them together. Read this if you're trying to understand what's happening under the hood or want to contribute.

## Where this sits

```
┌────────────────────────────────────────────────────────────┐
│ Your React Native app                                      │
│   - UI in TSX / React                                      │
│   - Calls into: PearEnd.start() / pear.rpc.call(...)       │
└─────────────────┬──────────────────────────────────────────┘
                  │  typed RPC
┌─────────────────▼──────────────────────────────────────────┐
│ react-native-pear-end  (this package)                      │
│   - Gradle plugin: runs bare-link at the right root        │
│   - Pods config: stages iOS xcframeworks                   │
│   - JS wrapper: lifecycle, IPC framing, gotchas            │
│   - Patches: 32-bit ARM fixes via patch-package            │
│   - CLI: pear-end-pack wrapping bare-pack                  │
└─────────────────┬──────────────────────────────────────────┘
                  │  consumes
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
│   - Compiled into a bundle by `pear-end-pack`              │
└────────────────────────────────────────────────────────────┘
```

The package doesn't reimplement Bare. It doesn't reimplement Pear primitives. It packages the integration glue so the next team doesn't pay the friction tax.

## Five layers

### 1. Build-system layer (Android Gradle plugin + iOS Pods)

**Android:**
- `android/build.gradle` registers a Gradle plugin
- The plugin runs `bare-link` rooted at the **consumer's repo root** (not bare-kit's host project — the #1 trip-up). Auto-detects workspaces parents with a sensible fallback.
- Stages native `.so` files into `react-native-bare-kit/android/src/main/addons/` for all 4 Android ABIs (`armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`).
- Runs the worklet bundle generation via `pear-end-pack`.
- Wires both as `preBuild` dependencies so the consumer's normal `./gradlew assemble` does the right thing.

**iOS:**
- `ios/PearEnd.podspec` declares the Pod.
- A podspec hook stages xcframeworks into `ios/addons/` (mechanism TBD — see Open Questions below).
- A Pod build phase runs `pear-end-pack` to generate the iOS worklet bundle.

### 2. Bundle pipeline layer (CLI)

`pear-end-pack`:
- Wraps `bare-pack --linked` with sane defaults
- Generates per-platform bundles (`worklet.android.bundle.js`, `worklet.ios.bundle.js`)
- Generates Metro platform-shim files (`worklet-bundle.android.js`, `worklet-bundle.ios.js`) so the consumer can `import bundle from './worklet-bundle'` and get the right per-ABI bundle without thinking about it.
- Validates the consumer's worklet entry exists.

### 3. JS runtime wrapper layer (React Native side)

`src/PearEnd.ts`:
- `PearEnd.start({ bundle, storage, ... })` — instantiates `new Worklet()` from `react-native-bare-kit`, encodes the bundle bytes (TextEncoder on Android, see TROUBLESHOOTING), calls `worklet.start(...)`, sets up IPC framing.
- `pear.rpc.call(command, params)` — sync-style request/response over BareKit.IPC. Returns a typed Promise.
- `pear.events(channel)` — AsyncIterable of streamed backend events.
- `pear.suspend()` / `pear.teardown()` — lifecycle hooks tied to RN's AppState. Calls into the worklet's `Bare.on('suspend')` / `Bare.on('teardown')` handlers.

`src/ipc.ts`:
- Sync RPC over `BareKit.IPC`. Async handshake variants hang on RN in some configurations (see TROUBLESHOOTING) — we use synchronous channel construction.
- Message envelope: `{ type: 'call'|'reply'|'error'|'event', id, command?, params?, data?, message?, code? }`
- No cancellation primitive (caller-side timeouts terminate the waiting Promise, but the worklet keeps processing).
- No backpressure (assumes JSON messages fit; revisit if you hit big-response problems).

`src/lifecycle.ts`:
- Subscribes to RN's `AppState` and forwards transitions into the worklet.
- Configurable `lockOnBackground` calls an RPC method on background.
- Handles uncaught crash signals from the worklet (captures last `'boot'` stage so the error surface shows which subsystem was running).

### 4. Worklet helper layer (Bare side)

`worklet/index.mjs`:
- `defineWorklet({ commands, events })` — declarative API for the consumer's worklet entrypoint.
- Wires up the matching side of `worklet-rpc.mjs` automatically.
- Exposes `Bare.on('suspend')` / `Bare.on('teardown')` hooks the consumer can register against.

`worklet/worklet-rpc.mjs`:
- The Bare-side mirror of `src/ipc.ts`.
- Synchronous handshake construction (per the RN gotcha — see TROUBLESHOOTING).
- Boot lifecycle: emits `'boot'` stage events during initialization, then `'ready'` when the worklet is operational.

### 5. Patches + memory tuning layer

`patches/`:
- `fs-native-extensions+1.5.0.patch` — EINVAL from `flock` on 32-bit ARM kernels ≥5.10 with the compat layer (will be upstreamed)
- `device-file+2.3.1.patch` — inode/mtime check fails on Android reinstall because the package manager bumps mtime via atomic rename (will be upstreamed)

`postinstall.js`:
- Runs `patch-package` to apply the vendored patches on `npm install`
- Verifies `react-native-bare-kit` version is compatible (warns on mismatch)

`src/constants.ts`:
- `ARGON2_MEMLIMIT_MOBILE = 64 * 1024 * 1024` — INTERACTIVE-level memlimit; required to avoid OOM on phones with <2 GB RAM
- `ARGON2_MEMLIMIT_DESKTOP = 256 * 1024 * 1024` — exported for cross-device key derivation symmetry
- See TROUBLESHOOTING for why these must match across desktop + mobile or vaults won't unlock cross-device

## Open questions

### iOS xcframework staging

`react-native-bare-kit` ships its own xcframework via the iOS Pod, but Bare native addons (`udx-native`, `sodium-native`, etc.) ship as separate xcframeworks that need to be staged into `ios/addons/`. Currently no documented mechanism exists for this in the RN context — `bare-android`/`bare-ios` examples show the pattern for native-only apps using `addons.yml + xcodegen`, but that doesn't map cleanly to RN's Pod-based build.

**Options under investigation:**

1. Build a separate Pod that depends on the addon Pods, vendoring xcframeworks in `node_modules/<addon>/ios/<name>.xcframework`
2. An iOS equivalent of `bare-link` that generates xcframeworks from prebuilds at install time
3. A `postinstall` hook that downloads prebuilt xcframeworks from a GitHub Release URL
4. CocoaPods native plugin that resolves `bare-addon`-style dependencies from npm

This is the largest open question. Tracking in [issue TBD]() until we have a concrete answer.

### App Store JavaScriptCore concern

Apple historically requires apps to use JavaScriptCore for embedded JS. Bare embeds V8 + libuv via `libbare-kit.so` / `BareKit.xcframework`. Whether Apple accepts this in App Store review is empirically unproven by us — the reference integration hasn't been through review yet. Open question.

## Versioning

- This package's version tracks `react-native-bare-kit`'s major version compatibility
- We pin upstream patches to specific dependency versions. When upstream releases a fix, we remove the patch and bump the peer-dep range.
- Patches are temporary by design — goal is zero vendored patches within 6 months.

## File layout

```
react-native-pear-end/
├── README.md
├── ARCHITECTURE.md         (this file)
├── TROUBLESHOOTING.md
├── CHANGELOG.md
├── LICENSE
├── package.json
├── postinstall.js
│
├── android/
│   ├── build.gradle
│   └── src/main/{groovy,java}/io/pearend/gradle/PearEndPlugin.*
│
├── ios/
│   ├── PearEnd.podspec
│   └── PearEnd/PearEnd.swift
│
├── src/
│   ├── index.ts            (public exports)
│   ├── PearEnd.ts          (main class)
│   ├── ipc.ts              (sync RPC)
│   ├── lifecycle.ts        (AppState wiring)
│   ├── constants.ts        (memory tuning, etc.)
│   └── types.ts            (TypeScript types)
│
├── worklet/
│   ├── index.mjs           (defineWorklet API)
│   └── worklet-rpc.mjs     (Bare-side RPC mirror)
│
├── bin/
│   └── pear-end-pack.js    (bare-pack wrapper CLI)
│
├── patches/                (vendored upstream patches)
│   ├── fs-native-extensions+1.5.0.patch  (TBD on arrival)
│   └── device-file+2.3.1.patch           (TBD on arrival)
│
├── examples/               (sample apps)
└── test/                   (unit + integration tests)
```
