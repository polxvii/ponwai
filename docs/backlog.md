# Backlog — ของที่รู้ว่ายังขาด

เรียงจากสำคัญมากไปน้อย · ทำเสร็จแล้วย้ายไปไว้ใน [history.md](history.md) แล้วลบออกจากที่นี่

## สำคัญ

- **Backup / restore ทั้งบัญชีในแอพ** — spec ข้อ 11 #8 กำหนดให้อยู่ใน v1 เพราะ Supabase free tier
  ที่ pause ค้างอาจถูกลบ ตอนนี้มีแค่ส่งออกรายสัญญา (HTML + CSV) ซึ่ง import กลับไม่ได้
  ถ้ามีจะทำให้การย้าย Supabase account (ทาง B ใน [account-migration.md](account-migration.md)) ง่ายลงมาก
  แนวทาง: export JSON ของทุกตารางที่ผู้ใช้เป็นเจ้าของ + import ที่สร้าง id ใหม่และผูก `user_id` ปัจจุบัน
- **ปฏิทินวันหยุดธนาคารปี 2571 ขึ้นไป** — seed มีถึง 2570 เฉพาะวันตายตัว (ไม่มีวันพระ/ชดเชย)
  ต้นปีใหม่ทุกปีต้องเติมตามประกาศ ธปท. ไม่งั้นสัญญาที่ตั้ง `weekend_and_bank_holidays` จะเลื่อนวันผิดเงียบ ๆ

## ควรทำ

- `npm run lint` พัง — ยังไม่ได้ติดตั้ง eslint และไม่มี config
- `public/logo-src.png` (~950 kB) ถูก deploy ขึ้น production ทั้งที่ไม่ได้ใช้
- bundle JS ก้อนเดียว ~1.09 MB — ควร code-split (เช่น Recharts, หน้าแท็บติดตาม)
  ⚠️ ถ้าแยก chunk ต้องตรวจ `sw.js` precache ด้วย (ตอนนี้อ่านชื่อ asset จาก `index.html` ตอนติดตั้ง)
- **npm audit เจอช่องโหว่ใน dev tooling** (ตรวจ 15 ต.ค. 2569) — ไม่กระทบ bundle ที่ส่งให้ผู้ใช้
  - `undici`, `@fastify/busboy`, `sharp`, `esbuild`, `miniflare` มาจาก wrangler 3 → ต้องอัปเกรด **wrangler 4** (major)
    แล้วดู CI ว่า `wrangler deploy` กับ `wrangler pages deploy` ยังผ่าน — ทำเป็น commit แยก revert ง่าย
  - `source-map-js` แก้ได้ด้วย `npm audit fix` ไม่ต้อง bump major

## ตัวเลือกในอนาคต (spec ข้อ 12)

- ดึง MRR อัตโนมัติจาก BOT API (Edge Function + cron, insert-only ลง `reference_rates`)
- parser ใบแจ้งยอด PDF/CSV
- แจ้งเตือนใกล้พ้น lock-in
- ใช้ `reference_rates` / ขั้นอัตราแบบ MRR−spread ในหน้าจอ (engine รองรับแล้ว UI ยังกรอกเป็นเรตคงที่)

## นอกขอบเขต v1 (ตัดสินใจแล้ว อย่าแอบทำ)

- เบิกเงินกู้หลายงวด / ผ่อนดอกอย่างเดียว — เจอเคสนี้ให้หยุดถาม
- กู้ร่วมแบบแชร์บัญชี (`property_members`)
