# Presenter-explainer episode: ADA diabetes diagnostic criteria. Built through the MCP tools.
# Run: SECS=1,8,14,22,40 [RENDER=1] python3 episodes/diabetes_explainer_via_mcp.py
import asyncio, json, os, sys
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MINT, YEL, RED = "#5fe0b8", "#f5b942", "#ff6b6b"

chars = {"phum": {"name": "หมอภูมิ", "voice": "aaa0bf6d-bc07-40f2-bc6b-66afc5fd42f6", "look": "doctor", "speed": 1.0,
                  "color": MINT, "fallback": [{"provider": "edge", "voice": "th-TH-NiwatNeural", "rate": "+8%"}]}}
L = [
 ("รู้ไหมครับ ผู้ใหญ่ไทยเกือบหนึ่งในสิบคน เป็นเบาหวาน", "curious",
  {"kind": "counter", "label": "ความชุกเบาหวานในผู้ใหญ่ไทย", "value": 9.5, "decimals": 1, "unit": "%", "pill": "NHES ครั้งที่ 6", "dots": 9.5}),
 ("แล้วหมอใช้อะไรตัดสินว่าใครเป็นเบาหวาน วันนี้สรุปเกณฑ์ของ ADA ให้ในหนึ่งนาที", None,
  {"kind": "title", "text": "เกณฑ์วินิจฉัยเบาหวาน", "sub": "ADA Standards of Care"}),
 ("ข้อแรก น้ำตาลในเลือดหลังงดอาหารอย่างน้อยแปดชั่วโมง ตั้งแต่ร้อยยี่สิบหกขึ้นไป", None,
  {"kind": "threshold", "kicker": "ข้อ 1 · FPG (mg/dL) · งดอาหาร ≥ 8 ชม.", "title": "น้ำตาลหลังงดอาหาร", "min": 70, "max": 160,
   "zones": [{"to": 100, "label": "ปกติ", "range": "< 100", "color": MINT}, {"to": 126, "label": "ก่อนเบาหวาน", "range": "100–125", "color": YEL},
             {"label": "เบาหวาน", "range": "≥ 126", "color": RED}], "cutoff": 126}),
 ("ข้อสอง ดื่มกลูโคสเจ็ดสิบห้ากรัม แล้ววัดที่สองชั่วโมง ตั้งแต่สองร้อยขึ้นไป", None,
  {"kind": "threshold", "kicker": "ข้อ 2 · 75 g OGTT (mg/dL)", "title": "น้ำตาลที่ 2 ชั่วโมง", "min": 100, "max": 260,
   "zones": [{"to": 140, "label": "ปกติ", "range": "< 140", "color": MINT}, {"to": 200, "label": "ก่อนเบาหวาน", "range": "140–199", "color": YEL},
             {"label": "เบาหวาน", "range": "≥ 200", "color": RED}], "cutoff": 200}),
 ("ข้อสาม น้ำตาลสะสม เอชบีเอวันซี ตั้งแต่หกจุดห้าเปอร์เซ็นต์ขึ้นไป", None,
  {"kind": "threshold", "kicker": "ข้อ 3 · HbA1c (%)", "title": "น้ำตาลสะสม", "min": 5.0, "max": 7.5,
   "zones": [{"to": 5.7, "label": "ปกติ", "range": "< 5.7", "color": MINT}, {"to": 6.5, "label": "ก่อนเบาหวาน", "range": "5.7–6.4", "color": YEL},
             {"label": "เบาหวาน", "range": "≥ 6.5", "color": RED}], "cutoff": 6.5, "cutoff_label": "≥ 6.5%",
   "note": "ตรวจด้วยวิธีมาตรฐาน NGSP"}),
 ("ข้อสี่ สุ่มตรวจเวลาไหนก็ได้ ตั้งแต่สองร้อยขึ้นไป ร่วมกับอาการชัดเจน เช่น ปัสสาวะบ่อย กระหายน้ำ น้ำหนักลด", None,
  {"kind": "checklist", "title": "ข้อ 4 · Random ≥ 200 + อาการ", "items": ["ปัสสาวะบ่อย", "กระหายน้ำบ่อย", "น้ำหนักลดโดยไม่ทราบสาเหตุ"]}),
 ("แต่ถ้าไม่มีอาการชัดเจน ต้องผิดปกติสองค่า จะจากเลือดหลอดเดียวกันหรือคนละวันก็ได้", "calm",
  {"kind": "code", "title": "ไม่มีอาการชัดเจน?", "lines": ["if อาการชัด + random ≥ 200", "  then วินิจฉัยได้เลย", "else", "  ต้องผิดปกติ 2 ค่า", "  หลอดเดียวกัน หรือ คนละวัน"]}),
 ("สรุปตัวเลขที่ต้องจำ ร้อยยี่สิบหก สองร้อย หกจุดห้า และสองร้อยพร้อมอาการ", None,
  {"kind": "numbers", "title": "ตัวเลขที่ต้องจำ", "items": [{"value": "126", "label": "FPG (mg/dL)"}, {"value": "200", "label": "OGTT 2 ชม."},
                                                           {"value": "6.5%", "label": "HbA1c", "color": MINT}, {"value": "200", "label": "Random + อาการ", "color": RED}]}),
 ("คลิปนี้เพื่อการศึกษา ถ้าค่าใกล้เกณฑ์ ปรึกษาแพทย์นะครับ", "calm",
  {"kind": "note", "text": "เพื่อการศึกษา ไม่ใช่การวินิจฉัย", "sub": "ค่าใกล้เกณฑ์ ปรึกษาแพทย์"}),
 ("อยากให้สรุปโรคไหนต่อ เมนต์มาเลยครับ", "excited", None),
]
lines = [{"who": "phum", "text": t, **({"emotion": e} if e else {}), "gap_before": 0.45 if i else 0} for i, (t, e, _) in enumerate(L)]
cues = [{"line": i, "type": "card", "at": "start", "offset": -0.3 if i else -1.0, "value": c} for i, (_, _, c) in enumerate(L) if c]
cues.append({"line": len(L) - 1, "type": "endcard", "at": "start", "offset": -0.2, "value": "อยากให้สรุปโรคไหนต่อ?", "sub": "เมนต์มาเลย 👇"})

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
            pid = os.environ.get("PID") or json.loads(text(await call("create_project", title="เบาหวาน วินิจฉัยยังไง",
                     subtitle="สรุปเกณฑ์ ADA ใน 1 นาที", style="presenter-explainer", watermark="เพื่อการศึกษา · ADA Standards of Care")))["project_id"]
            print("project", pid)
            await call("set_script", project_id=pid, characters=chars, lines=lines)
            print(text(await call("set_scenes", project_id=pid, cues=cues)).replace("\n", " "))
            await call("set_cast_sheet", project_id=pid, path=f"{REPO}/characters/cast.png", rows=["phum", "ton"], explorer="phum", portraits="ai-photo")
            print("assets", text(await call("generate_assets", project_id=pid))[:200])
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
