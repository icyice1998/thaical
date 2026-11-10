# Style: history-doc (archival paintings + presenter)

Vertical 1080x1920 at 60 fps, 50–100 s.
- Full-bleed paintings or photos with slow Ken Burns moves and 0.7 s crossfades, a warm film grade with grain, and a cut-out presenter at the bottom.
- Captions sit above the presenter. The credit for the current image is shown in the bottom-right corner.

## Images
`set_images(project_id, {key: "File:<Commons title>" | {"file": ..., "credit": "Ingres, 1854 · Public domain"}})`, then `generate_assets`.
Use public domain, CC0 or Licence Ouverte works, and list the credits in the caption or description too.

## Cues
- `title` (dur): the project title in serif type, plus the subtitle.
- `endcard` (value, sub).
- `shot`: value = `{img, from: [cx, cy, zoom], to: [cx, cy, zoom], tags, big, card, quote, timeline}`. It lasts until the next shot.
  - `tags`: [{text, style: "red"|default, at}]. Date/place chips stacked at the top-left.
  - `big`: {text, sub, strike, at}. A yellow number box. `strike` shows an old value crossed out first.
  - `card`: {img, title, caption}. An archival image pinned on paper.
  - `quote`: {text, by, type_s}. A typed serif quote.
  - `timeline`: {points: [{year, label}]}.

## Script
Keep it to the documented facts, with dates written exactly. One beat per line, and one shot per line or two.
Pans: from/to centres are 0..1 of the image and zoom ≥ 1. Use small moves (about 0.05 in centre, 1.0 → 1.15 zoom).
