# Examples

Sample apps demonstrating `react-native-pear-end` integration.

## Planned

### `notes-demo/`

A minimal P2P notes app — text-only, single-user, persistent corestore,
swarm-replicated via hyperswarm. Demonstrates:

- `PearEnd.start()` boot flow
- Command-style RPC (`note:add`, `note:list`)
- Event channels (`note-added` streamed to RN side)
- Background suspend with vault re-lock

Will land alongside the first beta release.

### `pairing-demo/`

A second sample showing the pair-up flow between two devices:

- Generate pairing invite on device A
- Scan + accept on device B
- Establish encrypted channel via UDX direct
- Fall back to relay tunnel when direct fails (uses a HiveRelay node as
  the tunnel — but this is optional; the SDK itself is relay-agnostic)

Will land after notes-demo proves out and we have a real reference user
on `react-native-pear-end` beyond the original integration team.

## Why these examples don't exist yet

The SDK skeleton is currently awaiting a handover bundle from the reference
integration team. Once their materials arrive, the first sample app will be a
forked + stripped version of theirs proving the SDK works end-to-end, then
the demos above will be built from scratch as cleaner reference points.
