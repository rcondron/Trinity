#!/usr/bin/env bash
# Install NVIDIA ARDY + download model weights for the motion service.
# Weights are NEVER vendored into the repo (license: see CREDITS.md).
#
# Requirements: NVIDIA GPU + CUDA drivers, python3.10+, ~6 GB disk.
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="${ARDY_CHECKPOINT_DIR:-services/motion-service/weights/ardy}"
VENV="services/motion-service/.venv"

echo "==> Trinity Avatar — ARDY setup"

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "WARNING: nvidia-smi not found. ARDY requires an NVIDIA GPU;"
  echo "the motion service will fall back to procedural clips without one."
fi

if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"

echo "==> Installing GPU requirements (torch)…"
pip install -r services/motion-service/requirements.txt -r services/motion-service/requirements-gpu.txt

echo "==> Installing ARDY from github.com/nv-tlabs/ardy…"
pip install "git+https://github.com/nv-tlabs/ardy" || {
  echo "ERROR: could not install ARDY. Check https://github.com/nv-tlabs/ardy"
  echo "for current installation instructions — the repo layout may have changed."
  exit 1
}

echo "==> Downloading weights from Hugging Face (nvidia/ardy collection)…"
mkdir -p "$DEST"
pip install -q "huggingface_hub[cli]"
python - "$DEST" <<'PY'
import sys
from huggingface_hub import snapshot_download

dest = sys.argv[1]
# See https://huggingface.co/collections/nvidia/ardy for available checkpoints.
snapshot_download(repo_id="nvidia/ardy", local_dir=dest)
print(f"weights in {dest}")
PY

echo "==> Done. Start the service with MOTION_BACKEND=auto (default);"
echo "    it will report backend=ardy in /health when the GPU path is live."
