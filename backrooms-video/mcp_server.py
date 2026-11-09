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
SCENES = {"level0", "ward", "doors"}
CUE_TYPES = {"scene", "walk", "lights", "flashlight", "entity", "shake", "glitch", "whiteout",
             "mission", "toast", "title", "endcard"}
LOOKS = {"operator", "doctor", "entity"}
DEFAULT_COLORS = ["#7fb8ff", "#ffd166", "#ff6b6b"]
JOBS = {}

mcp = FastMCP("backrooms-video", instructions=(
    "Make narrated vertical short videos rendered from code. Order: list_styles → get_style_guide (read it fully) → "
    "create_project → set_script → set_scenes → generate_voice → preview_frame (look before rendering) → "
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
                   watermark: str = "เรื่องสมมติ · ภาพวาดด้วยโค้ด") -> dict:
    """Create an empty project. Returns project_id used by every other tool."""
    if style not in STYLES:
        raise ValueError(f"unknown style; choose from {list(STYLES)}")
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:24] or "clip"
    pid = f"{time.strftime('%Y%m%d-%H%M%S')}-{slug}"
    os.makedirs(os.path.join(PROJECTS, pid, "build"), exist_ok=True)
    s = {"meta": {"title": title, "subtitle": subtitle, "style": style, "date": date.today().strftime("%b %d %Y").upper(),
                  "watermark": watermark, "fps": 30, "lead_in": 1.2, "tail": 3.5},
         "voices": {}, "lines": []}
    _save(pid, s)
    return {"project_id": pid, "path": os.path.join(PROJECTS, pid)}


@mcp.tool()
def set_script(project_id: str, characters: dict, lines: list[dict]) -> dict:
    """Set characters and dialogue.

    characters: {"ton": {"name": "ต้น", "voice": "<cartesia id>", "look": "operator", "speed": 1.05, "color": "#7fb8ff"}, ...}
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
        if t == "scene" and c.get("value") not in SCENES:
            raise ValueError(f"cue {c}: scene must be one of {sorted(SCENES)}")
        cc = {k: c[k] for k in ("type", "value", "dur", "at", "offset") if k in c}
        cc.setdefault("at", "start")
        s["lines"][i].setdefault("cues", []).append(cc)
    if not any(c["type"] == "scene" for ln in s["lines"] for c in ln.get("cues", [])):
        s["lines"][0].setdefault("cues", []).insert(0, {"type": "scene", "value": "level0", "at": "start", "offset": -1.2})
    _save(project_id, s)
    return {"ok": True, "cues": sum(len(ln.get("cues", [])) for ln in s["lines"]), "next": "generate_voice"}


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
