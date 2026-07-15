# Demo script (zero keys required)

A 3-minute tour that exercises every subsystem. Works fully offline with the
demo persona; everything gets better with keys in `.env`.

```bash
cd Trinity-Avatar
pnpm install
./scripts/setup_avatar.sh     # optional: real VRM instead of the hologram
pnpm dev                      # web on :5173 + orchestrator on :8790
# optional third service, for service-driven motion:
cd services/motion-service && python3 -m venv .venv && \
  .venv/bin/pip install -r requirements.txt && .venv/bin/python -m motion_service.server
```

Open http://localhost:5173 and:

1. **It's alive** — before touching anything, watch: blinking, saccadic eye
   darts, breathing, weight shifts. Press `` ` `` — check fps and backends.
2. **Talk** — click the mic (open-mic) or hold it (push-to-talk), say
   *"Hello Trinity"*. She waves, smiles, speaks with lips tracking audio.
   No mic? Type in the chat box.
3. **Barge-in** — ask *"tell me something interesting"*, then start talking
   over her: speech and gesture cut off gracefully.
4. **Emotions** — say *"give me a hard riddle"* (thoughtful + chin), *"wow!"*
   (surprised), *"goodbye"* (wave).
5. **Body** — *"walk around"* → pacing with foot-locking; *"stop"* → idle.
6. **Skin swap** — drag any `.vrm` onto the window mid-conversation.
7. **Platforms** — ◫ panel: Looking Glass quilt, volumetric POV simulator,
   Pepper's ghost (`views=4`), overlay mode. Then the real desktop overlay:
   `pnpm --filter @trinity-avatar/desktop-overlay start`.
8. **Debug** — `` ` `` again after a turn: per-stage latency for that turn.

With `ELEVENLABS_API_KEY` set, step 2 upgrades to timestamped lip sync;
with `HERMES_BASE_URL` or a running Trinity Bridge, steps 2–5 become real
conversations (`brain: hermes` / `brain: trinity` pill goes green).
