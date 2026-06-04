# react-native-pear-end

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Status](https://img.shields.io/badge/status-beta-yellow.svg)](#status)
[![Tests](https://img.shields.io/badge/tests-33%2F33-brightgreen.svg)](#testing)

> Run a real Pear backend (Hypercore + Hyperswarm + HyperDHT + Autobase) inside a React Native app. Native UDP via UDX. No WebView. No WSS bridge.

A small, reusable integration layer on top of [Bare](https://github.com/holepunchto/bare) + [`react-native-bare-kit`](https://github.com/holepunchto/react-native-bare-kit). It gives you a typed `PearEnd.start()` on the React Native side, a `defineWorklet()` helper on the Bare side, and a `pear-end-pack` bundler — so the wiring between your app and a Bare worklet is a few lines instead of a multi-week integration.

> **Status: beta.** The integration code here is extracted from two production Pear-on-React-Native apps (PearBrowser + PearPaste) that run on iOS + Android. The extracted layers (RPC, worklet helper, bundle CLI, lifecycle wrapper) build clean and pass a unit suite that exercises the full wire protocol in Node (33/33). What's **not** yet re-verified in this repackaged form is an end-to-end on-device boot — see [Status](#status) for the exact line between what's tested and what isn't. Try it, file issues; don't bet a production ship on it without running the on-device check yourself.

---

## What it does

The runtime story works: a Bare worklet can run the full Pear stack — corestore, hypercore, hyperswarm, hyperdht, autobase — natively inside a React Native app, with real UDP through UDX, no WebView and no websocket bridge. `react-native-bare-kit` makes that possible. The friction is in the glue around it.

This package packages the glue that was figured out the hard way in shipping apps (PearBrowser + PearPaste):

| Friction | What this SDK does about it |
| --- | --- |
| `Worklet.start(string)` silently no-ops — on Android (JNI string-size limit) **and** iOS (worklet never runs); only bytes boot reliably | `PearEnd.start()` passes the bundle as bytes on both platforms |
| `bare-rpc`'s async handshake can hang over the RN BareKit.IPC bridge — worklet runs but `ready` never fires | Ships a small **synchronous** length-prefixed JSON RPC (`src/ipc.ts` ⇄ `worklet/worklet-rpc.mjs`) with no async handshake |
| Getting the IPC byte framing right — a latin1 decode corrupts any non-ASCII payload (accents, CJK, emoji) | A dependency-free **UTF-8** codec is built in and unit-tested: non-ASCII/emoji round-trips, split-read buffering, frame resync |
| Bare native addons crash the worklet on Android (`device-file` mtime on reinstall; `fs-native-extensions` EINVAL on 32-bit ARM) | Ships two vetted `patch-package` patches (`patches/`) you apply in your app |
| `argon2id` OOM-killing the worklet on phones with < 2 GB RAM, and cross-device key mismatches from differing memlimits | Exports `ARGON2_MEMLIMIT_MOBILE`/`ARGON2_MEMLIMIT_DESKTOP` constants and documents the cross-device-determinism constraint |
| Per-platform Metro bundle resolution is tedious-but-mechanical | `pear-end-pack` generates the per-platform bundles (incl. the iOS Simulator host) **and** the Metro shim so you `import bundle from './worklet-bundles/worklet-bundle'` |
| Lifecycle wiring (`AppState` → suspend/resume, graceful teardown) | The handle exposes `suspend()`/`teardown()`; `lockOnBackground` calls a `lock` RPC on suspend; the worklet helper wires `Bare.on('suspend'|'resume')` to `IPC.unref()`/`IPC.ref()` |

What it deliberately does **not** do: it does not ship a custom native module, a Gradle plugin, or an iOS Pod. Native linking is handled by `react-native-bare-kit`'s own autolinking — this package is pure JS/TS on top (plus the two vendored `patch-package` patches above, which you apply in your app). See [Status](#status) for the things that are genuinely still open (iOS xcframework staging, App Store review, monorepo `bare-link` rooting) — those are ecosystem-level and this SDK documents them rather than pretending to solve them.

---

## Install

```sh
npm install react-native-pear-end react-native-bare-kit bare-pack
```

`react-native-bare-kit` is the native runtime embedder and handles its own autolinking — rebuild your dev client / run a native build after installing it. `bare-pack` is the bundler `pear-end-pack` wraps. Both are peer dependencies.

> **Android native-addon patches.** If your worklet pulls in `device-file` / `fs-native-extensions` (most Pear stacks do, transitively), copy this package's `patches/*.patch` into your app's `patches/` and run `patch-package` (e.g. on `postinstall`). They prevent two Android-only worklet crashes — see [TROUBLESHOOTING](./TROUBLESHOOTING.md). They're pinned to `device-file@2.3.1` / `fs-native-extensions@1.5.0`; confirm your versions match.

> No `pod install` step beyond what `react-native-bare-kit` itself requires, and no Gradle plugin to register. If a guide tells you to add `io.pearend.gradle` — that was an earlier, abandoned design; it does not exist.

---

## Usage

### 1. Your Bare worklet

```js
// backend/worklet.mjs — compiled by pear-end-pack, runs inside Bare
import { defineWorklet, emit } from 'react-native-pear-end/worklet'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'

let store, swarm

defineWorklet({
  async boot ({ progress }) {
    const storagePath = Bare.argv[0] || './storage'
    progress('corestore', 'Opening storage…')
    store = new Corestore(storagePath)
    await store.ready()

    progress('swarm', 'Joining the swarm…')
    swarm = new Hyperswarm()
    swarm.on('connection', (conn) => store.replicate(conn))

    return { ok: true } // becomes the `ready` payload on the RN side
  },
  commands: {
    'note:add': async ({ text }) => {
      // ... append to a hypercore ...
      emit('note-added', { text, at: Date.now() })
      return { ok: true }
    }
  },
  events: ['note-added'],
  async teardown () {
    if (swarm) await swarm.destroy()
    if (store) await store.close()
  }
})
```

### 2. Pack it

```sh
npx pear-end-pack backend/worklet.mjs --out app/worklet-bundles
```

This runs `bare-pack --linked` per platform and writes the bundles plus a Metro shim (`worklet-bundle.js` + `worklet-bundle.android.js` / `worklet-bundle.ios.js`).

### 3. Start it from React Native

```ts
// App.tsx
import { PearEnd } from 'react-native-pear-end'
import bundle from './worklet-bundles/worklet-bundle' // generated above
import { Paths } from 'expo-file-system' // or RNFS, etc.

const pear = await PearEnd.start({
  bundle,
  storage: Paths.document.uri.replace('file://', '') + '/myapp',
  lockOnBackground: true,
  onCrash: ({ error, lastBootStage }) =>
    console.error('worklet crashed at', lastBootStage, error)
})

const result = await pear.rpc.call('note:add', { text: 'hello' })

for await (const ev of pear.events('note-added')) {
  updateUI(ev)
}

// later, on AppState → background / unmount:
await pear.suspend()
await pear.teardown()
```

`PearEnd.start()` resolves once your worklet's `boot()` returns (gated by `readyTimeoutMs`, default 30s). Boot `progress(stage, message)` calls stream to the RN side so you can drive a splash; if `boot()` throws, `start()` rejects and `onCrash` fires with the last stage reached.

---

## How this compares to other things

The Holepunch ecosystem has several adjacent packages. What each one is:

| Package | What it is | Targets RN? |
| --- | --- | --- |
| [`bare`](https://github.com/holepunchto/bare) | The JS runtime itself (V8 + libuv) | No (low-level) |
| [`react-native-bare-kit`](https://github.com/holepunchto/react-native-bare-kit) | The RN runtime embedder. **Required dependency.** | Yes (runtime) |
| [`bare-pack`](https://github.com/holepunchto/bare-pack) | Bundle packer. **Required dependency.** | No (build tool) |
| [`bare-expo`](https://github.com/holepunchto/bare-expo) | Example Expo app, inline source string, no real backend | Yes (example) |
| [`bare-android`](https://github.com/holepunchto/bare-android) / [`bare-ios`](https://github.com/holepunchto/bare-ios) | Example native apps | No (native) |
| **`react-native-pear-end`** (this) | Typed RN wrapper + worklet helper + bundle CLI on top of the above | **Yes** |

If you're shipping an RN app with a Bare worklet you need `react-native-bare-kit` and `bare-pack` regardless. This sits on top to make the request/reply, events, lifecycle, and bundling ergonomic.

---

## Status

**Beta — extracted from a production app, unit-tested, not yet re-verified end-to-end on a device in this packaged form.**

Implemented and unit-tested in Node (no native build required):

- **The RPC wire protocol** — length-prefixed JSON over `BareKit.IPC`, byte-for-byte identical on both sides. Tests drive request/reply, worklet→RN events, error propagation with codes, per-request timeouts, concurrent-request id correlation, buffer-overflow/resync, and non-ASCII (accents, CJK, emoji) round-trips.
- **`defineWorklet()` lifecycle** — `boot()` → `progress` stages → `ready`, command dispatch, event emit, `suspend`/`resume`/`teardown`, and the boot-failure → `onCrash` path. Tested against injected `BareKit`/`Bare` globals.
- **Public API surface** — `PearEnd.start`, `PearEndHandle`, `PearEndRpcError`, `PearEndTimeoutError`, options, and the memory constants.
- **`pear-end-pack` CLI** — argument parsing, entrypoint validation, help, and the `bare-pack` invocation shape.
- **Build** — TypeScript compiles clean; **33/33** unit tests pass.

Verified in the apps this was extracted from (PearBrowser + PearPaste — e.g. the worklet boots the full Pear-end on the iOS Simulator in ~240 ms via the bytes path), but **not yet re-verified in this repackaged form** (this is the on-device check the maintainer is running now):

- A real worklet booting `corestore`/`hyperswarm`/`hyperdht` on a physical iOS + Android device.
- The packed bundle → `import` → `Worklet.start()` round trip through Metro on each platform.
- `suspend`/`resume`/`teardown` against the live Bare runtime.

Genuinely open at the ecosystem level (this SDK documents, does not solve — see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)):

- **iOS xcframework staging** for Bare native addons in an RN/Pod build — no canonical mechanism yet.
- **App Store review of a V8-embedding app** — empirically unproven; budget for it.
- **`bare-link` rooting in monorepos/workspaces** — addons installed at a parent `node_modules` may not be staged; a `--root` flag upstream is the real fix.

See [`CHANGELOG.md`](./CHANGELOG.md) for the running list.

---

## Architecture

This package is pure JS/TS. It has four parts and leans on `react-native-bare-kit` (native runtime) and `bare-pack` (bundler) for everything native. Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) for detail.

```
┌─────────────────────────────────────────────────────────────┐
│ Your React Native app (TSX, normal RN UI)                   │
└────────────────────────────┬────────────────────────────────┘
                  PearEnd.start() / pear.rpc.call(...)
┌────────────────────────────▼────────────────────────────────┐
│ react-native-pear-end  (this package — JS/TS only)          │
│   • RN wrapper:  PearEnd.start + sync RPC over BareKit.IPC   │
│   • Worklet helper:  defineWorklet (boot/commands/events)    │
│   • Bundle CLI:  pear-end-pack (bare-pack + Metro shims)     │
│   • Constants:  argon2 memlimits, RPC timeouts              │
└────────────────────────────┬────────────────────────────────┘
              Worklet.start(bytes|string) + BareKit.IPC
┌────────────────────────────▼────────────────────────────────┐
│ react-native-bare-kit  (Holepunch — native runtime)         │
│   V8 + libuv compiled for Android/iOS, autolinked           │
└────────────────────────────┬────────────────────────────────┘
                  loads your packed worklet bundle
┌────────────────────────────▼────────────────────────────────┐
│ Your Bare worklet (your repo, packed by pear-end-pack)      │
│   corestore + hyperswarm + hyperdht over UDX + autobase ... │
└─────────────────────────────────────────────────────────────┘
```

---

## Testing

```sh
npm test          # builds (tsc) then runs the unit suite
npm run test:fast # runs the suite against an existing dist/
```

The suite (33 tests) wires the worklet-side RPC to the RN-side RPC across an in-memory byte bridge that mimics the native duplex, and asserts the exact bytes one side writes are the bytes the other parses. It covers request/reply, events, errors-with-codes, timeouts, concurrency, non-ASCII payloads, the full `defineWorklet` boot→ready→teardown flow, the public API surface, `package.json` validity, and that the CLI loads and validates its input.

What the suite can **not** cover (needs a device — see [Status](#status)): real native boot, Metro bundle resolution, and lifecycle against the live Bare runtime.

---

## Ownership

Independent and community-maintained. It's unofficial — built on top of Holepunch's open-source packages, but not affiliated with or endorsed by them.

---

## Contributing

If you've shipped a Bare-on-mobile integration, your hard-won learnings are exactly what belongs here.

- **Hit a Bare-on-mobile gotcha not in [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)?** Open an issue.
- **Solved one of the open ecosystem questions** (especially iOS xcframework staging)? Please tell us.

---

## Acknowledgments

The integration patterns here are extracted from two production Pear-on-React-Native applications — **PearBrowser** (a P2P mobile browser) and **PearPaste** (encrypted note + clipboard sync) — that run the full stack on iOS + Android. Built entirely on top of [Bare](https://github.com/holepunchto/bare), [`react-native-bare-kit`](https://github.com/holepunchto/react-native-bare-kit), [`bare-pack`](https://github.com/holepunchto/bare-pack), and [`bare-link`](https://github.com/holepunchto/bare-link) by [Holepunch](https://github.com/holepunchto). None of this exists without their runtime work.

---

## License

[Apache-2.0](LICENSE) © 2026 `react-native-pear-end` contributors.

The Pear and Holepunch trademarks are property of Holepunch; this package is not affiliated with Holepunch beyond depending on their open-source packages.
