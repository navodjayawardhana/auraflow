# 6. Native pose estimation, and the end of Expo Go

Date: 2026-08-22

## Status

Accepted. Reverses the Expo Go constraint that [ADR 0001](0001-on-device-logistic-regression.md)
deliberately protected.

## Context

The brief names extended reality as an expected discussion point, and the rubric pays for
originality and for advanced sensor use. The feature chosen is a **recovery-gated,
camera-guided movement session**: the recovery score decides *what* to do, pose landmarks
measure *how* it is being done, and the IoT node's heart rate says whether the body agrees.

ADR 0001 chose a TypeScript port of the focus model partly because it needed no native
module, and so kept the app running in Expo Go. Pose estimation cannot make the same
choice — reading landmarks from a camera frame requires a real inference runtime and a real
camera, both of which are native.

So this decision is not "native or not". It is which native stack, and the answer was
forced by a version constraint that took some finding.

### The frame-processor route is closed on this project

The obvious stack is `react-native-vision-camera` with a frame processor. It does not work
here:

- VisionCamera **4.x** peer-depends on `react-native-worklets-core`, whose Android package
  collides with the `react-native-worklets` that Reanimated 4 requires — two classes named
  `WorkletsPackage`, and the build fails.
- VisionCamera **5.x** removed that dependency by moving to Nitro Modules, but its frame
  processors now require `react-native-worklets` **≥ 0.8**.
- This project is Expo SDK 54 / React Native 0.81.5, and Reanimated 4.1.1 pins
  `react-native-worklets` to **0.5.1**. Worklets 0.12 declares support for React Native
  0.83–0.87 only.

The pin cannot move without leaving SDK 54, and leaving SDK 54 is a much larger change than
this feature is worth with the time remaining. **Frame processors are therefore
unavailable, whichever camera library is chosen.**

### What that rules in

Without frame processors the camera can still be read the ordinary way: capture a still and
run inference on it. At three to four frames a second that is more than enough for a squat,
whose full cycle takes a second or more.

`react-native-executorch` fits that shape. Its `usePoseEstimation` hook exposes `forward()`
for one-off image inference alongside the frame-processor path it cannot use here, its peer
dependencies are only `react` and `react-native`, and its compatibility table lists React
Native 0.81 and Expo SDK 54.

## Decision

Use **`expo-camera`** for the preview and stills, and **`react-native-executorch`** with
**YOLO26N-Pose** for landmarks. Draw the skeleton with `react-native-svg`, which is already
a dependency. Accept the loss of Expo Go, and take the development build once — batching the
camera, ExecuTorch and BLE dependencies into a single build so the cycle is paid once.

Keep the counting logic out of all of it. `mobile/src/ml/rep-counter.ts` takes plain
landmark objects and returns plain state, so the part that decides whether a rep happened is
testable with golden angle sequences and no device, no camera and no model.

## Consequences

**Good.**

- The feature is possible at all, which the frame-processor route was not.
- The rep counter is fully unit-tested and independent of the camera stack. If the pose
  library had to be swapped, nothing about the counting or the recovery gate would change.
- The pose model is pre-trained and used as-is, so no claim is made about training it. The
  disclosure UI says so, as it does for the focus model.
- Nothing about the *existing* on-device model changes: the focus forecast is still forty
  lines of arithmetic, and ADR 0001's reasoning about it still holds.

**Bad, and accepted.**

- **Expo Go no longer runs the app.** Every developer and every marker now needs the
  development build. The README says so explicitly.
- **ExecuTorch requires Android 13 or iOS 17.** That is a higher floor than the rest of the
  app and will exclude older hardware.
- **Inference at ~4 fps, not 30.** Adequate for squats; it would not be adequate for a fast
  or ballistic movement, and the feature is scoped to one exercise partly for that reason.
- The pose model is fetched on first use rather than bundled, so the first session needs a
  network. Every other feature in the app degrades gracefully offline; this one does not,
  and the UI has to be honest about it rather than appear to hang.

**Worth revisiting.** When the project moves to a React Native version where
`react-native-worklets` ≥ 0.8 is available, the frame-processor path becomes possible and
would raise the frame rate substantially. `usePoseEstimation` already exposes `runOnFrame`
for exactly that, so the change would be confined to the capture loop.
