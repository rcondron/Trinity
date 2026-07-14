# ADR-0002: WebSocket + JSON messages, schema-validated on both ends

**Status:** accepted

## Context

Three processes (browser, Node orchestrator, Python motion service) exchange
streaming data: text deltas, PCM audio, character timestamps, 30 fps pose
frames. Options considered: WebRTC data channels, gRPC-web, WebSocket+JSON,
WebSocket+binary.

## Decision

Plain WebSockets carrying JSON messages defined once in
`packages/protocol/schemas/messages.json` (draft 2020-12), validated with ajv
(TS) and `jsonschema` (Python). Audio rides as base64 PCM inside JSON.

Two sockets, not one: client↔orchestrator (conversation) and client↔motion
service (poses). The orchestrator never proxies pose frames — one less hop of
latency, and either service can die without taking the other down.

## Rationale

- JSON keeps every hop inspectable (`wscat`, browser devtools) and lets the
  schema be the single source of truth across two languages.
- Measured overhead is acceptable: pose frames are ~2.3 KB → ~70 KB/s at
  30 fps; base64 PCM adds 33 % to ~32 KB/s audio. Localhost/LAN links don't
  notice, and both hot paths skip revalidation (`isValidMessage` non-throwing).
- WebRTC would buy lower audio latency across the open internet, at the price
  of signaling + SDP complexity that doesn't pay off for a localhost/LAN
  deployment. The protocol package would survive a future swap.

## Consequences

- A malformed message from any implementation fails loudly at the boundary
  with a `bad_message` error instead of corrupting animation state.
- Binary framing (CBOR/flatbuffers) is a contained future optimization: only
  `serializeMessage`/`parseMessage` and their Python twins would change.
