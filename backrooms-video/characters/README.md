# Character sets

Put one folder per character here, for example `characters/mind/`, and point a project to it with the MCP tool
`set_character_images` or with `voices.<id>.images` in `script.json`.

| File | What | Size / framing |
|---|---|---|
| `portrait.png` | Head and shoulders, front facing, mouth **closed** | square, 1024x1024, plain background |
| `portrait_talk.png` | Exactly the same image, mouth **open**, as if speaking | same as above |
| `sprite_front.png` | Full body, standing, facing the camera | portrait 2:3, plain flat or transparent background |
| `sprite_back.png` | Same character seen from behind, walking away | same as above |

Two portrait frames give lip-sync. With only `portrait.png`, the image pulses with the voice and shows a level meter instead.
Plain backgrounds on sprites are removed automatically.
