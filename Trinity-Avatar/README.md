# Trinity Avatar

Talk to Trinity through a full-body 3D human avatar — real-time voice conversation with
synchronized lip sync, facial expressions, and expressive body motion. Runs in the browser
first, with pluggable adapters for VR/AR headsets, Looking Glass holographic displays,
volumetric/POV displays, Pepper's-ghost pyramids, a desktop overlay (the avatar walks around
on your screen), and mobile.

```
you speak ──► STT ──► brain (Trinity / Hermes / demo) ──┬─► ElevenLabs TTS ─► audio + visemes
                                                        └─► gestures/emotion ─► motion-service (ARDY) ─► body motion
```

## Quick start (zero keys, zero GPU — demo mode)

```bash
cd Trinity-Avatar
pnpm install
pnpm dev            # web app on http://localhost:5173 + orchestrator on :8790
```

Open http://localhost:5173, press the mic (or type), and talk to the avatar. With no
API keys it uses a scripted demo persona, browser speech synthesis, and procedural
motion clips — every active fallback is shown in the debug overlay (press `` ` ``).

Full stack with the Python motion service:

```bash
docker compose up          # orchestrator + motion-service (CPU profile by default)
pnpm dev:web
```

## With real backends

Copy `.env.example` to `.env` and fill in any of:

| Capability | Variable(s) | Fallback when unset |
|---|---|---|
| Voice out (lip-synced) | `ELEVENLABS_API_KEY` | Browser SpeechSynthesis + amplitude lip sync |
| Brain — Trinity agent | `TRINITY_BRIDGE_URL`, `TRINITY_BRIDGE_TOKEN` | — |
| Brain — Hermes | `HERMES_BASE_URL`, `HERMES_MODEL` | Scripted demo persona |
| Body motion — NVIDIA ARDY | CUDA GPU + `scripts/setup_ardy.sh` | Procedural clip library |

## Platforms

| Target | URL / command | Simulator |
|---|---|---|
| Web (desktop+mobile) | `pnpm dev` → http://localhost:5173 | — |
| WebXR VR (Quest etc.) | “Enter VR” button (needs HTTPS or localhost) | — |
| WebXR AR (phone / passthrough) | “Enter AR” button | — |
| Looking Glass | `?platform=lookingglass` | quilt view in browser |
| Volumetric / POV display | `?platform=volumetric` | spinning-slice sim in browser |
| Pepper's ghost pyramid | `?platform=peppers&views=4` | pyramid layout in browser |
| Desktop overlay (walks on your screen) | `pnpm --filter @trinity-avatar/desktop-overlay start` | — |
| Mobile (Capacitor) | `apps/mobile/README.md` | — |

## Repository layout

```
Trinity-Avatar/
├── packages/protocol/       All cross-service messages (JSON Schema + TS types)
├── packages/avatar-core/    VRM loading, retargeting, visemes, emotions, micro-life,
│                            animation blending, renderer adapters
├── apps/web/                Primary browser app (Vite + three.js)
├── apps/desktop-overlay/    Electron transparent overlay
├── apps/mobile/             Capacitor wrapper
├── services/orchestrator/   Voice/brain pipeline (Node + WebSocket)
├── services/motion-service/ ARDY body motion (Python) + procedural fallback
├── docs/                    Architecture, ADRs, per-platform guides
└── scripts/                 Asset/weights download helpers
```

See [docs/architecture.md](docs/architecture.md) for the full picture and
[docs/avatar-customization.md](docs/avatar-customization.md) to swap the avatar skin
(drag & drop a `.vrm`/`.glb` onto the app, or set `VITE_DEFAULT_AVATAR`).

## Development

```bash
pnpm test        # unit + integration tests (TS)
pnpm lint        # typecheck all packages
pnpm build       # build everything
cd services/motion-service && pytest   # Python tests
```

Third-party assets and model licenses: [CREDITS.md](CREDITS.md).
