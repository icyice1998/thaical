# English character-explainer: what happens in an acupuncture session (sourced: NHS, NCCIH/FDA).
# Run: SECS=2,9,17 [RENDER=1] python3 episodes/acupuncture_en_via_mcp.py
import asyncio, json, os, sys
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

chars = {"phum": {"name": "Dr. Phum", "voice": "b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1", "language": "en", "look": "doctor",
                  "speed": 1.0, "color": "#5fe0b8",
                  "fallback": [{"provider": "edge", "voice": "en-US-AndrewMultilingualNeural", "rate": "+0%"}]}}
S = lambda n, title, station, *chips: {"n": n, "title": title, "station": station, "chips": list(chips)}
L = [
 ("What actually happens during an acupuncture session? Let's walk through it, step by step.", "curious", None),
 ("Step one, check in. Tell the practitioner about your health and your medicines, especially blood thinners or any bleeding risk.", None,
  S(1, "Check in", "desk", "NHS")),
 ("Step two, clean technique. Hands are washed, and every needle is sterile and made for single use only.", None,
  S(2, "Clean technique", "sink", "NCCIH", "FDA: sterile, single use")),
 ("Step three, insertion. Very fine needles go into the skin at chosen points on the body.", "calm",
  S(3, "Insertion", "bed", "NCCIH")),
 ("Step four, stimulation. The needles may be turned gently by hand, or stimulated with a small electrical current, while you rest.", "calm",
  S(4, "Stimulation", "bedClose", "NCCIH")),
 ("Step five, removal. The needles come out and go straight into a sharps bin. They are never reused.", None,
  S(5, "Removal", "sharps", "FDA: single use")),
 ("Step six, safety. Done badly, acupuncture can cause infections or even punctured organs, so choose a trained, licensed practitioner.", None,
  S(6, "Choose a pro", "center", "NCCIH")),
 ("In the UK, the NHS may offer it for long-term pain and migraine-type headaches. Please, don't try this at home.", None, None),
]
lines = [{"who": "phum", "text": t, **({"emotion": e} if e else {}), "gap_before": 0.4 if i else 0} for i, (t, e, _) in enumerate(L)]
cues = [{"line": 0, "type": "title", "at": "start", "offset": -1.0, "dur": 4.6}]
cues += [{"line": i, "type": "step", "at": "start", "offset": -0.2, "value": st} for i, (_, _, st) in enumerate(L) if st]
cues.append({"line": len(L) - 1, "type": "endcard", "at": "start", "offset": 0.0,
             "value": "See a licensed practitioner", "sub": "Education only · not medical advice"})

async def main():
    params = StdioServerParameters(command=sys.executable, args=[f"{REPO}/mcp_server.py"], env={**os.environ})
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            def text(res): return "".join(c.text for c in res.content if c.type == "text")
            async def call(name, **kw):
                res = await s.call_tool(name, kw)
                if getattr(res, "is_error", None) or getattr(res, "isError", None): raise SystemExit(f"{name} ERROR: {text(res)}")
                return res
            pid = os.environ.get("PID") or json.loads(text(await call("create_project", title="How Acupuncture Is Done",
                     subtitle="What happens in a session", style="character-explainer", host="Dr. Phum",
                     watermark="Education only · Sources: NHS, NCCIH")))["project_id"]
            print("project", pid)
            await call("set_script", project_id=pid, characters=chars, lines=lines)
            print(text(await call("set_scenes", project_id=pid, cues=cues)).replace("\n", " "))
            await call("set_cast_sheet", project_id=pid, path=f"{REPO}/characters/cast.png", rows=["phum", "ton"], explorer="phum", portraits="ai-photo")
            print("assets", text(await call("generate_assets", project_id=pid))[:240])
            gv = json.loads(text(await call("generate_voice", project_id=pid)))
            print("voice", gv["duration_s"], gv["voices"], gv["warnings"])
            for l in gv["lines"]: print(f'  {l["i"]:2d} {l["start"]:6.2f}-{l["end"]:6.2f}')
            await call("preview_frame", project_id=pid, seconds=[float(x) for x in os.environ.get("SECS", "2").split(",")])
            print("preview ok")
            if os.environ.get("RENDER"):
                job = json.loads(text(await call("render", project_id=pid, confirmed_by_user=True)))["job_id"]
                while True:
                    st = json.loads(text(await call("job_status", job_id=job)))
                    if st["state"] != "rendering": print(st); break
                    await asyncio.sleep(15)
asyncio.run(main())
