# EP.2 built entirely through the MCP tools (acts as an MCP client). Run: SECS=2,30,60 RENDER=1 python3 episodes/ep2_via_mcp.py
import asyncio, json, os, sys
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

chars = {
 "ton":  {"name": "ต้น", "voice": "a50a04b8-35ee-487e-8b87-97f0eee68a64", "look": "operator", "speed": 1.05, "color": "#7fb8ff",
          "fallback": [{"provider": "edge", "voice": "th-TH-NiwatNeural", "rate": "+12%"}]},
 "mind": {"name": "มายด์", "voice": "ccc7bb22-dcd0-42e4-822e-0731b950972f", "look": "doctor", "speed": 1.05, "color": "#ffd166",
          "fallback": [{"provider": "edge", "voice": "th-TH-PremwadeeNeural", "rate": "+12%"}]},
}
L = [
 ("ton",  "มายด์ ตามที่ทุกคนเมนต์มา เราเลือกเปิดบานห้ามเปิดนะ ได้ยินไหม", None, 0),
 ("mind", "ได้ยิน มือจับเย็นเฉียบเลย เปิดนะ", "scared", 0.35),
 ("mind", "กลับมาห้องสีเหลืองอีกแล้ว แต่ไฟสลัวกว่าเดิม แล้วพรมเปียกจนเท้าจม", "scared", 1.0),
 ("ton",  "นี่ไม่ใช่เลเวลศูนย์ปกติ ดูแผนที่สิ ทางเดินมันขยับเองได้", "curious", 0.35),
 ("mind", "ตรงพื้นมีขวดน้ำ แปะโน้ตไว้ว่า อย่าหันหลัง", "curious", 0.35),
 ("ton",  "ทำตามโน้ตไว้ก่อน เดินหน้าอย่างเดียว ห้ามหันหลังเด็ดขาด", None, 0.35),
 ("mind", "ต้น... มีเสียงฝีเท้าตามมาข้างหลัง", "scared", 1.6),
 ("ton",  "อย่าหันไปนะ เปิดไฟฉาย แล้วเดินต่อไปช้าๆ", "calm", 0.35),
 ("mind", "ข้างหน้าก็มีอะไรยืนอยู่ มันยิ้มเหมือนเดิมเลย", "scared", 0.35),
 ("ton",  "ข้างหน้าก็มี ข้างหลังก็มี งั้นพิงกำแพงข้างๆ เลย ตอนนี้!", "angry", 0.35),
 ("mind", "ทะลุ!", "scared", 0.35),
 ("mind", "วอร์ดเดิมนี่ แต่คราวนี้ทุกเตียงมีผ้าห่มคลุมไว้หมดเลย", "scared", 1.0),
 ("ton",  "อย่าเปิดผ้าห่มดูนะ เดินตามเส้นสีแดงไปห้องฉุกเฉินเหมือนรอบที่แล้ว", None, 0.35),
 ("mind", "ไฟเริ่มกระพริบอีกแล้ว รีบหน่อยนะ", "scared", 1.4),
 ("mind", "ถึงประตูแล้ว เปิดเลยนะ", "excited", 1.2),
 ("mind", "สามบานเดิม แต่บานกลับบ้านโดนล็อก แล้วมีเสียงเคาะมาจากข้างใน", "scared", 1.2),
 ("ton",  "ตอนหน้า จะไปบานลึกลงไป หรือจะเปิดบานที่มีเสียงเคาะ เมนต์มาเลย", None, 0.35),
]
lines = [{"who": w, "text": t, **({"emotion": e} if e else {}), "gap_before": g} for w, t, e, g in L]
C = lambda line, type, at="start", offset=0.0, **kw: {"line": line, "type": type, "at": at, "offset": offset, **kw}
cues = [
 C(0, "scene", offset=-1.2, value="doors"), C(0, "title", offset=-1.0, dur=4.0),
 C(1, "whiteout", "end", 0.0, dur=1.0), C(1, "scene", "end", 0.5, value="level0"), C(1, "walk", "end", 0.5, value=0.0),
 C(1, "lights", "end", 0.6, value=0.45, dur=0.4), C(2, "walk", "start", 0.6, value=0.7),
 C(3, "mission", "end", 0.0, value="หาทางออก · ห้ามหันหลัง"),
 C(4, "toast", "end", -0.6, value="ได้ของ · ขวดน้ำ + โน้ต"),
 C(6, "lights", "start", -2.2, value=0.0, dur=2.0), C(6, "walk", "start", -0.4, value=0.35), C(6, "shake", "end", -0.3, dur=0.5),
 C(7, "flashlight", "end", -0.6, value=1),
 C(8, "entity", "start", 0.0, value=1), C(8, "walk", "start", 0.0, value=0.0), C(8, "shake", "end", -0.8, dur=0.8),
 C(9, "mission", "start", 0.4, value="ภารกิจใหม่ · พิงกำแพงข้างๆ"),
 C(10, "glitch", "start", -0.3, dur=1.2), C(10, "scene", "end", 0.3, value="ward"), C(10, "flashlight", "end", 0.3, value=0),
 C(10, "entity", "end", 0.3, value=0), C(10, "mission", "end", 0.3, value=""), C(10, "walk", "end", 0.9, value=0.85),
 C(12, "mission", "end", 0.0, value="ภารกิจใหม่ · เดินตามเส้นสีแดง"),
 C(13, "lights", "start", -1.4, value=0.45, dur=1.4),
 C(14, "walk", "end", -0.3, value=0.0), C(14, "whiteout", "end", 0.0, dur=1.0),
 C(14, "scene", "end", 0.5, value="doors"), C(14, "mission", "end", 0.5, value=""),
 C(16, "endcard", "start", 0.2),
]

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
            pid = json.loads(text(await call("create_project", title="หลุดเข้า Backrooms", subtitle="EP.2 · บานที่ห้ามเปิด")))["project_id"]
            print("project", pid)
            await call("set_script", project_id=pid, characters=chars, lines=lines)
            print(text(await call("set_scenes", project_id=pid, cues=cues)).replace("\n", " "))
            print(text(await call("set_assets", project_id=pid, image_provider="openai")).replace("\n", " ")[:200])
            print(text(await call("generate_assets", project_id=pid))[:200])
            gv = json.loads(text(await call("generate_voice", project_id=pid)))
            print("voice", gv["duration_s"], gv["voices"], gv["warnings"])
            for l in gv["lines"]: print(f'  {l["i"]:2d} {l["start"]:6.2f}-{l["end"]:6.2f} {l["who"]}')
            pr = await call("preview_frame", project_id=pid, seconds=[float(x) for x in os.environ["SECS"].split(",")])
            print("preview ok", len([c for c in pr.content if c.type == "image"]))
            if os.environ.get("RENDER"):
                job = json.loads(text(await call("render", project_id=pid, confirmed_by_user=True)))["job_id"]
                while True:
                    st = json.loads(text(await call("job_status", job_id=job)))
                    if st["state"] != "rendering": print(st); break
                    await asyncio.sleep(15)
asyncio.run(main())
