# Style: backrooms-retro (เกม 3D ย้อนยุค · found footage)

A vertical 1080x1920 clip, 30 fps, usually 45–120 s. It looks like a 90s raycaster game recorded on a VHS camcorder.
- Top (1080x1180): the 3D scene, with REC timer, date, minimap, LEVEL label, mission box and item toasts.
- Middle: a subtitle box with karaoke highlight and the speaker name.
- Bottom: 2–3 pixel-art portraits that lip-sync to the voice, plus a progress bar.

## Characters (set_script → characters)

Use 2 characters, at most 3. The key is a short id that lines refer to in `who`.

| field | meaning |
|---|---|
| `name` | Name shown under the portrait and in the subtitle box (Thai is fine) |
| `voice` | Cartesia voice id (see `list_voices`) |
| `provider` | `cartesia` (default) or `edge` |
| `speed` | 0.8–1.3, default 1.05 |
| `look` | Portrait: `operator` (male + headset, talks over radio), `doctor` (female in teal scrubs, the explorer seen in 3D), `entity` (black shadow with a white smile) |
| `color` | Hex colour for the name / speaking border |
| `fallback` | Optional list of edge-tts voices to use if Cartesia fails |

The explorer walking in the 3D scene is always the scrubs character. Give her a `doctor` portrait so the two match.

## Lines (set_script → lines)

`{ "who": "<character id>", "text": "...", "emotion": "scared|curious|excited|angry|sad|calm", "gap_before": 0.35 }`

- Keep each line to 1–2 sentences, under about 70 Thai characters. Three subtitle rows is the maximum shown.
- Use `gap_before` of 1–2 s before a scary beat, to let the silence work.
- The emotion is optional and only applies to Cartesia voices. An unknown emotion is dropped silently.

## Scenes and cues (set_scenes)

Each cue attaches to a line by index: `{ "line": 3, "type": "...", "at": "start|end", "offset": 0.0, "value": ..., "dur": ... }`.

| type | value / dur | effect |
|---|---|---|
| `scene` | `level0` · `ward` · `doors` | Cuts to that place. `level0` is the yellow rooms with carpet and fluorescent hum. `ward` is an endless hospital corridor with empty beds, exit signs and a red floor guide line ending at an ER door. `doors` is a flat illustration of three doors labelled กลับบ้าน / ลึกลงไป / ห้ามเปิด, used for the ending. |
| `walk` | speed in cells/s (0 = stop, negative = back up) | The camera and explorer follow the level path; the path length adapts to how far they walk |
| `lights` | target 0–1, `dur` | Tubes cut out one by one with clunks, and the hum fades with them |
| `flashlight` | 1 / 0 | Torch cone, needed when lights are 0 |
| `entity` | 1 / 0 | The smiling figure appears ahead (level0), offset so it is never hidden behind the explorer |
| `shake` | `dur` | Camera shake plus a low thud |
| `glitch` | `dur` | Noclip glitch: torn lines, yellow chevrons, digital noise. Put a `scene` cue right after it |
| `whiteout` | `dur` | Flash to white, used for opening a door |
| `mission` | text (`"ภารกิจใหม่ · ..."` shows a "new mission" header), `""` hides it | Yellow mission box |
| `toast` | `"ได้ของ · ไฟฉาย +1"` | Green item-pickup toast, 3 s |
| `title` | `dur` | Big title card (project title and subtitle) |
| `endcard` | – | The "เปิดบานไหนดี? เมนต์มาเลย" call to action |

### Default beat sheet (works well)
1. Line 0: `scene level0` at offset −1.2, `title` (dur 4), `walk 0`. Line 1 then sets `walk 0.9`.
2. Establish the rule of the level (for example ห้ามวิ่ง) with a `mission` cue.
3. Pickup `toast` → `lights 0` (dur 2.2, offset −2.4) → `walk 0` → `flashlight 1` → `entity 1` + `shake`.
4. A new mission, then `glitch` → `scene ward` + `flashlight 0` + `entity 0` + `mission ""` → `walk 0.8`.
5. Explore the ward, then a `mission` to follow the red line → `walk 0` at the door → `whiteout` → `scene doors` → `endcard` on the last line.

## Tips
- Run `preview_frame` at the title, the dark or entity beat, the ward, and the doors before rendering.
- Each scene's walk distance is the walk speed times its duration. Walking speeds above 1.2 look like running.
- The story is fictional and based on The Backrooms internet folklore. Say so in the caption.
