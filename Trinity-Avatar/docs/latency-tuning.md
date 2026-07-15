# Latency tuning

Target: **< 1.2 s** from end of user speech to first audio + motion.
Press `` ` `` for the debug overlay — every turn shows per-stage timings
(`latency_mark` messages), so you can see exactly where time goes.

## The pipeline and its knobs

| Stage | Typical | Knobs |
|---|---|---|
| STT final result | 150–400 ms | Browser Web Speech is push-based; keep utterances short. Open-mic mode loses ~100 ms vs push-to-talk because the recognizer decides end-of-speech. |
| Brain first token | 200–700 ms | Local vLLM with a 7–8B Hermes: use `--enable-prefix-caching` (system prompt is constant). Keep `max_tokens` low (400). Trinity bridge is non-streaming — expect a full-reply delay; prefer Hermes for voice-first UX. |
| TTS first audio | 150–350 ms | `eleven_turbo_v2_5` or `eleven_flash_v2_5` (fastest). The orchestrator opens the TTS socket in parallel with the brain call, so its handshake is off the critical path. PCM output avoids client decode. |
| Motion first frame | < 50 ms | Procedural backend is immediate. ARDY: first diffusion window dominates; keep the service warm (it stays resident) and prefer 30 fps windows. |
| Client scheduling | ~50 ms | `AudioPlayer.beginTurn()` primes playback 50 ms ahead; lower at your own risk of first-chunk underrun. |

## Rules the code already follows (keep them)

- **Never wait for completions.** Text deltas go to TTS as they stream;
  audio chunks schedule as they arrive; gesture cues fire on character
  position, not turn end.
- **The audio clock is truth.** Visemes sample against seconds-of-audio-played
  (Web Audio time), not wall clock — network jitter shifts lips and sound
  together, never apart.
- **Barge-in must be instant.** interrupt → 30 ms gain ramp, TTS socket
  abort, gesture fade. Anything slower feels like the avatar ignores you.

## Measuring

- Debug overlay: per-stage ms for the last turn + running fps.
- Orchestrator logs each turn's brain/TTS failures.
- For scripted end-to-end numbers, `services/orchestrator/test/session.test.ts`
  shows how to drive the pipeline headlessly with a fake socket.

## Network placement

Run orchestrator + motion service on the same LAN as the browser. The only
WAN hops should be ElevenLabs and (optionally) a hosted Hermes. If the
Trinity bridge is remote, expect its non-streaming reply to dominate.
