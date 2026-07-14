# Architecture

## Overview

```
                        ┌───────────────────────── browser client ─────────────────────────┐
                        │                                                                   │
 mic ──► Web Speech STT ┤   AudioPlayer ◄─ PCM chunks          Animator                     │
                        │       │ audio clock                    ▲  ▲  ▲                    │
                        │       ▼                                │  │  │                    │
                        │   viseme sampler ── ARKit weights ─────┘  │  └── micro-life       │
                        │                                           │      (blink/breath/   │
                        │   emotion FSM ── ARKit weights ───────────┘       saccade/sway)   │
                        │                                                                   │
                        │   MotionSource ── PoseFrames ─► retarget ─► VRM/GLB/procedural rig│
                        └───────▲───────────────▲───────────────────────────────────────────┘
                                │ WS (protocol)  │ WS (protocol)
                ┌───────────────┴───┐       ┌────┴──────────────┐
                │  orchestrator     │       │  motion-service   │
                │  (Node)           │       │  (Python)         │
                │                   │       │                   │
  ┌─────────┐   │  brain providers: │       │  backends:        │
  │ Trinity │◄──┤   trinity (bridge)│       │   ardy (GPU)      │
  │ Bridge  │   │   hermes (OpenAI- │       │   clips (CPU)     │
  │ :4711   │   │     compatible)   │       └───────────────────┘
  └─────────┘   │   demo (scripted) │
                │  tts: elevenlabs  │
                └───────────────────┘
```

## Data flow (one voice turn)

1. **STT** — browser Web Speech API emits interim results (used for barge-in
   voice-activity) and a final transcript → `user_transcript` to the orchestrator.
2. **Brain** — the selected provider streams spoken-text deltas. Two parallel outputs:
   - text deltas → ElevenLabs stream-input WS (TTS starts before the reply is finished),
   - the final structured reply carries `emotion`, `gestures[{prompt, atChar}]`,
     `locomotion`, `gaze`.
3. **TTS** — ElevenLabs returns PCM chunks + character alignment. Both are forwarded
   raw to the client (`tts_audio_chunk`, `tts_timestamps`).
4. **Client** — PCM is scheduled sample-exactly on the Web Audio clock; that clock
   drives the viseme sampler, so lips track sound under any network jitter. Gesture
   cues fire when the streamed text passes their `atChar`; prompts go to the motion
   service, whose pose frames are retargeted onto the loaded rig and blended with
   micro-life and the emotion/viseme face weights.

## The animation blender

Layers, composited every frame (`packages/avatar-core/src/blend/animator.ts`):

| Layer | Source | Blend |
|---|---|---|
| base body | motion service base stream (idle/locomotion) or client fallback | replaces bone rotations |
| gesture | motion service gesture stream | slerp by weight envelope (pop-free in/out) |
| foot lock | computed from foot world positions | hips XZ correction |
| micro-life body | procedural (breath, sway, head drift) | multiplied onto bones |
| visemes | TTS timestamps (or amplitude fallback) | ARKit weights, co-articulated |
| emotion | emotion FSM (eased, auto-decay) | ARKit weights, additive |
| micro-life face | blink/saccade generators | ARKit weights, additive |

## Protocol

Every cross-service message is defined once in
`packages/protocol/schemas/messages.json` (JSON Schema 2020-12) and validated on
both ends: ajv in TypeScript, `jsonschema` in Python. TS types are
hand-maintained twins (`src/types.ts`) — the protocol tests keep them honest.

Skeleton: `SOMA-24` (SMPL/SOMA joint set that ARDY emits). `PoseFrame.rotations`
is ordered by `SOMA_JOINTS`; the retarget layer maps to VRM humanoid bones,
scales root motion by hip height, clamps joints, and applies foot locking.

## Fallback matrix

Every degraded mode is visible in the status pills and the debug overlay (`` ` ``).

| Missing | Fallback |
|---|---|
| GPU / ARDY weights | motion-service procedural clip library (same prompt vocabulary) |
| motion-service entirely | client-side ClientMotion (idle/walk + core gestures) |
| ELEVENLABS_API_KEY | browser SpeechSynthesis + synthetic amplitude lip sync |
| Hermes endpoint + Trinity bridge | scripted demo persona (server) |
| orchestrator entirely | minimal on-device persona (client) |

## Latency budget (< 1.2 s speech-end → first audio+motion)

See [latency-tuning.md](latency-tuning.md). Everything streams: the TTS socket
opens in parallel with the brain request; audio chunks are scheduled the moment
they arrive; gesture prompts fire from text position, not turn completion.
Per-stage timings are emitted as `latency_mark` messages and shown in the debug
overlay.

## ADRs

- [ADR-0001 — three.js + VRM as the avatar stack](adr/0001-render-engine-and-vrm.md)
- [ADR-0002 — WebSocket + JSON protocol](adr/0002-transport.md)
- [ADR-0003 — control-line structured output for Hermes](adr/0003-hermes-structured-output.md)
- [ADR-0004 — platform adapters as boot-time modes](adr/0004-platform-adapters.md)
