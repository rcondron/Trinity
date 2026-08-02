# Credits & third-party licenses

No third-party model weights or character assets are vendored into this
repository — setup scripts download them and their licenses apply.

## Character assets

| Asset | Source | License | How it gets here |
|---|---|---|---|
| Default avatar `VRM1_Constraint_Twist_Sample.vrm` | [pixiv/three-vrm examples](https://github.com/pixiv/three-vrm) | **CC0-1.0** (per the three-vrm examples' model documentation) | `scripts/setup_avatar.sh` → `apps/web/public/avatars/default.vrm` (gitignored) |
| Built-in procedural hologram avatar | this repo (`packages/avatar-core/src/vrm/procedural.ts`) | MIT (repo license) | generated at runtime, no assets |
| Default "Trinity" skin `trinity.glb` | this repo (`apps/web/scripts/generate-trinity-skin.mjs`) | MIT (repo license) | committed; stylized from a user-provided reference photo (colors/outfit only, no likeness) |
| Your own `.vrm` / `.glb` skins | you | yours — check redistribution terms before shipping | drag & drop or `VITE_DEFAULT_AVATAR` |

## Models

| Model | Source | License | Notes |
|---|---|---|---|
| NVIDIA ARDY (body motion) | [github.com/nv-tlabs/ardy](https://github.com/nv-tlabs/ardy), weights at [huggingface.co/collections/nvidia/ardy](https://huggingface.co/collections/nvidia/ardy) | see upstream license — typically NVIDIA research license, **non-commercial terms may apply**; review before any commercial use | downloaded by `scripts/setup_ardy.sh`, never vendored |
| Hermes (conversation) | [Nous Research](https://huggingface.co/NousResearch) via your own vLLM/llama.cpp/hosted endpoint | per-model card (Llama license derivatives for Hermes-3-Llama) | never downloaded by this repo; you point `HERMES_BASE_URL` at your deployment |
| ElevenLabs voices | [elevenlabs.io](https://elevenlabs.io) | commercial API terms | audio generated server-side per request |

## Software

| Package | License |
|---|---|
| three.js | MIT |
| @pixiv/three-vrm | MIT |
| SOMA / SMPL joint conventions (naming only; reference: [NVIDIA/soma-retargeter](https://github.com/NVIDIA/soma-retargeter)) | no code or data used — naming/topology reference only |
| FastAPI, uvicorn, jsonschema | MIT / BSD |
| ws, ajv, dotenv, tsx, vite, vitest | MIT |
| Electron, Capacitor | MIT |
