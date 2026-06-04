# Troubleshooting

Known issues, gotchas, and empirical learnings encoded as defaults in the SDK so you don't lose a day rediscovering them.

If you hit a problem not covered here, open an issue. Each entry below was a real story before it became a default.

## Build-time issues

### "Cannot find addon '.' imported from 'udx-native/binding.js'"

**Symptom:** Worklet aborts at boot. Stack ends in libc abort.

**Cause:** `react-native-bare-kit`'s stock `android/link.mjs` roots its `bare-link` invocation at the RN host project's `node_modules` (not the workspaces/monorepo parent). For any app whose Bare backend deps are installed at a parent `node_modules`, the addons aren't staged into bare-kit's `src/main/addons/` directory and the worklet can't resolve them at runtime.

**Fix:** This SDK's Gradle plugin (`io.pearend.gradle`) re-runs `bare-link` rooted at the consumer's actual repo root (with workspaces parent auto-detection). If you're not using our plugin, you'd need to add a custom `pearpasteLinkBareAddons`-style Gradle task that calls `bare-link` from the right directory.

**Upstream:** We're proposing a `--root` flag for `link.mjs`. See [link to PR when filed].

### "rsync: ... bare-abort.X.X.X.xcframework: No such file or directory" (iOS)

**Symptom:** iOS build fails during Pod "Copy XCFrameworks" phase after a clean `npm install`.

**Cause:** Bare native addon xcframeworks aren't installed deterministically by `npm install` — they're assumed to already exist in `node_modules/react-native-bare-kit/ios/addons/`. After a clean install they're gone, and there's no install hook to regenerate them.

**Fix:** SDK provides an `ios/addons/` staging mechanism via the Pod (mechanism still being finalized — see ARCHITECTURE Open Questions). Until then: keep a backup copy of the xcframeworks from a known-working install and rsync them back after `npm install`.

**Upstream:** Coordinating with Holepunch on the canonical answer.

## Runtime issues

### "Worklet.start no-op silently on Android" — splash hangs forever

**Symptom:** Android app shows splash indefinitely. iOS works fine.

**Cause:** `Worklet.start(bundleString)` accepts a string on iOS but silently no-ops on Android — it requires bytes. No error, no log, just nothing happens.

**Fix:** `PearEnd.start()` calls `new TextEncoder().encode(bundleString)` before passing to `Worklet.start()`. If you're not using `PearEnd.start()`, always pass bytes:

```js
worklet.start('/app.bundle', new TextEncoder().encode(bundleSource))
```

**Upstream:** Filing as an issue against `react-native-bare-kit` — either fix the no-op or fail loudly with a clear error.

### "UNSUPPORTED_PROTOCOL" from `import('./module.js')`

**Symptom:** Worklet crashes at boot with `UNSUPPORTED_PROTOCOL`.

**Cause:** Bare's `pear://` module loader rejects relative dynamic imports. Common Node pattern of `import('./subsystem.js')` for lazy-loading doesn't transfer.

**Fix:** Convert dynamic imports to static. Each subsystem module is statically imported at the top of your worklet entrypoint; the array references the bindings, not the specifiers.

```js
// Doesn't work in Bare:
const SUBSYSTEMS = ['./vault.js', './sync.js']
for (const path of SUBSYSTEMS) await import(path)

// Works:
import { vault } from './vault.js'
import { sync } from './sync.js'
const SUBSYSTEMS = [vault, sync]
```

This is a Bare runtime limitation, not a bug. Documenting prominently.

### argon2id OOM on phones with <2 GB RAM

**Symptom:** Worklet killed by OS during `CREATE_VAULT` / `UNLOCK_VAULT` / any argon2id-using operation.

**Cause:** Default sodium `MEMLIMIT_MODERATE` is 256 MB. On a phone with 1.9 GB total RAM, after Android services + the RN side + Bare's V8 heap, there's nowhere near 256 MB free. OS kills the process.

**Fix:** Use `MEMLIMIT_INTERACTIVE` (64 MB) on mobile. SDK exports `ARGON2_MEMLIMIT_MOBILE` constant. **Important cross-device-determinism constraint:** if your desktop build uses `MODERATE` and your mobile build uses `INTERACTIVE`, the same passphrase derives DIFFERENT keys on the two devices. Vault encrypted on desktop can't be unlocked on mobile (and vice versa).

**Recommendation:** Use the same memlimit everywhere. SDK also exports `ARGON2_MEMLIMIT_DESKTOP` to help you adopt 64 MB on both, or upgrade your mobile floor to 128 MB if 64 MB has a perceptible UX cost.

```ts
import { ARGON2_MEMLIMIT_MOBILE } from 'react-native-pear-end/constants'

const key = await argon2id(passphrase, salt, {
  memlimit: ARGON2_MEMLIMIT_MOBILE,
  opslimit: 3,
  // ... must match desktop
})
```

### "Invalid device file, was modified" on Android reinstall

**Symptom:** Worklet crashes at boot with this error after any APK reinstall (without `pm clear` between installs).

**Cause:** Android's package manager bumps file mtime via atomic rename on every reinstall, even when content is unchanged (new inode + new mtime). The `device-file` library stores the original inode + mtime in a sidecar and refuses to open if they don't match.

**Fix:** SDK ships a vendored patch that no-ops the inode/mtime check. Cryptographic integrity guards downstream (encrypted vault + signed device records) are the real authority — the inode/mtime check was overzealous.

**Upstream:** We'll be filing a PR against `device-file` to either relax the check or make it opt-in. The patch is shipped as a stopgap.

### "tryLock returned EINVAL" on 32-bit ARM

**Symptom:** Worklet aborts on first boot on 32-bit ARM Android devices (`armeabi-v7a`).

**Cause:** `fs-native-extensions/binding.c` calls `flock()` with a standard struct. On 32-bit ARM running newer Android kernels (≥5.10), the syscall path goes through a 64-bit-compat ioctl layer that returns EINVAL even when the lock is acquired.

**Fix:** SDK ships a vendored patch that treats EINVAL as success. The downstream RocksDB has its own lockfile that's the real guard — `fs-native-extensions` is advisory.

**Upstream:** PR against `fs-native-extensions` planned. Patch is a stopgap.

### `bare-rpc` async handshake hangs on RN

**Symptom:** Worklet starts but the RN side never gets a `'ready'` event. App splash forever.

**Cause:** `bare-rpc`'s default async handshake never completes over the RN BareKit.IPC bridge. Reason unknown — actively investigating.

**Fix:** SDK uses a custom **synchronous** RPC implementation in `src/ipc.ts` + `worklet/worklet-rpc.mjs`. Constructor returns immediately, handlers gate on `bootErr`/`ready` state, no async handshake required.

**Upstream:** Filing an issue against `bare-rpc` for the RN-specific hang.

## Lifecycle issues

### Worklet keeps running when app is backgrounded

**Symptom:** Battery drain when app is in background; user expects swarm to disconnect.

**Cause:** `react-native-bare-kit` doesn't auto-suspend the Bare runtime when the RN side backgrounds. The OS scheduling will eventually throttle it but it's not instant.

**Fix:** SDK wires `AppState` transitions to the worklet's `Bare.on('suspend')` hook. By default this is a no-op so existing behavior is preserved. If your app should disconnect/clear-state on background, opt in:

```ts
const pear = await PearEnd.start({
  bundle,
  storage,
  lockOnBackground: true,  // calls a 'lock' RPC method on AppState→background
})
```

For chat-like apps that want to stay online, leave it false and consider running a foreground service (Android) or background-mode entitlement (iOS).

### Background restrictions throttle the swarm

**Symptom:** Worklet runs but Hyperswarm peer discoveries stop happening when app backgrounds.

**Cause:** Android Doze mode + iOS background-app refresh limits. The OS will aggressively throttle UDP after a few seconds of background.

**Fix:** This is platform-level, not something the SDK can fix. Three patterns:

1. **Notes-app pattern:** accept disconnection on background, reconnect on resume. ~5-10s warmup back to "swarm joined".
2. **Foreground service (Android):** declare a foreground service so Android keeps the process alive. Costs a persistent notification + battery, but reliable.
3. **Background-mode entitlement (iOS):** declare appropriate background modes in `Info.plist` (`audio`, `voip`, `fetch`). Apple may reject the app at review if the entitlement doesn't match the app's actual purpose.

SDK doesn't pick for you; document your app's requirements and pick accordingly.

## Performance + sizing

### APK size — ~50-200 MB depending on ABI splits

**Symptom:** Sticker shock at unsigned APK size.

**Cause:** `libbare-kit.so` is ~50 MB per ABI (V8 + libuv compiled in). Native Bare addons add ~10 MB per ABI. Multi-ABI universal APK = ~200 MB just for the Bare side.

**Fix:** Enable Android ABI splits in your Gradle config:

```groovy
android {
  splits {
    abi {
      enable true
      reset()
      include 'armeabi-v7a', 'arm64-v8a', 'x86_64'
      universalApk false
    }
  }
}
```

User download per-device drops to ~60-80 MB. Play Store does this automatically for Bundle uploads.

### Startup time

Expected cold-start on lower-end Android (1.9 GB RAM, armeabi-v7a):
- Splash → worklet `'ready'`: ~5-8s
- `'ready'` → first peer connected: ~5-8s
- Total cold start to operational: ~12-20s

iPhone simulator (arm64, ample resources): ~5-11s total.

If you're seeing significantly worse, check: APK size + ABI splits, RocksDB cache size (RocksDB does an initial scan that's slower on big stores), argon2id memlimit (lower memlimit = faster start at cost of weaker key).

## Submission concerns

### Apple App Store JavaScriptCore policy

**Status:** unknown.

Apple historically requires apps that execute JavaScript to use JavaScriptCore. Bare embeds V8 + libuv via `libbare-kit.so` / `BareKit.xcframework`. We do not have empirical signal on whether Apple accepts this in review. No known Bare-embedding app has been through App Store review yet.

If you're shipping to App Store: budget for the possibility of rejection on this ground and have a fallback plan. If your app is rejected and you find a workaround (entitlement, justification language, framework configuration), please file an issue here so we can document.

### Google Play Store

Should be straightforward. Google doesn't have an equivalent JS-engine restriction. The main concern is the APK size (use Bundle + dynamic delivery for best UX).

---

## Filing a bug

When opening an issue, please include:

1. Platform (Android/iOS) + OS version + device model
2. Architecture (armeabi-v7a / arm64-v8a / iOS simulator / iOS device)
3. `react-native-pear-end` version
4. `react-native-bare-kit` version
5. Worklet bundle size (from `pear-end-pack --verbose`)
6. The crash signature (stack trace, error code, last log line if no error)
7. Whether the problem reproduces on a clean `npm install`

The first six let us bisect quickly. The seventh distinguishes a real bug from an environmental glitch.
