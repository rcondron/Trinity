# WebXR — VR & AR

## VR (`?platform=vr`)

Quest-class headsets via the built-in browser. Requirements:

- Serve over **HTTPS** (or `localhost` via `adb reverse tcp:5173 tcp:5173`).
- Click **Enter VR**. The avatar stands life-size ~1.6 m in front of your
  starting position and its gaze follows your headset (the XR camera becomes
  the gaze anchor).

Voice works exactly as on desktop — the Quest browser supports Web Speech
input and Web Audio output. For spatial audio, route `AudioPlayer`'s gain
node through a `PannerNode` positioned at the avatar's head; the hook point
is `AudioPlayer.ensureCtx()` (kept mono/omni by default for simplicity).

## AR (`?platform=ar`)

- **Phones** (Chrome on Android; iOS via WebXR-viewer apps): Enter AR places
  the avatar in your room; the virtual environment (floor/grid) is hidden
  automatically.
- **Passthrough headsets** (Quest 3): same button, passthrough background.
- **Occlusion**: enabled implicitly on devices exposing depth-sensing to
  WebXR; no app changes needed where the UA composites depth.

## Apple Vision Pro

Works through **Safari's WebXR support** (Settings → Apps → Safari →
Advanced → Feature Flags → WebXR). Native visionOS (RealityKit) is out of
scope, but the adapter API doesn't preclude it — see ADR-0004.
