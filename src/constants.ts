// Empirical defaults the SDK encodes so consumers don't rediscover them.
//
// Each constant below corresponds to a story documented in
// TROUBLESHOOTING.md. Read that before tuning these.

/**
 * Argon2id memlimit for mobile. 64 MB.
 *
 * Required to avoid OOM on phones with < 2 GB RAM. The default sodium
 * MEMLIMIT_MODERATE is 256 MB which the OS will kill on mid-range Android.
 *
 * IMPORTANT: this MUST match the memlimit used on desktop and any other
 * device the same passphrase will be derived against. Argon2id is a
 * deterministic KDF — a passphrase derived with different memlimits
 * produces different keys, which means vaults encrypted on device A
 * cannot be unlocked on device B.
 *
 * Recommendation: use this same value on desktop too (or raise this
 * floor to 128 MB on both if 64 MB has perceptible UX cost). Either
 * way, pick one value and use it everywhere.
 */
export const ARGON2_MEMLIMIT_MOBILE = 64 * 1024 * 1024 // 64 MB

/**
 * Argon2id memlimit for desktop. 256 MB. The libsodium default
 * MEMLIMIT_MODERATE. Exported here so cross-device codepaths can
 * import a single named constant. See `ARGON2_MEMLIMIT_MOBILE` for
 * the cross-device-determinism constraint.
 */
export const ARGON2_MEMLIMIT_DESKTOP = 256 * 1024 * 1024 // 256 MB

/**
 * Recommended default RPC timeout. 30 seconds. Long enough for typical
 * operations including a few network round trips; short enough that a
 * stuck call surfaces a useful error rather than hanging the UI.
 *
 * Override per-command via `PearEndOptions.longRunningTimeouts` for
 * known-long operations (pairing, vault creation, etc).
 */
export const DEFAULT_RPC_TIMEOUT_MS = 30_000

/**
 * Recommended timeout for known-long RPC operations. 120 seconds.
 *
 * Use for commands that involve:
 *   - First-time DHT lookups on a fresh device
 *   - UDX hole punching on cellular networks
 *   - Argon2id key derivation
 *   - Vault creation / restore from seed
 *
 * Empirically: under realistic mobile network conditions, the first
 * DHT lookup + UDX hole punch on a freshly-installed app can take
 * up to 90s. 120s gives margin without being absurdly long.
 */
export const LONG_RPC_TIMEOUT_MS = 120_000

/**
 * Sync engine ready timeout. 15 seconds.
 *
 * Use when waiting for Autobase / corestore to "open + replicate
 * initial state" before issuing the first stateful RPC. On a fresh
 * device this is ~50ms; on a paired device that's replicating an
 * existing vault it can take several seconds. Without a gate, calls
 * may fire before `header.autobaseKey` exists and throw.
 */
export const SYNC_READY_TIMEOUT_MS = 15_000
