# Examples

No example app ships in this beta yet.

The runnable reference today is the **unit suite** (`test/unit/`, run with
`npm test`): it exercises the RPC protocol end-to-end over a byte-accurate
fake IPC bridge, plus the `defineWorklet` boot/ready/teardown lifecycle.
For API usage, see the snippets in the top-level `README.md` (worklet side
via `defineWorklet`, packing via `pear-end-pack`, RN side via
`PearEnd.start`).

## Planned

These are sketches of what the example apps will demonstrate, not shipped
code. They'll land once the on-device path is re-verified in this packaged
form (see the Status section of the top-level README).

### `notes-demo/`

A minimal P2P notes app — text-only, single-user, persistent corestore,
swarm-replicated via hyperswarm. Would demonstrate:

- `PearEnd.start()` boot flow
- Command-style RPC (`note:add`, `note:list`)
- Event channels (`note-added` streamed to the RN side)
- Background suspend wired to `AppState`

### `pairing-demo/`

A second sample showing a pair-up flow between two devices:

- Generate a pairing invite on device A
- Scan + accept on device B
- Establish an encrypted channel over the swarm

The SDK is transport- and relay-agnostic; any pairing/relay strategy is
the app's choice, not something this package prescribes.

---

If you build an integration on top of `react-native-pear-end` and want it
linked here as a reference, please open an issue or PR.
