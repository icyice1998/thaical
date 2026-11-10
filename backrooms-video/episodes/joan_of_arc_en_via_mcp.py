# history-doc: Joan of Arc (English). Public-domain / CC0 / Licence Ouverte art from Wikimedia Commons.
# Run: SECS=2,10,25 [RENDER=1] python3 episodes/joan_of_arc_en_via_mcp.py
import asyncio, json, os, sys
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

images = {
 "coronation": {"file": "File:Ingres coronation charles vii.jpg", "credit": "J.-A.-D. Ingres, 1854 · Public domain · Wikimedia Commons"},
 "voices":     {"file": "File:Joan of Arc MET DP-14201-049.jpg", "credit": "Jules Bastien-Lepage, 1879 · CC0 · The Met / Wikimedia Commons"},
 "sword":      {"file": "File:Joan of Arc Kissing the Sword of Deliverance.jpg", "credit": "D. G. Rossetti, 1863 · Public domain · Wikimedia Commons"},
 "orleans":    {"file": "File:Lenepveu, Jeanne d'Arc au siège d'Orléans.jpg", "credit": "Eugène Lenepveu · Public domain · Wikimedia Commons"},
 "sketch":     {"file": "File:Contemporaine afb jeanne d arc.png", "credit": "Clément de Fauquembergue, 1429 · Public domain · Wikimedia Commons"},
 "capture":    {"file": "File:Vigiles de Charles VII, fol. 70r, prise de Jeanne d'Arc à Compiègne.jpg", "credit": "Vigiles de Charles VII, c. 1484 · Public domain · Wikimedia Commons"},
 "trial":      {"file": "File:Joan of arc interrogation.jpg", "credit": "Paul Delaroche, 1824 · Public domain · Wikimedia Commons"},
 "stake":      {"file": "File:Panthéon - Jeanne d'Arc sur le bûcher (hlw16 0300).jpg", "credit": "Eugène Lenepveu, Panthéon · Licence Ouverte · Wikimedia Commons"},
 "rossetti":   {"file": "File:Joan of Arc by Rossetti.jpg", "credit": "D. G. Rossetti, 1882 · Public domain · Wikimedia Commons"},
}
chars = {"ton": {"name": "Ton", "voice": "5568a7df-e5ab-4442-9fae-2e9ba1b15ad8", "language": "en", "look": "operator", "speed": 1.0,
                 "color": "#ffc94d", "fallback": [{"provider": "edge", "voice": "en-US-AndrewMultilingualNeural"}]}}
T = lambda text, style=None, at=None: {k: v for k, v in dict(text=text, style=style, at=at).items() if v is not None}
L = [
 ("A peasant girl who could not read helped lead the army of France at seventeen, and was burned at the stake at nineteen.",
  {"img": "coronation", "from": [.5, .3, 1.15], "to": [.5, .38, 1.02], "tags": [T("c. 1412 – 1431")]}),
 ("This is Joan of Arc.", None),
 ("She was born around 1412 in Domrémy, a farming village in eastern France, in the middle of the Hundred Years' War.",
  {"img": "voices", "from": [.6, .5, 1.12], "to": [.57, .5, 1.22], "tags": [T("Domrémy · c. 1412"), T("Hundred Years' War", "red")]}),
 ("At about thirteen, she said she began to hear the voices of saints.",
  {"img": "voices", "from": [.6, .4, 1.3], "to": [.62, .36, 1.45], "big": {"text": "Age 13", "sub": "the voices begin", "at": .4}}),
 ("In 1429, at about seventeen, she cut her hair, dressed as a man, and rode about eleven days through enemy land to meet the heir to the throne, Charles.",
  {"img": "sword", "from": [.5, .35, 1.0], "to": [.5, .3, 1.15], "tags": [T("1429 · age 17")], "big": {"text": "~11 days", "sub": "to reach Charles at Chinon", "at": 3.5}}),
 ("The city of Orléans had been under siege since October 1428. Joan arrived on the twenty-ninth of April, and on the eighth of May the English lifted the siege.",
  {"img": "orleans", "from": [.5, .3, 1.05], "to": [.48, .38, 1.2], "tags": [T("Orléans · 1429")],
   "big": {"text": "9 days", "strike": "Besieged since Oct 1428", "at": 4.0}}),
 ("During the fighting, an arrow struck her shoulder. She came back and fought on.",
  {"img": "orleans", "from": [.45, .22, 1.35], "to": [.47, .2, 1.5], "tags": [T("Arrow wound", "red")]}),
 ("The only picture of her made in her lifetime is a doodle by a Paris clerk, dated the tenth of May 1429. He had never seen her.",
  {"img": "sketch", "from": [.5, .5, 1.0], "to": [.5, .5, 1.1], "card": {"img": "sketch", "title": "The only image made in her lifetime", "caption": "Clément de Fauquembergue · 10 May 1429"}}),
 ("That July, Charles was crowned king at Reims, with Joan at his side.",
  {"img": "coronation", "from": [.5, .45, 1.0], "to": [.5, .35, 1.15], "tags": [T("Reims · 17 July 1429")]}),
 ("A year later, she was captured at Compiègne and handed over to the English for ten thousand livres.",
  {"img": "capture", "from": [.5, .35, 1.0], "to": [.5, .45, 1.12], "tags": [T("Captured · 1430", "red")], "big": {"text": "10,000", "sub": "livres", "at": 2.4}}),
 ("At her trial in Rouen, the judges asked if she was in God's grace. A trap with no safe answer.",
  {"img": "trial", "from": [.5, .4, 1.0], "to": [.45, .35, 1.15], "tags": [T("Rouen · 1431")]}),
 ("She replied: if I am not, may God put me there; and if I am, may God keep me there.",
  {"img": "trial", "from": [.45, .3, 1.2], "to": [.42, .28, 1.35], "quote": {"text": "If I am not, may God put me there; and if I am, may God keep me there.", "by": "Joan, at her trial", "type_s": 4.2}}),
 ("On the thirtieth of May 1431, she was burned at the stake. She was about nineteen.",
  {"img": "stake", "from": [.5, .3, 1.0], "to": [.5, .22, 1.12], "tags": [T("30 May 1431 · Rouen", "red")]}),
 ("Twenty-five years later, a retrial declared her innocent. In 1920, she was made a saint.",
  {"img": "rossetti", "from": [.5, .35, 1.0], "to": [.5, .3, 1.12], "timeline": {"y": 470, "points": [{"year": "1431", "label": "burned"}, {"year": "1456", "label": "declared innocent"}, {"year": "1920", "label": "made a saint"}]}}),
 ("At seventeen, would you have been that brave? Tell me in the comments.",
  {"img": "coronation", "from": [.5, .25, 1.25], "to": [.5, .2, 1.4]}),
]
lines = [{"who": "ton", "text": t, "gap_before": 0.35 if i else 0} for i, (t, _) in enumerate(L)]
cues = [{"line": 0, "type": "title", "at": "start", "offset": 4.6, "dur": 4.0}]
cues += [{"line": i, "type": "shot", "at": "start", "offset": -0.35 if i else -1.2, "value": sh} for i, (_, sh) in enumerate(L) if sh]
cues.append({"line": len(L) - 1, "type": "endcard", "at": "start", "offset": 0.0, "value": "Would you have been that brave?", "sub": "Tell me in the comments 👇"})

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
            pid = os.environ.get("PID") or json.loads(text(await call("create_project", title="Joan of Arc", subtitle="The peasant girl who led an army",
                     style="history-doc", watermark="")))["project_id"]
            print("project", pid)
            await call("set_script", project_id=pid, characters=chars, lines=lines)
            print(text(await call("set_scenes", project_id=pid, cues=cues)).replace("\n", " "))
            await call("set_cast_sheet", project_id=pid, path=f"{REPO}/characters/cast.png", rows=["phum", "ton"], explorer="ton", portraits="ai-photo")
            await call("set_images", project_id=pid, images=images)
            print("assets", text(await call("generate_assets", project_id=pid))[:400])
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
