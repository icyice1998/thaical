# หลุดเข้า Backrooms · EP.1 วอร์ดที่ไม่มีวันจบ

A vertical short (1080x1920, 30 fps, about 85 s) in the style of a retro-FPS "found footage" Backrooms clip. Everything is generated from code: the 3D scenes, pixel-art characters, HUD, subtitles and sound design. Only the voices come from an external service: Cartesia `sonic-3` Thai voices, with edge-tts as the free fallback.

## Use it as an MCP server (same flow as Genhaha Video)

| Tool | Purpose |
|---|---|
| `list_styles` / `get_style_guide` | Available styles and the full brief (scenes, cue types, beat sheet) |
| `list_voices` | Cartesia voices for a language, e.g. `th` |
| `create_project` | New project under `projects/<id>/` |
| `set_script` | Characters (voice, portrait `look`, colour) and dialogue lines with emotions |
| `set_scenes` | Cues per line: scene, walk, lights, flashlight, entity, glitch, mission, toast, endcard, and so on |
| `generate_voice` | Cartesia TTS, line timing, and the ambience/SFX mix |
| `preview_frame` | Returns stills as images for checking before rendering |
| `render` / `job_status` | Background render to `projects/<id>/<id>.mp4` |

```bash
pip install -r requirements.txt          # plus Node + playwright + ffmpeg
export CARTESIA_API_KEY=...              # never commit it
# Claude Code: the repo's .mcp.json registers it automatically, or:
claude mcp add backrooms-video -e CARTESIA_API_KEY=$CARTESIA_API_KEY -- python3 backrooms-video/mcp_server.py
# Remote clients (Streamable HTTP):
python3 backrooms-video/mcp_server.py --http --port 8765   # -> http://127.0.0.1:8765/mcp
```

Then ask Claude, for example: "ใช้ backrooms-video ทำคลิป 60 วินาที เรื่อง หลุดเข้า Level ห้องผ่าตัด".

## Pipeline

```
script.json ──> build_audio.py ──> build/timeline.json + build/audio.wav
                                           │
renderer.html + renderer.js <── capture.js ┘──> build/out.mp4
```

| File | What it does |
|---|---|
| `script.json` | Dialogue lines plus cues (scene, mission, toast, lights, flashlight, entity, glitch, whiteout, endcard, walk speed) |
| `tts_providers.py` | Cartesia (`/tts/bytes`, sonic-3, `generation_config` speed/emotion) and edge-tts, cached by hash |
| `mcp_server.py` | The MCP server described above (supports mcp 1.x and 2.x) |
| `build_audio.py` | TTS for each line (via `tts_providers`), timing, per-frame state (scene / lights / walking), mouth envelopes, synthesized hum, drone, footsteps and SFX |
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

- Voices: Cartesia by default (ต้น = Krit, มายด์ = Suda), each with edge-tts fallbacks. A character keeps the same voice for the whole episode. Lines can carry an `emotion` (scared, curious, excited, ...).
- `build_audio.py [PROJECT_DIR]` and `capture.js --project DIR` work on any project folder.

Fictional story, inspired by the internet folklore *The Backrooms* (https://en.wikipedia.org/wiki/The_Backrooms). All characters, levels and art are original.
