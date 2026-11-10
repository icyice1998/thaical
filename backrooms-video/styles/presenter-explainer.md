# Style: presenter-explainer (พิธีกรอธิบาย + กราฟิกเคลื่อนไหว)

Vertical 1080x1920 at 60 fps, 40–120 s, with a dark navy background and a thin violet progress bar at the top.
- Upper area (y 150–950): one animated info card per beat.
- Middle (around y 1060): karaoke captions.
- Bottom: the cut-out presenter. They breathe, sway, nod with the voice, and can switch poses.

## Presenter
- `create_project(..., style="presenter-explainer")`, then `set_script` with usually one character (the narrator).
- Art: `set_cast_sheet` (the presenter's `sprite_front` is used), or `set_assets` with `pose_sheet` = {path, columns, rows}, one pose per cell. Switch poses with `pose` cues (value is the pose index).

## Cards (`set_scenes` cues of type `card`, value = object with `kind`)
| kind | fields | animation |
|---|---|---|
| `title` | text, sub | Pops in with a yellow pill subtitle |
| `counter` | label, value, decimals, unit, pill, dots (0–100: share of the dot field highlighted) | Counts up, pill fades in, dot field fills |
| `bars` | kicker, title, items[{label, value, color}], unit, decimals, max | Bars grow one by one and the numbers tick |
| `threshold` | kicker, title, min, max, zones[{to, label, range, color}], cutoff, cutoff_label, note | Zones grow, a red cut-off badge slides to the value |
| `checklist` | title, items[] | Ticks pop in one after another |
| `code` | title, lines[] | Typewriter with syntax colours |
| `numbers` | title, items[{value, label, color}] (1–4) | Tiles pop in |
| `note` | text, sub | Taped paper note on a beige background |

Plus `endcard` (value = big line, sub = small line) for the call to action. A card stays until the next card or endcard. Put each card on the line that starts that idea, with `offset` around −0.3 so it appears just before the words.

## Tips
- One idea per line, and one card per line or two. Numbers on cards should match the words exactly.
- Write numbers in the voice line as Thai words, for example "ร้อยยี่สิบหก", so the TTS reads them naturally. The card shows the digits.
- Medical or health content: cite the guideline in the caption and add an educational note card.
