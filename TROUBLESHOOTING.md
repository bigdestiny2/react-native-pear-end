# Troubleshooting

Known issues, gotchas, and empirical learnings from running a Bare worklet inside React Native. Each entry is tagged:

- **SDK handles this** — `react-native-pear-end` does it for you.
- **You handle this** — the SDK only documents it; the fix is on your side or upstream.

If you hit something not covered here, open an issue.

## Build-time issues

### "Cannot find addon '.' imported from 'udx-native/binding.js'"  — *You handle this*

**Symptom:** Worklet aborts at boot; stack ends in a libc abort.

**Cause:** `react-native-bare-kit`'s link step roots its `bare-link` invocation at the RN host project's `node_modules`, not a workspaces/monorepo parent. If your Bare backend deps live at a parent `node_modules`, the native addons aren't staged into bare-kit's `src/main/addons/` and the worklet can't resolve them at runtime.

**Fix:** Install your worklet's native deps where bare-kit's linker looks, or add a build step that re-runs `bare-link` rooted at your actual repo root. This SDK does **not** ship a Gradle plugin to do this (an earlier design did; it was removed). The real fix is a `--root` flag in `react-native-bare-kit`'s link step — worth filing upstream.

### "rsync: ... bare-abort.X.X.X.xcframework: No such file or directory" (iOS)  — *You handle this*

**Symptom:** iOS build fails during the Pod "Copy XCFrameworks" phase after a clean `npm install`.

**Cause:** Bare native-addon xcframeworks aren't installed deterministically by `npm install` — they're assumed to already exist under `node_modules/react-native-bare-kit/ios/addons/`. After a clean install they can be missing, with no install hook to regenerate them.

**Fix:** There is no canonical RN mechanism for this yet (see ARCHITECTURE → Open questions). Practical stopgap: keep a copy of the xcframeworks from a known-good install and restore them after `npm install`. If you've built a clean solution, please open an issue.

## Runtime issues

### `Worklet.start(string)` silently no-ops — splash hangs forever  — *SDK handles this*

**Symptom:** The splash hangs indefinitely; `start()` resolves quickly but the worklet JS never runs. No error, no log.

**Cause:** `Worklet.start()` routes a **string** through `startUTF8` and a **Uint8Array** through `startBytes`. The string path silently no-ops on Android (a JNI string-size limit on a multi-MB bundle) **and** empirically fails on iOS too (the worklet never executes). Only the bytes path is reliable on both. (Verified on the iOS Simulator: string → worklet never runs; bytes → full Pear-end boot in ~240 ms.)

**Fix:** `PearEnd.start()` passes the bundle as **bytes on both platforms**. If you call `Worklet.start()` yourself, always pass bytes:

```js
worklet.start('/app.bundle', new TextEncoder().encode(bundleSource), [storage])
```

### Infinite splash from a default import of `@dr.pogodin/react-native-fs`  — *You handle this*

**Symptom:** The worklet never starts; the splash hangs forever — but there's no worklet error. The failure is on the RN side, before `Worklet.start()` is even called.

**Cause:** `@dr.pogodin/react-native-fs` v2 has **no default export** — only named exports (`DocumentDirectoryPath`, `writeFile`, …). `import RNFS from '@dr.pogodin/react-native-fs'` yields `undefined`, so `RNFS.DocumentDirectoryPath` throws on the first line of your start path. If a `.catch(() => {})` around your boot promise swallows it, you get an infinite splash with no visible cause.

**Fix:** Use a namespace import for the storage path you pass to `PearEnd.start({ storage })`:

```js
import * as RNFS from '@dr.pogodin/react-native-fs'
const storage = RNFS.DocumentDirectoryPath + '/myapp'
```

An upstream packaging characteristic, not a bug in this SDK — but it cost a real day of "iOS + Android both hang," so it's documented here.

### IPC messages corrupt on non-ASCII payloads  — *SDK handles this*

**Symptom:** RPC works for plain-ASCII payloads but a message containing accents, CJK, an em dash, or an emoji is silently dropped or mis-parsed.

**Cause:** The length-prefixed framing counts UTF-16 code units while the body crosses the bridge as UTF-8 bytes. A naive latin1 decode on the RN side (`String.fromCharCode` per byte) turns one multi-byte character into several, desyncing the frame so `JSON.parse` fails and the message is dropped.

**Fix:** Decode the body as **UTF-8**, not latin1. The proven source apps do this with `b4a` (`b4a.from` / `b4a.toString`, which is UTF-8) and it works fine on the bridge. This SDK instead hand-rolls the same UTF-8 encode/decode for two reasons: zero runtime deps on the RN side, and the decoder holds back an incomplete trailing multi-byte sequence between native reads (a single per-chunk decode can mis-handle a sequence split across two reads). It produces the exact bytes the worklet side's `Buffer.from(...)` does; non-ASCII — accents, CJK, em dash, astral-plane emoji via surrogate pairs — round-trips losslessly. Covered by a unit test.

### `bare-rpc` async handshake hangs on RN  — *SDK handles this*

**Symptom:** The worklet starts but the RN side never gets a `ready` event. Splash forever.

**Cause:** `bare-rpc`'s default async handshake may not complete over the RN `BareKit.IPC` bridge.

**Fix:** This SDK uses a small **synchronous** length-prefixed JSON RPC (`src/ipc.ts` ⇄ `worklet/worklet-rpc.mjs`). Constructors return immediately; there's no async handshake to stall. `PearEnd.start()` instead gates on the worklet emitting `ready` from its `boot()`.

### "UNSUPPORTED_PROTOCOL" from `import('./module.js')`  — *You handle this*

**Symptom:** Worklet crashes at boot with `UNSUPPORTED_PROTOCOL`.

**Cause:** Bare's module loader rejects relative **dynamic** imports. The common Node pattern of `import('./subsystem.js')` for lazy-loading doesn't transfer.

**Fix:** Use static imports in your worklet entrypoint and reference the bindings, not specifier strings:

```js
// Doesn't work in Bare:
const SUBSYSTEMS = ['./vault.js', './sync.js']
for (const path of SUBSYSTEMS) await import(path)

// Works:
import { vault } from './vault.js'
import { sync } from './sync.js'
const SUBSYSTEMS = [vault, sync]
```

This is a Bare runtime characteristic, not a bug in this SDK.

### argon2id OOM on phones with < 2 GB RAM  — *SDK handles this (constants) / You handle this (usage)*

**Symptom:** Worklet killed by the OS during any argon2id-using operation (vault create/unlock).

**Cause:** Sodium's `MEMLIMIT_MODERATE` is 256 MB. On a ~1.9 GB-RAM phone, after Android services + the RN side + Bare's V8 heap, there isn't 256 MB free, so the OS kills the process.

**Fix:** Use a 64 MB memlimit on mobile. The SDK exports the constant; you apply it in your worklet's crypto:

```ts
import { ARGON2_MEMLIMIT_MOBILE } from 'react-native-pear-end/constants'

const key = await argon2id(passphrase, salt, {
  memlimit: ARGON2_MEMLIMIT_MOBILE,
  opslimit: 3
  // ... must match every other device the same passphrase is used on
})
```

**Cross-device-determinism constraint:** Argon2id is deterministic. If desktop uses `MODERATE` and mobile uses 64 MB, the same passphrase derives **different** keys — a vault encrypted on one won't unlock on the other. Pick one memlimit and use it everywhere (`ARGON2_MEMLIMIT_DESKTOP` is exported to help you standardize).

### "Invalid device file, was modified" on Android reinstall  — *SDK ships a patch*

**Symptom:** Worklet crashes at boot with this error after an APK reinstall (without `pm clear` between installs).

**Cause:** Android's package manager bumps file mtime via atomic rename on reinstall (new inode + new mtime), and the `device-file` library refuses to open when its stored inode/mtime don't match.

**Fix:** This SDK **ships a `patch-package` patch**: [`patches/device-file+2.3.1.patch`](./patches/device-file+2.3.1.patch). It treats the inode/mtime mismatch as a recoverable post-dirty-shutdown state — the FDLock above already guarantees single-process exclusivity, so there's no "another process modified this" race on mobile. Copy it into your app's `patches/` directory and run `patch-package` (most RN apps already run it on `postinstall`). For a quick dev loop without the patch, `adb shell pm clear <pkg>` between reinstalls also avoids it.

### "tryLock returned EINVAL" on 32-bit ARM  — *SDK ships a patch*

**Symptom:** Worklet aborts on first boot on 32-bit ARM Android (`armeabi-v7a`).

**Cause:** `fs-native-extensions` calls `flock()` in a way that can return EINVAL through the 64-bit-compat layer on newer Android kernels (≥ 5.10), even when the lock is acquired.

**Fix:** This SDK **ships a `patch-package` patch**: [`patches/fs-native-extensions+1.5.0.patch`](./patches/fs-native-extensions+1.5.0.patch). It treats `EINVAL` from `tryLock` as "lock acquired" on 32-bit Android — the advisory lock is redundant for a single-process app whose data lives in its private files dir, and the real guard is downstream. Copy it into your app's `patches/` and run `patch-package`. Alternatively, drop the `armeabi-v7a` ABI.

## Lifecycle

### Worklet keeps running when the app is backgrounded  — *SDK provides the hook; you wire it*

**Symptom:** Battery drain in the background; you expected the swarm to quiet down.

**Cause:** `react-native-bare-kit` doesn't auto-suspend the Bare runtime when RN backgrounds.

**Fix:** The handle exposes `suspend()` and `teardown()`. Wire them to RN's `AppState` yourself:

```ts
import { AppState } from 'react-native'

const pear = await PearEnd.start({ bundle, storage, lockOnBackground: true })

AppState.addEventListener('change', (s) => {
  if (s === 'background') pear.suspend() // unrefs IPC; calls a `lock` RPC if lockOnBackground
})
```

On the worklet side, `defineWorklet` already wires `Bare.on('suspend')` → `IPC.unref()` and `Bare.on('resume')` → `IPC.ref()`, plus your optional `suspend`/`resume` hooks. Leave `lockOnBackground` off for chat-like apps that should stay online.

### Background restrictions throttle the swarm  — *You handle this*

**Symptom:** Hyperswarm peer discovery stops a few seconds after backgrounding.

**Cause:** Android Doze + iOS background-refresh limits aggressively throttle UDP.

**Fix:** Platform-level; the SDK can't change it. Pick a pattern: accept disconnection and reconnect on resume (~5–10s warmup); run an Android foreground service (persistent notification, reliable); or declare iOS background modes (Apple may reject if they don't match the app's purpose).

## Performance + sizing

### APK size — ~50–200 MB depending on ABI splits  — *You handle this*

**Cause:** `libbare-kit.so` is ~50 MB per ABI (V8 + libuv); native addons add ~10 MB per ABI. A universal multi-ABI APK is large.

**Fix:** Enable ABI splits so each device downloads one ABI (~60–80 MB), or upload an Android App Bundle and let Play split it:

```groovy
android { splits { abi { enable true; reset(); include 'arm64-v8a', 'armeabi-v7a', 'x86_64'; universalApk false } } }
```

### Startup time

Cold-start figures observed in the source application (lower-end Android, ~1.9 GB RAM, `armeabi-v7a`):
- splash → worklet `ready`: ~5–8s
- `ready` → first peer connected: ~5–8s

iOS simulator (arm64, ample resources): noticeably faster. If you're much worse, check APK size/ABI splits, RocksDB store size (initial scan), and argon2id memlimit. Treat these as ballpark, not guarantees — measure on your own stack.

## Submission concerns

### Apple App Store JavaScriptCore policy  — *Unknown*

Apple historically requires apps executing JS to use JavaScriptCore. Bare embeds V8 + libuv. There is no empirical signal yet on whether Apple accepts this in review — no known Bare-embedding app has shipped. Budget for the possibility of rejection and have a fallback. If you get a signal either way, please open an issue.

### Google Play Store

No equivalent JS-engine restriction. The main concern is size — prefer an App Bundle.

---

## Filing a bug

Please include:

1. Platform (Android/iOS) + OS version + device model
2. Architecture (`armeabi-v7a` / `arm64-v8a` / iOS simulator / iOS device)
3. `react-native-pear-end` version
4. `react-native-bare-kit` version
5. Worklet bundle size (`pear-end-pack --verbose`)
6. The crash signature (stack trace, error code, last log line if no error)
7. Whether it reproduces on a clean `npm install`
