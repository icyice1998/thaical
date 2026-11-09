#!/usr/bin/env bash
# Build the whole episode: TTS + timeline + audio mix, then render frames and mux.
set -euo pipefail
cd "$(dirname "$0")"
pip install -q edge-tts numpy >/dev/null 2>&1 || true
python3 build_audio.py
node capture.js
cp build/out.mp4 backrooms-ep1.mp4
echo "-> backrooms-ep1.mp4"
