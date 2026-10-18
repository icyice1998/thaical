# การเตรียม Google Apps Script (คู่มือ)

Apps Script ทำหน้าที่เป็น "ตัวต่อ DB" แทนคลาวด์ Claude ได้ เพราะรันบนเซิร์ฟเวอร์
Google ที่ต่อ JDBC/TCP ออกไปยัง MySQL 4.0 ผ่าน ngrok ได้จริง หน้าที่ของมันคือ
อ่านข้อมูลแบบ batch (ไม่ dump) แล้วส่ง stock.json ขึ้น GitHub ให้เว็บอ่าน

```
MySQL 4.0 (เครื่องร้าน) --ngrok--> Apps Script (Google) --push--> GitHub Pages --> เว็บ
         เปิดตอนร้านเปิด            อ่าน batch + ทำ stock.json     data/stock.json
```

## สิ่งที่ต้องเตรียมก่อน (ฝั่ง DB/tunnel)

1. สร้าง **MySQL user แบบ read-only** สำหรับงานนี้ อย่าใช้ root/admin
2. เปิด tunnel บนเครื่องร้าน: `ngrok tcp 3306` จะได้ host:port (เช่น `1.tcp.ap.ngrok.io:24772`)
3. เครื่องร้านต้องเปิดอยู่ตอน Apps Script รัน (เช่น ตั้ง trigger ก่อนปิดร้าน)

> หมายเหตุ: host:port ของ ngrok free เปลี่ยนทุกครั้งที่ restart ถ้าจะใช้ประจำ
> แนะนำ ngrok แบบมี reserved TCP address หรือ Cloudflare Tunnel จะได้ที่อยู่คงที่

## ขั้นตอนตั้งโปรเจกต์ Apps Script

1. ไป https://script.google.com -> **New project** (standalone)
2. สร้างไฟล์ตามนี้ แล้ววางโค้ดจากโฟลเดอร์นี้ (ชื่อไฟล์ใน Apps Script ไม่ต้องมี .gs)
   - `Code`    <- Code.gs   (conn_, testConnection, dumpSchema, tableCounts, peek, runQuery)
   - `Batch`   <- Batch.gs  (batchReadToSheet, batchReadKeyset)
   - `Export`  <- Export.gs (exportStockJson — ดึงแค่ price+qty)
   - `Publish` <- Publish.gs (publishStockJson, exportAndPublish)
3. **Project Settings (เฟือง) -> Script Properties** ใส่ค่า:

   ```
   DB_HOST   = 1.tcp.ap.ngrok.io
   DB_PORT   = 24772
   DB_NAME   = drgstr
   DB_USER   = <read-only user>
   DB_PASS   = <password>
   DB_CHARSET/DB_PARAMS = useUnicode=true&characterEncoding=TIS620

   GH_TOKEN  = <fine-grained PAT: Contents Read&Write เฉพาะ repo thaical>
   GH_REPO   = icyice1998/thaical
   GH_BRANCH = main
   GH_PATH   = data/stock.json
   ```

   > JDBC ใช้ `DB_PARAMS` ต่อท้าย URL ส่วน `DB_CHARSET` มีไว้เผื่ออ่านง่าย — โค้ดใช้ `DB_PARAMS`

## การอนุญาต (Authorization)

รันฟังก์ชันครั้งแรกจะมีหน้าต่างขอสิทธิ์ ให้กด Allow สิ่งที่ขอ:
- External requests (JDBC + UrlFetch ไป GitHub)
- Drive / Documents / Spreadsheets (ไว้เขียนไฟล์ผล)

(ครั้งแรกอาจขึ้น "unverified app" ของคุณเอง -> Advanced -> Go to project)

## ลำดับการทดสอบ

1. รัน **testConnection** -> ควรขึ้น `connected. server version = 4.0.x`
   - ถ้า error auth/handshake ส่งข้อความเต็มมา จะได้รู้ว่า driver รับ old-password ไหม
2. หา column จริงของ `tb_product` (ทางเบา: `runQuery` ใส่ `DESCRIBE tb_product` อ่าน 0 แถวข้อมูล)
3. แก้ CONFIG ใน **Export** ให้ตรงชื่อคอลัมน์ (ID/PRICE/QTY) แล้วรัน **exportStockJson**
   -> ได้ `stock.json` ใน Drive
4. รัน **publishStockJson** -> push `data/stock.json` ขึ้น GitHub (เว็บเห็นภายใน ~1 นาที)

## ตั้งเวลาให้รันเอง (ตอนปิดร้าน)

ในตัวแก้ไข Apps Script -> เมนูนาฬิกา **Triggers** -> Add Trigger:
- Function: **exportAndPublish**
- Event source: Time-driven -> Day timer -> เลือกช่วงเวลา (เช่น 19:00-20:00)

เท่านี้ทุกเย็นระบบจะดึง price+stock แบบ batch แล้ว push ขึ้นเว็บอัตโนมัติ

## แนะนำเพิ่มเติม

- **เริ่มด้วย manual ก่อน**: รัน exportStockJson + publishStockJson เองสัก 2-3 รอบ
  ให้ชัวร์ว่าค่าถูก แล้วค่อยตั้ง trigger
- **catalogue (products.json)** อัปเดตนานๆ ที (เมื่อเพิ่ม/แก้สินค้า) ใช้ batchReadToSheet
  ดึงทั้งตารางครั้งเดียว แล้ว map เป็น products.json — ไม่ต้องตั้ง trigger
- **ซิงก์โค้ดจาก repo** (ออปชัน): ใช้ `clasp` (เครื่องมือ Google) push ไฟล์ .gs จาก repo
  นี้ขึ้น Apps Script แทนการ copy-paste มือ — สะดวกเวลาแก้โค้ดบ่อย
- อย่าใส่รหัส/token ในไฟล์ .gs เด็ดขาด เก็บใน Script Properties เท่านั้น (ไฟล์พวกนี้อยู่ใน repo)
