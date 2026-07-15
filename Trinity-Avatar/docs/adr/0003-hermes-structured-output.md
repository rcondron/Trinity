# ADR-0003: control-line structured output for the Hermes brain

**Status:** accepted

## Context

The brain must emit, alongside its spoken reply: gesture prompts (with timing),
an emotion label, locomotion and gaze directives. Hermes runs behind whichever
OpenAI-compatible server the user has (vLLM, llama.cpp server, hosted) — and
their function-calling/JSON-mode support differs wildly. We also need the
spoken text streaming into TTS with zero added latency.

## Decision

The system prompt makes the model output **one JSON control line first**, then
the spoken reply as plain text. The orchestrator buffers only until the first
newline (a few tokens), parses the control object leniently (invalid fields
dropped, garbage → empty control), and streams everything after it straight to
TTS and the client.

## Alternatives rejected

- **Native function calling**: not uniformly supported across llama.cpp/vLLM
  versions; often disables token streaming or interleaves tool-call deltas.
- **Full-JSON replies** (`{"say": …}`): streaming the spoken text requires
  incremental JSON parsing, and one malformed quote destroys the whole turn.
- **Post-hoc classification** of the finished reply: adds a full round trip
  before any gesture/emotion can fire.

## Consequences

- Worst case (model ignores the format) degrades gracefully: the whole output
  is treated as spoken text with neutral behavior.
- Gesture timing uses `atChar` indices into the reply, which maps directly to
  the character-timestamp stream ElevenLabs returns — one shared coordinate
  system between speech, lips, and gesture cues.
- Trinity-bridge replies (non-streaming, no directives) get behavior from a
  keyword/sentiment inference pass instead — same downstream contract.
