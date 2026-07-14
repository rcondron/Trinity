# ADR-0004: platform adapters as boot-time render modes

**Status:** accepted

## Context

Seven output targets (web, VR, AR, Looking Glass quilts, volumetric slices,
Pepper's ghost, desktop overlay) share one scene/animation stack but differ in
camera rigs, session lifecycles (XR), and post-layout (multi-viewport grids).

## Decision

A `Platform` is selected once at boot from `?platform=` and returns a
per-frame render function that replaces the default `renderer.render(scene,
camera)`. Everything upstream of rendering — protocol, animation, audio — is
platform-agnostic. Switching platforms navigates (full reload) rather than
hot-swapping.

The multi-view platforms (quilt/volumetric/peppers) render via
viewport+scissor passes over the same scene, which is cheap and works on any
WebGL2 device; each also serves as its own in-browser simulator so all of
them are demonstrable without hardware.

## Rationale

Hot-swapping renderer state (XR sessions, scissor state, transparent clear
color, hidden environments) is a bug farm; a reload takes ~1 s and guarantees
a clean renderer. The `RendererAdapter` interface in avatar-core stays the
long-term contract; app-level platforms are its concrete users.

## Consequences

- New platform = one file in `apps/web/src/platforms/` + a list entry.
- Native visionOS or a Voxon SDK integration can implement the same interface
  outside the browser later; nothing in the protocol assumes a browser.
