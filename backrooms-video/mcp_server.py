"""MCP server for the code-rendered short-video pipeline (same tool flow as Genhaha Video):

  list_styles → get_style_guide → create_project → set_script → set_scenes
  → generate_voice → preview_frame → render → job_status

Run:
  python3 mcp_server.py                     # stdio (Claude Code / Claude Desktop)
  python3 mcp_server.py --http --port 8765  # Streamable HTTP at http://127.0.0.1:8765/mcp

Needs CARTESIA_API_KEY in the environment (or a proxy that injects X-API-Key for api.cartesia.ai).
"""
import argparse, json, os, re, shutil, subprocess, sys, threading, time, uuid
from datetime import date

try:  # mcp >= 2.0
    from mcp.server.mcpserver import MCPServer as FastMCP, Image
    MCP_V2 = True
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP, Image
    MCP_V2 = False

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tts_providers as tp  # noqa: E402
import media_providers as mp  # noqa: E402

PROJECTS = os.environ.get("VIDEO_PROJECTS_DIR", os.path.join(HERE, "projects"))
os.makedirs(PROJECTS, exist_ok=True)

STYLES = {
    "backrooms-retro": {
        "name": "Backrooms เกม 3D ย้อนยุค",
        "description": "Found-footage retro raycaster (yellow Level 0, endless hospital ward, three-doors ending), "
                       "VHS HUD with minimap and missions, karaoke Thai subtitles, lip-synced pixel portraits.",
        "aspect": "9:16", "typical_length_s": [45, 120],
        "guide": os.path.join(HERE, "styles", "backrooms-retro.md"),
    },
}
STYLES["presenter-explainer"] = {
    "name": "พิธีกรอธิบาย + กราฟิกเคลื่อนไหว",
    "description": "Cut-out presenter at the bottom, animated info cards above (big counters, bar charts, threshold scales, "
                   "checklists, typed code, number grids, paper notes), karaoke captions, dark navy look. For explainers.",
    "aspect": "9:16", "typical_length_s": [40, 120],
    "guide": os.path.join(HERE, "styles", "presenter-explainer.md"),
}
STYLES["character-explainer"] = {
    "name": "Step-by-step explainer with your character in a 3D set",
    "description": "Three.js cutaway room; your character walks between stations as a billboard; lip-synced host portrait "
                   "in a corner circle; numbered step badges with source chips; lower-third captions; soft music bed.",
    "aspect": "9:16", "typical_length_s": [40, 60],
    "guide": os.path.join(HERE, "styles", "character-explainer.md"),
}
STYLES["history-doc"] = {
    "name": "History documentary (archival paintings + presenter)",
    "description": "Full-bleed public-domain paintings with Ken Burns moves and crossfades, date/place chips, big-number "
                   "boxes with strike-through, archival image cards, typed quotes, timelines, cut-out presenter, captions, credits.",
    "aspect": "9:16", "typical_length_s": [50, 100],
    "guide": os.path.join(HERE, "styles", "history-doc.md"),
}
STATIONS = {"overview", "desk", "sink", "bed", "bedClose", "sharps", "center"}
CARD_KINDS = {"title", "counter", "bars", "threshold", "checklist", "code", "numbers", "note"}
SCENES = {"level0", "ward", "doors"}
CUE_TYPES = {"scene", "walk", "lights", "flashlight", "entity", "shake", "glitch", "whiteout",
             "mission", "toast", "title", "endcard", "card", "pose", "step", "shot"}
LOOKS = {"operator", "doctor", "entity"}
DEFAULT_COLORS = ["#7fb8ff", "#ffd166", "#ff6b6b"]
JOBS = {}

mcp = FastMCP("backrooms-video", instructions=(
    "Make narrated vertical short videos rendered from code. Order: list_styles → get_style_guide (read it fully) → "
    "create_project → set_script → set_scenes → (optional) set_assets → generate_assets → generate_voice → "
    "preview_frame (look before rendering) → "
    "render (confirm the plan with the user first) → job_status until done, then give the user the output path."))


# ---------------- helpers ----------------
def _pdir(project_id):
    if not re.fullmatch(r"[\w\-]+", project_id or ""):
        raise ValueError("invalid project_id")
    d = os.path.join(PROJECTS, project_id)
    if not os.path.isdir(d):
        raise ValueError(f"project {project_id} not found")
    return d


def _load(project_id):
    return json.load(open(os.path.join(_pdir(project_id), "script.json"), encoding="utf-8"))


def _save(project_id, s):
    json.dump(s, open(os.path.join(_pdir(project_id), "script.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def _timeline(project_id):
    p = os.path.join(_pdir(project_id), "build", "timeline.json")
    if not os.path.exists(p):
        raise ValueError("no timeline yet: run generate_voice first")
    return json.load(open(p, encoding="utf-8"))


# ---------------- tools ----------------
@mcp.tool()
def list_styles() -> list[dict]:
    """List the visual styles this server can render."""
    return [{"id": k, **{x: v[x] for x in ("name", "description", "aspect", "typical_length_s")}} for k, v in STYLES.items()]


@mcp.tool()
def get_style_guide(style: str = "backrooms-retro") -> str:
    """Full brief for a style: characters, portrait looks, scenes, every cue type and a proven beat sheet. Read it all before writing a script."""
    if style not in STYLES:
        raise ValueError(f"unknown style; choose from {list(STYLES)}")
    return open(STYLES[style]["guide"], encoding="utf-8").read()


@mcp.tool()
def list_voices(language: str = "th") -> dict:
    """Cartesia voices for a language (use the id as a character's `voice`), plus free edge-tts fallbacks."""
    try:
        voices = tp.cartesia_voices(language)
        err = None
    except Exception as e:  # noqa: BLE001
        voices, err = [], f"cartesia unavailable: {e}"
    return {"cartesia": voices, "error": err,
            "edge_fallbacks": {"th": ["th-TH-NiwatNeural (male)", "th-TH-PremwadeeNeural (female)"]}.get(language, [])}


@mcp.tool()
def create_project(title: str, subtitle: str = "", style: str = "backrooms-retro",
                   watermark: str = "เรื่องสมมติ · ภาพวาดด้วยโค้ด", smooth: bool = True, host: str = "") -> dict:
    """Create an empty project. Returns project_id used by every other tool.
    smooth=True: 60 fps and a 2x sharper 3D view (render takes about 3-4x longer); False: classic 30 fps pixel look."""
    if style not in STYLES:
        raise ValueError(f"unknown style; choose from {list(STYLES)}")
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:24] or "clip"
    pid = f"{time.strftime('%Y%m%d-%H%M%S')}-{slug}"
    os.makedirs(os.path.join(PROJECTS, pid, "build"), exist_ok=True)
    s = {"meta": {"title": title, "subtitle": subtitle, "style": style, "date": date.today().strftime("%b %d %Y").upper(),
                  "watermark": watermark, "fps": 60 if smooth else 30, "render_scale": 2 if smooth else 1,
                  "lead_in": 1.2, "tail": 3.5, **({"host": host} if host else {})},
         "voices": {}, "lines": []}
    _save(pid, s)
    return {"project_id": pid, "path": os.path.join(PROJECTS, pid)}


@mcp.tool()
def set_script(project_id: str, characters: dict, lines: list[dict]) -> dict:
    """Set characters and dialogue.

    characters: {"ton": {"name": "ต้น", "voice": "<cartesia id>", "look": "operator", "speed": 1.05, "color": "#7fb8ff",
                         "portrait_prompt": "(optional, for AI portraits) young Thai man with headset ..."}, ...}
    lines: [{"who": "ton", "text": "...", "emotion": "scared", "gap_before": 0.35}, ...]
    Replaces existing lines (and their cues).
    """
    if not 1 <= len(characters) <= 3:
        raise ValueError("use 1-3 characters")
    s = _load(project_id)
    voices = {}
    for i, (k, c) in enumerate(characters.items()):
        if not re.fullmatch(r"[a-zA-Z]\w{0,15}", k):
            raise ValueError(f"character id {k!r}: use a short latin id")
        look = c.get("look", "operator" if i == 0 else "doctor")
        if look not in LOOKS:
            raise ValueError(f"look must be one of {sorted(LOOKS)}")
        v = {"name": c.get("name", k), "provider": c.get("provider", "cartesia"), "voice": c["voice"],
             "model": c.get("model", "sonic-3"), "speed": float(c.get("speed", 1.05)), "look": look,
             "color": c.get("color", DEFAULT_COLORS[i % 3]), "fallback": c.get("fallback", [])}
        if c.get("portrait_prompt"): v["portrait_prompt"] = c["portrait_prompt"]
        if c.get("images"): v["images"] = c["images"]
        if c.get("language"): v["language"] = c["language"]
        if v["provider"] == "edge":
            v.update({"rate": c.get("rate", "+12%"), "pitch": c.get("pitch", "+0Hz")})
        voices[k] = v
    out = []
    for n, ln in enumerate(lines):
        if ln.get("who") not in voices:
            raise ValueError(f"line {n}: who={ln.get('who')!r} is not a character")
        if not ln.get("text", "").strip():
            raise ValueError(f"line {n}: empty text")
        e = {"who": ln["who"], "text": ln["text"].strip()}
        for k in ("emotion", "gap_before"):
            if k in ln: e[k] = ln[k]
        out.append(e)
    s["voices"], s["lines"] = voices, out
    _save(project_id, s)
    return {"ok": True, "characters": list(voices), "lines": len(out),
            "next": "set_scenes, then generate_voice"}


@mcp.tool()
def set_scenes(project_id: str, cues: list[dict], replace: bool = True) -> dict:
    """Attach scene/effect cues to lines. Each cue: {"line": int, "type": str, "at": "start"|"end", "offset": s, "value": ..., "dur": s}.
    See get_style_guide for every type. A `scene level0` cue on line 0 is added automatically if no scene is set."""
    s = _load(project_id)
    if not s["lines"]:
        raise ValueError("set_script first")
    if replace:
        for ln in s["lines"]: ln["cues"] = []
    for c in cues:
        i, t = c.get("line"), c.get("type")
        if not isinstance(i, int) or not 0 <= i < len(s["lines"]):
            raise ValueError(f"cue {c}: bad line index")
        if t not in CUE_TYPES:
            raise ValueError(f"cue {c}: type must be one of {sorted(CUE_TYPES)}")
        if t == "card" and (not isinstance(c.get("value"), dict) or c["value"].get("kind") not in CARD_KINDS):
            raise ValueError(f"cue {c}: card value must be an object with kind in {sorted(CARD_KINDS)}")
        if t == "shot" and (not isinstance(c.get("value"), dict) or not c["value"].get("img")):
            raise ValueError(f"cue {c}: shot value needs img (a key from set_images)")
        if t == "step" and (not isinstance(c.get("value"), dict) or "n" not in c["value"] or "title" not in c["value"]
                            or c["value"].get("station", "center") not in STATIONS):
            raise ValueError(f"cue {c}: step value needs n, title and station in {sorted(STATIONS)}")
        if t == "scene" and c.get("value") not in SCENES:
            raise ValueError(f"cue {c}: scene must be one of {sorted(SCENES)}")
        cc = {k: c[k] for k in ("type", "value", "dur", "at", "offset", "sub") if k in c}
        cc.setdefault("at", "start")
        s["lines"][i].setdefault("cues", []).append(cc)
    if s["meta"].get("style") == "backrooms-retro" and not any(c["type"] == "scene" for ln in s["lines"] for c in ln.get("cues", [])):
        s["lines"][0].setdefault("cues", []).insert(0, {"type": "scene", "value": "level0", "at": "start", "offset": -1.2})
    _save(project_id, s)
    return {"ok": True, "cues": sum(len(ln.get("cues", [])) for ln in s["lines"]), "next": "generate_voice"}


@mcp.tool()
def set_assets(project_id: str, image_provider: str = "openai", cover_prompt: str | None = None,
               portraits: str = "code", textures: str = "code", music_prompt: str | None = None,
               music_bpm: int | None = None, music_seconds: int = 40, music_volume: float = 0.5,
               music_model: str | None = None, scene_model: str | None = None) -> dict:
    """Optional AI media (OpenAI or Google images, Google Lyria music). Keys come from the server's environment.

    image_provider: "openai" (gpt-image) | "google" (Imagen)
    cover_prompt: scene for the 9:16 cover art (title is drawn on top); omit for a cover made from the 3D scene
    portraits: "code" | "ai-pixel" | "ai-photo" (needs portrait_prompt on each character in set_script)
    textures: "code" | "ai" (wall/floor/ceiling tiles for level0 and ward)
    music_prompt: Lyria prompt for the background score, e.g. "slow dark ambient, detuned synth pad, distant piano"; omit for the synthesized drone
    music_model: "lyria-3-clip-preview" (default) | "lyria-3-pro-preview" | "realtime"
    scene_model: path to a Blender-exported .glb set for character-explainer (default: models/clinic.glb; "none" = code-built room)
    """
    if image_provider not in mp.IMAGE_PROVIDERS:
        raise ValueError(f"image_provider must be one of {list(mp.IMAGE_PROVIDERS)}")
    if portraits not in ("code", "ai-pixel", "ai-photo") or textures not in ("code", "ai"):
        raise ValueError("portraits: code|ai-pixel|ai-photo, textures: code|ai")
    s = _load(project_id)
    a = {"image_provider": image_provider, "portraits": portraits, "textures": textures}
    if cover_prompt: a["cover"] = {"prompt": cover_prompt}
    if music_prompt:
        a["music"] = {"prompt": music_prompt, "seconds": music_seconds, "volume": music_volume}
        if music_bpm: a["music"]["bpm"] = music_bpm
        if music_model: a["music"]["model"] = music_model
    if scene_model: a["scene_model"] = None if scene_model == "none" else scene_model
    s["assets"] = {**s.get("assets", {}), **a}
    _save(project_id, s)
    av = mp.available()
    need = []
    if (cover_prompt or portraits != "code" or textures != "code") and not av[f"{image_provider}_images"]:
        need.append("OPENAI_API_KEY" if image_provider == "openai" else "GEMINI_API_KEY")
    if music_prompt and not av["lyria_music"]: need.append("GEMINI_API_KEY")
    return {"ok": True, "assets": a, "missing_keys": sorted(set(need)), "next": "generate_assets, then generate_voice"}


@mcp.tool()
def set_character_images(project_id: str, character: str, portrait: str | None = None, portrait_talk: str | None = None,
                         sprite_front: str | None = None, sprite_back: str | None = None) -> dict:
    """Use your own character art (e.g. made in ChatGPT). Values are file paths (absolute, or relative to the project
    or backrooms-video folder) or http(s) URLs.
    portrait / portrait_talk: square head-and-shoulders, same framing, mouth closed / mouth open (gives lip-sync).
    sprite_front / sprite_back: full body, plain or transparent background; makes this character the explorer in 3D.
    Then run generate_assets."""
    s = _load(project_id)
    if character not in s["voices"]:
        raise ValueError(f"unknown character; have {list(s['voices'])}")
    imgs = {k: v for k, v in dict(portrait=portrait, portrait_talk=portrait_talk,
                                  sprite_front=sprite_front, sprite_back=sprite_back).items() if v}
    s["voices"][character].setdefault("images", {}).update(imgs)
    _save(project_id, s)
    return {"ok": True, "character": character, "images": s["voices"][character]["images"], "next": "generate_assets"}


@mcp.tool()
def set_cast_sheet(project_id: str, path: str, rows: list[str] | None = None, explorer: str | None = None,
                   portraits: str = "ai-photo") -> dict:
    """Use ONE image holding the whole cast (e.g. made in ChatGPT): a grid with one row per character and 4 equal
    columns: portrait mouth closed | portrait mouth open | full body front | full body back.
    rows: one id per row of the sheet, top to bottom, including rows not used in this episode (default: script order). explorer: who walks in 3D (default: first row).
    portraits: "ai-photo" (smooth, for photo/anime art) or "ai-pixel" (pixelated). Then run generate_assets."""
    s = _load(project_id)
    rows = rows or list(s["voices"])  # list EVERY row of the sheet; rows naming no character here are skipped
    if not any(r in s["voices"] for r in rows):
        raise ValueError(f"no row matches a character; have {list(s['voices'])}")
    a = s.setdefault("assets", {})
    a["cast_sheet"] = {"path": path, "rows": rows, "explorer": explorer or rows[0]}
    a["portraits"] = portraits
    _save(project_id, s)
    return {"ok": True, "cast_sheet": a["cast_sheet"], "next": "generate_assets"}


@mcp.tool()
def set_images(project_id: str, images: dict) -> dict:
    """Archival/stock images for shots: {key: "File:<Wikimedia Commons title>" | path | URL | {"file": ..., "credit": "short credit"}}.
    Commons files are downloaded with artist/licence metadata and credited on screen. Prefer public domain / CC0 / Licence Ouverte.
    Then reference keys in `shot` cues and run generate_assets."""
    s = _load(project_id)
    s.setdefault("assets", {})["images"] = images
    _save(project_id, s)
    return {"ok": True, "images": list(images), "next": "generate_assets"}


@mcp.tool()
def generate_assets(project_id: str) -> list:
    """Generate the AI cover art, portraits, textures and music set by set_assets (cached). Returns a summary and preview images.
    Run generate_voice afterwards so the music is mixed in."""
    d = _pdir(project_id)
    r = subprocess.run([sys.executable, os.path.join(HERE, "build_assets.py"), d], capture_output=True, text=True, timeout=1800)
    if r.returncode:
        raise RuntimeError((r.stdout + r.stderr)[-2000:])
    a = json.load(open(os.path.join(d, "build", "assets.json")))
    out = [json.dumps({"cover_art": bool(a["cover_art"]), "portraits": list(a["portraits"]), "textures": list(a["textures"]),
                       "music": bool(a["music"]), "warnings": a["warnings"]}, ensure_ascii=False)]
    import base64 as b64, io
    from PIL import Image as PILImage
    def thumb(src, size):
        im = PILImage.open(io.BytesIO(b64.b64decode(src.split(",", 1)[1]))).convert("RGB")
        im = im.resize(size, PILImage.NEAREST if im.width < 100 else PILImage.LANCZOS)
        buf = io.BytesIO(); im.save(buf, "JPEG", quality=80); return Image(data=buf.getvalue(), format="jpeg")
    if a["cover_art"]: out += ["cover art", thumb(a["cover_art"], (270, 480))]
    for k, p in a["portraits"].items(): out += [f"portrait {k}", thumb(p["src"], (200, 220))]
    if a["textures"]:
        ims = [PILImage.open(io.BytesIO(b64.b64decode(v.split(",", 1)[1]))).convert("RGB").resize((96, 96), PILImage.NEAREST)
               for v in a["textures"].values()]
        sheet = PILImage.new("RGB", (96 * len(ims), 96))
        for i, im in enumerate(ims): sheet.paste(im, (96 * i, 0))
        buf = io.BytesIO(); sheet.save(buf, "JPEG", quality=85)
        out += ["textures: " + ", ".join(a["textures"]), Image(data=buf.getvalue(), format="jpeg")]
    return out


@mcp.tool()
def get_project(project_id: str) -> dict:
    """Current script.json of a project plus which build files exist."""
    d = _pdir(project_id)
    return {"script": _load(project_id),
            "built": sorted(f for f in os.listdir(os.path.join(d, "build")) if not os.path.isdir(os.path.join(d, "build", f)))}


@mcp.tool()
def generate_voice(project_id: str) -> dict:
    """Synthesize every line (Cartesia, cached), time the lines, mix ambience and SFX. Returns line timings and total length."""
    d = _pdir(project_id)
    r = subprocess.run([sys.executable, os.path.join(HERE, "build_audio.py"), d], capture_output=True, text=True, timeout=1200)
    if r.returncode:
        raise RuntimeError((r.stdout + r.stderr)[-2000:])
    tl = _timeline(project_id)
    return {"duration_s": tl["duration"], "frames": tl["frames"],
            "voices": {k: f"{v.get('provider', 'edge')}:{v['voice']}" for k, v in tl["voices"].items()},
            "lines": [{"i": l["i"], "who": l["who"], "start": l["start"], "end": l["end"], "text": l["text"]} for l in tl["lines"]],
            "warnings": [x for x in r.stdout.splitlines() if x.strip().startswith("!")],
            "next": "preview_frame at a few key seconds, then render"}


@mcp.tool()
def preview_frame(project_id: str, seconds: list[float]) -> list:
    """Render still frames (max 6) at the given seconds and return them as images (540x960) to check before rendering."""
    if not seconds:
        raise ValueError("give at least one second")
    _timeline(project_id)
    d = _pdir(project_id)
    secs = [f"{round(float(x), 2):g}" for x in seconds[:6]]  # same spelling JS uses for still-<sec>.png
    r = subprocess.run(["node", os.path.join(HERE, "capture.js"), "--project", d, "--stills", ",".join(secs)],
                       capture_output=True, text=True, timeout=300)
    if r.returncode:
        raise RuntimeError(r.stderr[-2000:])
    out = []
    for x in secs:
        src = os.path.join(d, "build", f"still-{x}.png")
        small = os.path.join(d, "build", f"preview-{x}.jpg")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", "scale=540:-1", "-q:v", "4", small], check=True)
        out += [f"t={x}s", Image(path=small)]
    return out


def _run_job(job_id, project_id, d):
    job = JOBS[job_id]
    log = open(os.path.join(d, "build", f"render-{job_id}.log"), "w")
    try:
        p = subprocess.Popen(["node", os.path.join(HERE, "capture.js"), "--project", d],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        frames = _timeline(project_id)["frames"]
        workers = {}
        for line in p.stdout:
            log.write(line); log.flush()
            m = re.match(r"progress worker=(\d+) (\d+)/(\d+)", line)
            if m:
                workers[m.group(1)] = int(m.group(2))
                job["progress"] = round(min(0.99, sum(workers.values()) / frames), 3)
        if p.wait():
            raise RuntimeError("capture failed; see " + log.name)
        title = _load(project_id)["meta"]["title"]
        name = re.sub(r"[^\w\-]+", "-", f"{project_id}").strip("-") + ".mp4"
        final = os.path.join(d, name)
        shutil.copy(os.path.join(d, "build", "out.mp4"), final)
        cover = os.path.join(d, "build", "cover.jpg")
        if os.path.exists(cover):
            shutil.copy(cover, os.path.join(d, "cover-9x16.jpg")); job["cover_path"] = os.path.join(d, "cover-9x16.jpg")
        job.update(state="done", progress=1.0, output_path=final, title=title,
                   size_mb=round(os.path.getsize(final) / 1e6, 1), finished=time.time())
    except Exception as e:  # noqa: BLE001
        job.update(state="error", error=str(e))
    finally:
        log.close()


@mcp.tool()
def render(project_id: str, confirmed_by_user: bool) -> dict:
    """Render the full video in the background (about 1.5x real time on 4 cores). Confirm the plan with the user first."""
    if not confirmed_by_user:
        return {"ok": False, "message": "Show the user the script, length and previews, and render only after they confirm."}
    _timeline(project_id)
    d = _pdir(project_id)
    job_id = uuid.uuid4().hex[:10]
    JOBS[job_id] = {"job_id": job_id, "project_id": project_id, "state": "rendering", "progress": 0.0, "started": time.time()}
    threading.Thread(target=_run_job, args=(job_id, project_id, d), daemon=True).start()
    return {"job_id": job_id, "next": "poll job_status every ~20 s"}


@mcp.tool()
def job_status(job_id: str) -> dict:
    """Progress of a render job; when done, includes output_path to the mp4."""
    if job_id not in JOBS:
        raise ValueError("unknown job_id (jobs live only while the server runs)")
    j = dict(JOBS[job_id])
    j["elapsed_s"] = round((j.get("finished") or time.time()) - j["started"], 1)
    return j


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--http", action="store_true", help="serve Streamable HTTP instead of stdio")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    if a.http:
        if MCP_V2:
            mcp.run(transport="streamable-http", host=a.host, port=a.port)
        else:
            mcp.settings.host, mcp.settings.port = a.host, a.port
            mcp.run(transport="streamable-http")
    else:
        mcp.run()
