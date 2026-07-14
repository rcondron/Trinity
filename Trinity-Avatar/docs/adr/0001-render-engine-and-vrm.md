# ADR-0001: three.js + VRM 1.0 as the avatar stack

**Status:** accepted

## Context

We need a browser-first 3D stack that loads swappable humanoid avatars with
facial blendshapes, runs on WebGL2 everywhere (WebGPU where available), and
supports WebXR plus unusual outputs (quilts, radial slices, multi-viewport).

## Decision

- **three.js** (not Babylon, not a game engine): smallest API surface that
  covers WebXR, multi-viewport scissor rendering, and has first-class VRM
  support via `@pixiv/three-vrm`. WebGL2 is the default; WebGPU remains
  opt-in until `WebGPURenderer` covers XR + scissor parity (tracked upstream).
- **VRM 1.0** as the canonical avatar format: standardized humanoid bone map,
  expression system, normalized pose space (identity = T-pose) which makes
  retargeting trivial, and a healthy ecosystem of permissively licensed models.
- **GLB with ARKit morphs** as the secondary path (Ready Player Me, MetaHuman
  exports) through a proxy-bone wrapper that recreates VRM's normalized-pose
  invariant on raw rigs.
- **ARKit-52** as the canonical face weight space; each rig maps it to
  whatever it actually has. This is also the contract an NVIDIA
  Audio2Face-3D/ACE adapter would implement later (it outputs ARKit weights).

## Consequences

- One `AvatarRig` interface isolates all skin differences; the animator and
  retargeter never branch on avatar type.
- A built-in procedural rig keeps the repo demoable with zero downloads.
- VRM 0.x models work through three-vrm's compatibility path (`rotateVRM0`).
