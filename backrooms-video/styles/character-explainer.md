# Style: character-explainer (step-by-step how-to in a 3D set)

Vertical 1080x1920 at 60 fps, 40–60 s.
- A Three.js cutaway treatment room, like a model house. Every frame is a pure function of t.
- The user's character is a camera-facing billboard. They walk between stations (bob, sway, flip to face the walking direction) and show their back view when walking away.
- A lip-synced host portrait sits in the top-right circle. The mouth flaps at about 9 Hz while the voice is active.
- Each step gets a badge (big number, title, source chips). Captions sit in the lower third, with a soft music bed and a chime on each step. Audio is normalized to −16 LUFS.

## Character
`set_cast_sheet(path, rows=[...every row...], explorer=<character>)`. The explorer's row supplies face_closed, face_open, body_front and body_back. Choose the row whose outfit fits the topic: scrubs for medical topics, casual for home topics. `build/cutout_preview.jpg` shows the cut-outs on a dark background, so check it.

## Script
A hook, then N numbered steps from basic to long-term or safety, then an outro. Total voice should be about 57 s or less.
- Research official guidance first, and only state what the sources say.
- Put sources on the step chips and in the reply.
- For English, set `language: "en"` on the character and use an English Cartesia voice.

## Cues
| type | value | effect |
|---|---|---|
| `title` | dur | Hook title card (project title + subtitle) |
| `step` | {n, title, station, chips[]} | Step badge. The character walks to the station and the camera follows |
| `endcard` | value, sub | Closing card |

Stations: `overview`, `desk` (consult and clipboard checks), `sink` (hand washing, sterile packets), `bed` (needles inserted), `bedClose` (close-up: twirl, e-stim wires, clock runs), `sharps` (needles fly into the sharps bin), `center` (facing the camera).
Props animate by step number: 1 = clipboard checks, 2 = wash and packets, 3 = insertion, 4 = stimulation and clock, 5 = removal to the sharps bin.
