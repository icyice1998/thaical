# หลุดเข้า Backrooms · EP.1 วอร์ดที่ไม่มีวันจบ

A vertical short (1080x1920, 30 fps, about 73 s) in the style of a retro-FPS "found footage" Backrooms clip. Everything is generated from code: the 3D scenes, pixel-art characters, HUD, subtitles and sound design. Only the voices come from an external service (edge-tts).

## Pipeline

```
script.json ──> build_audio.py ──> build/timeline.json + build/audio.wav
                                           │
renderer.html + renderer.js <── capture.js ┘──> build/out.mp4
```

| File | What it does |
|---|---|
| `script.json` | Dialogue lines plus cues (scene, mission, toast, lights, flashlight, entity, glitch, whiteout, endcard, walk speed) |
| `build_audio.py` | TTS for each line (edge-tts, cached), timing, per-frame state (scene / lights / walking), mouth envelopes, synthesized hum, drone, footsteps and SFX |
| `renderer.js` | Deterministic `BR.render(frame)`: a 270x295 textured raycaster upscaled 4x, plus VHS FX, minimap, mission boxes, karaoke subtitles and talking pixel portraits |
| `capture.js` | Headless Chromium renders the frames with 4 parallel workers, ffmpeg encodes them, then muxes the audio |

## Run

```bash
./make.sh                                 # full build -> backrooms-ep1.mp4
node capture.js --stills 2,30,60          # quick PNG checks in build/
python3 -m http.server   # then open renderer.html?preview to scrub frames
```

Requirements: Python 3 (`edge-tts`, `numpy`), Node with `playwright`, Chromium, ffmpeg.

## Making a new episode

Edit `script.json` only: change the lines, `who`, `gap_before` and `cues`. Each cue time is relative to its line (`at: start|end` plus `offset` in seconds). The path length of each map adapts automatically to how long the characters walk.

- Voices: each character has a primary voice and a `fallback` voice. A character keeps the same voice for the whole episode.
- `th-TH-PremwadeeNeural` (Thai female) was unavailable while this episode was built, so มายด์ used `en-US-EmmaMultilingualNeural`. Re-run `build_audio.py` when Premwadee is back and it will be used automatically.

Fictional story, inspired by the internet folklore *The Backrooms* (https://en.wikipedia.org/wiki/The_Backrooms). All characters, levels and art are original.
