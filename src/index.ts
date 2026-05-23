// Public entry point for react-native-pear-end.
//
// Consumers import from here:
//
//   import { PearEnd } from 'react-native-pear-end'
//   import { ARGON2_MEMLIMIT_MOBILE } from 'react-native-pear-end/constants'

export { PearEnd } from './PearEnd.js'
export type {
  PearEndOptions,
  PearEndHandle,
  WorkletBundle
} from './types.js'
export { PearEndRpcError, PearEndTimeoutError } from './types.js'

// Constants are re-exported on this surface for convenience, but the
// canonical import path is `react-native-pear-end/constants` so apps
// that only need the memory defaults (e.g. a shared crypto helper used
// on both desktop + mobile) don't pull in the whole runtime wrapper.
export {
  ARGON2_MEMLIMIT_MOBILE,
  ARGON2_MEMLIMIT_DESKTOP,
  DEFAULT_RPC_TIMEOUT_MS,
  LONG_RPC_TIMEOUT_MS,
  SYNC_READY_TIMEOUT_MS
} from './constants.js'
