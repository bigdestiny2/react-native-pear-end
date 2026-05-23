// PearEnd.swift — iOS lifecycle bridge.
//
// STATUS: SKELETON. The lifecycle wiring (AppState → suspend/teardown,
// boot stage events) will be filled in when the reference integration's
// handover arrives.

import Foundation

// TODO(handover): wire AppState transitions into the worklet via the
// RN bridge. iOS-side details TBD pending reference integration's
// MobilePearEnd equivalent.
//
// Sketch:
//   - Listen for UIApplication.didEnterBackgroundNotification
//   - Forward "backgrounded" event into the worklet's BareKit.IPC channel
//   - On UIApplication.willTerminateNotification, await worklet teardown

@objc(PearEnd)
public class PearEnd: NSObject {
  // Placeholder for the eventual RN module interface.
}
