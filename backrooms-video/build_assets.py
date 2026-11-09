"""Step 0 (optional): AI images and music for a project, read from script.json → "assets".

  "assets": {
    "image_provider": "openai" | "google",
    "cover":     {"prompt": "..."},                  # cover art (9:16); the title is drawn on top by the renderer
    "portraits": "code" | "ai-pixel" | "ai-photo",   # uses each character's "portrait_prompt"
    "textures":  "code" | "ai",                      # wall/floor/ceiling tiles for level0 and ward
    "music":     {"prompt": "...", "bpm": 70, "seconds": 40, "volume": 0.5, "model": "lyria-3-clip-preview"}
  }

Writes PROJECT/build/assets.json (data URLs for the renderer) and build/assets/music.wav.
Anything that fails falls back to the code-drawn version and is listed in "warnings".
Usage: python3 build_assets.py [PROJECT_DIR]
"""
import base64, hashlib, io, json, os, subprocess, sys

from PIL import Image

import media_providers as mp

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else HERE
BUILD = os.path.join(PROJECT, "build")
ADIR = os.path.join(BUILD, "assets")
CACHE = os.path.join(ADIR, "cache")
os.makedirs(CACHE, exist_ok=True)

STYLE = ("retro 1990s low-poly video game art, muted VHS colours, liminal space, eerie, "
         "no text, no letters, no watermark")
TEXTURES = {  # name in renderer.js -> prompt
    "yWall":  "seamless tileable texture, flat front view, old mono-yellow wallpaper with faint vertical stripes and a dirty brown baseboard strip at the bottom, office backrooms",
    "carpet": "seamless tileable texture, top-down view, damp worn brown-beige office carpet with stains",
    "yCeil":  "seamless tileable texture, view from below, stained off-white acoustic drop-ceiling tile with thin grey grid",
    "gWall":  "seamless tileable texture, flat front view, hospital corridor wall: cream paint on top, pale green square tiles on the lower half, a dark handrail across the middle",
    "vinyl":  "seamless tileable texture, top-down view, speckled light grey hospital vinyl floor tiles",
    "wCeil":  "seamless tileable texture, view from below, clean white hospital ceiling tiles with grid",
}


def _cached(kind, provider, prompt, aspect, transparent=False):
    h = hashlib.sha1(f"{kind}|{provider}|{mp.OPENAI_IMAGE_MODEL}|{mp.GOOGLE_IMAGE_MODEL}|{aspect}|{transparent}|{prompt}|{mp.MOCK}".encode()).hexdigest()[:16]
    path = os.path.join(CACHE, f"{kind}-{h}.png")
    if not os.path.exists(path):
        data = mp.image(provider, prompt, aspect, transparent)
        Image.open(io.BytesIO(data)).save(path)
    return Image.open(path).convert("RGBA")


def _data_url(im, fmt="PNG", quality=88):
    buf = io.BytesIO()
    if fmt == "JPEG": im = im.convert("RGB")
    im.save(buf, fmt, **({"quality": quality} if fmt == "JPEG" else {}))
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(buf.getvalue()).decode()


def _crop_to(im, w, h, top_bias=0.0):
    sw, sh = im.size; tr = w / h
    if sw / sh > tr:
        nw = int(sh * tr); x = (sw - nw) // 2; return im.crop((x, 0, x + nw, sh))
    nh = int(sw / tr); y = int((sh - nh) * (0.5 - top_bias / 2)); return im.crop((0, y, sw, y + nh))


def main():
    s = json.load(open(os.path.join(PROJECT, "script.json"), encoding="utf-8"))
    cfg = s.get("assets") or {}
    prov = cfg.get("image_provider", "openai")
    out = {"portraits": {}, "textures": {}, "cover_art": None, "music": None, "warnings": [], "provider": prov}

    # cover art
    cover = cfg.get("cover")
    if cover:
        prompt = cover.get("prompt") or f"Key art for a horror short video titled '{s['meta']['title']}'. {s['meta'].get('subtitle', '')}"
        try:
            im = _crop_to(_cached("cover", prov, f"{prompt}. Vertical poster composition, empty space at the top for a title. {STYLE}", "9:16"), 1080, 1920)
            out["cover_art"] = _data_url(im.resize((1080, 1920), Image.LANCZOS), "JPEG")
            print("  cover art: ok")
        except mp.MediaUnavailable as e:
            out["warnings"].append(f"cover: {e}")

    # portraits
    mode = cfg.get("portraits", "code")
    if mode in ("ai-pixel", "ai-photo"):
        for key, v in s["voices"].items():
            p = v.get("portrait_prompt")
            if not p:
                out["warnings"].append(f"portrait {key}: no portrait_prompt, using code art"); continue
            style = ("16-bit pixel art character portrait, head and shoulders, front facing, plain dark background"
                     if mode == "ai-pixel" else
                     "photorealistic head-and-shoulders portrait photo, front facing, neutral expression, mouth closed, studio light, plain dark background")
            try:
                im = _crop_to(_cached("portrait", prov, f"{p}. {style}. No text.", "1:1"), 40, 44, top_bias=0.3)
                if mode == "ai-pixel":
                    im = im.resize((40, 44), Image.BOX).convert("RGB").quantize(32, method=Image.MEDIANCUT).convert("RGBA")
                else:
                    im = im.resize((300, 330), Image.LANCZOS)
                out["portraits"][key] = {"mode": mode, "src": _data_url(im)}
                print(f"  portrait {key}: ok")
            except mp.MediaUnavailable as e:
                out["warnings"].append(f"portrait {key}: {e}")

    # textures
    if cfg.get("textures") == "ai":
        for name, prompt in TEXTURES.items():
            try:
                im = _cached("tex", prov, f"{prompt}. {STYLE}", "1:1").resize((64, 64), Image.BOX).convert("RGB")
                out["textures"][name] = _data_url(im)
                print(f"  texture {name}: ok")
            except mp.MediaUnavailable as e:
                out["warnings"].append(f"texture {name}: {e}")

    # music
    m = cfg.get("music")
    if m:
        h = hashlib.sha1(json.dumps([m, mp.MOCK], sort_keys=True).encode()).hexdigest()[:16]
        raw = os.path.join(CACHE, f"music-{h}.bin"); wav = os.path.join(ADIR, "music.wav")
        try:
            if not os.path.exists(raw):
                data, mime = mp.music(m.get("prompt", "dark ambient horror drone, fluorescent hum, slow, sparse piano"),
                                      seconds=m.get("seconds", 40), bpm=m.get("bpm"), model=m.get("model"))
                open(raw, "wb").write(data)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-ac", "2", "-ar", "48000", wav], check=True)
            out["music"] = {"path": wav, "volume": m.get("volume", 0.5)}
            print("  music: ok")
        except (mp.MediaUnavailable, subprocess.CalledProcessError) as e:
            out["warnings"].append(f"music: {e}")
    elif os.path.exists(os.path.join(ADIR, "music.wav")):
        os.remove(os.path.join(ADIR, "music.wav"))

    json.dump(out, open(os.path.join(BUILD, "assets.json"), "w"))
    for w in out["warnings"]:
        print("  ! " + w)
    print(f"assets: cover={'yes' if out['cover_art'] else 'no'} portraits={len(out['portraits'])} "
          f"textures={len(out['textures'])} music={'yes' if out['music'] else 'no'} -> build/assets.json")


if __name__ == "__main__":
    main()
