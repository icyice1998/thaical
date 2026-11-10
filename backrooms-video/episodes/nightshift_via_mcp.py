# "เวรดึกที่ไม่มีวันจบ" built through the MCP tools with the user's cast sheet (characters/cast.png).
# Run: SECS=2,20,40,60 [RENDER=1] python3 episodes/nightshift_via_mcp.py
import asyncio, json, os, sys
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

chars = {
 "phum": {"name": "หมอภูมิ", "voice": "aaa0bf6d-bc07-40f2-bc6b-66afc5fd42f6", "look": "doctor", "speed": 1.05, "color": "#5fe0c8",
          "fallback": [{"provider": "edge", "voice": "th-TH-NiwatNeural", "rate": "+10%"}]},
 "ton":  {"name": "ต้น", "voice": "a50a04b8-35ee-487e-8b87-97f0eee68a64", "look": "operator", "speed": 1.08, "color": "#7fb8ff",
          "fallback": [{"provider": "edge", "voice": "th-TH-NiwatNeural", "rate": "+14%", "pitch": "-8Hz"}]},
}
L = [
 ("phum", "ตีสามแล้ว ราวด์วอร์ดรอบสุดท้าย ต้น ได้ยินไหม", None, 0),
 ("ton",  "ได้ยิน กล้องติดแล้ว แต่หมอ ทำไมแผนผังตึกมันยาวผิดปกติ", "curious", 0.35),
 ("phum", "นั่นสิ เดินมาสิบนาทีแล้ว ยังไม่ถึงสุดทางเดินเลย เตียงก็ว่างหมดทุกห้อง", "curious", 0.35),
 ("ton",  "ดูป้ายทางออกสิ ลูกศรชี้กลับไปทางที่หมอเพิ่งเดินผ่านมา", None, 0.35),
 ("phum", "เสียงกริ่งเรียกพยาบาลดัง... มาจากห้องที่ไม่มีคนไข้", "scared", 1.4),
 ("ton",  "อย่าเข้าไปนะ ดูที่พื้น เส้นสีแดงยังอยู่ไหม", "calm", 0.35),
 ("phum", "อยู่ แต่มันพาไปที่ประตูห้องฉุกเฉิน ที่ตึกนี้ไม่เคยมี", "scared", 0.35),
 ("ton",  "ค่อยๆ เปิดดู ถ้าแปลกให้ถอยออกมาทันที", None, 0.35),
 ("phum", "นี่ไม่ใช่โรงพยาบาลแล้ว ห้องสีเหลือง พรมเปียก ไฟนีออนหึ่งไปหมด", "scared", 1.2),
 ("ton",  "นั่นคือ Backrooms เลเวลศูนย์ ห้ามวิ่ง แล้วฟังเสียงไฟไว้", None, 0.35),
 ("phum", "มีไฟฉายตกอยู่บนพื้น เก็บไว้ก่อน", "curious", 0.35),
 ("phum", "ต้น... ไฟดับหมดแล้ว", "scared", 1.6),
 ("ton",  "เปิดไฟฉาย แล้วส่องไปข้างหน้าช้าๆ", "calm", 0.35),
 ("phum", "มีเงาดำยืนอยู่สุดทาง มันยิ้มกว้างผิดปกติ", "scared", 0.35),
 ("ton",  "อย่ามองหน้ามัน พิงกำแพงข้างๆ เลย เร็ว!", "angry", 0.35),
 ("phum", "ทะลุ!", "scared", 0.35),
 ("phum", "ประตูสามบาน กลับบ้าน ลึกลงไป ห้ามเปิด แล้วเพจเจอร์ผมก็สั่นพอดี", "scared", 1.2),
 ("ton",  "เพจเจอร์จากวอร์ดที่ไม่มีอยู่จริง หมอควรเปิดบานไหน เมนต์มาเลย", None, 0.35),
]
lines = [{"who": w, "text": t, **({"emotion": e} if e else {}), "gap_before": g} for w, t, e, g in L]
C = lambda line, type, at="start", offset=0.0, **kw: {"line": line, "type": type, "at": at, "offset": offset, **kw}
cues = [
 C(0, "scene", offset=-1.2, value="ward"), C(0, "title", offset=-1.0, dur=4.0), C(0, "walk", offset=-1.2, value=0.0),
 C(1, "walk", "start", 0.5, value=0.8),
 C(3, "mission", "end", 0.0, value="หาทางกลับ Nurse station"),
 C(4, "lights", "start", -1.4, value=0.45, dur=1.2), C(4, "walk", "start", -0.6, value=0.0), C(4, "shake", "end", -0.4, dur=0.5),
 C(5, "walk", "end", 0.2, value=0.8),
 C(6, "mission", "start", 0.3, value="ภารกิจใหม่ · เดินตามเส้นสีแดง"),
 C(7, "walk", "end", -0.6, value=0.0), C(7, "glitch", "end", 0.0, dur=1.2),
 C(7, "scene", "end", 0.9, value="level0"), C(7, "mission", "end", 0.9, value=""),
 C(8, "walk", "start", 0.3, value=0.75),
 C(9, "mission", "end", 0.0, value="หาทางออก · ห้ามวิ่ง"),
 C(10, "toast", "end", -0.5, value="ได้ของ · ไฟฉาย +1"),
 C(11, "lights", "start", -2.2, value=0.0, dur=2.0), C(11, "walk", "start", -0.4, value=0.0),
 C(12, "flashlight", "end", -0.4, value=1),
 C(13, "entity", "start", 0.0, value=1), C(13, "shake", "end", -0.8, dur=0.8),
 C(14, "mission", "start", 0.3, value="ภารกิจใหม่ · พิงกำแพงที่กระพริบ"),
 C(15, "glitch", "start", -0.3, dur=1.2), C(15, "scene", "end", 0.3, value="doors"),
 C(15, "flashlight", "end", 0.3, value=0), C(15, "entity", "end", 0.3, value=0), C(15, "mission", "end", 0.3, value=""),
 C(17, "endcard", "start", 0.2),
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
            pid = os.environ.get("PID") or json.loads(text(await call("create_project", title="เวรดึกที่ไม่มีวันจบ", subtitle="หลุดมิติ · วอร์ดตีสาม")))["project_id"]
            print("project", pid)
            await call("set_script", project_id=pid, characters=chars, lines=lines)
            await call("set_scenes", project_id=pid, cues=cues)
            await call("set_cast_sheet", project_id=pid, path=f"{REPO}/characters/cast.png", rows=["phum", "ton"], explorer="phum", portraits="ai-photo")
            ga = await call("generate_assets", project_id=pid); print("assets", text(ga)[:300])
            gv = json.loads(text(await call("generate_voice", project_id=pid)))
            print("voice", gv["duration_s"], gv["voices"], gv["warnings"])
            for l in gv["lines"]: print(f'  {l["i"]:2d} {l["start"]:6.2f}-{l["end"]:6.2f} {l["who"]}')
            pr = await call("preview_frame", project_id=pid, seconds=[float(x) for x in os.environ.get("SECS", "2").split(",")])
            print("preview ok")
            if os.environ.get("RENDER"):
                job = json.loads(text(await call("render", project_id=pid, confirmed_by_user=True)))["job_id"]
                while True:
                    st = json.loads(text(await call("job_status", job_id=job)))
                    if st["state"] != "rendering": print(st); break
                    await asyncio.sleep(15)
asyncio.run(main())
