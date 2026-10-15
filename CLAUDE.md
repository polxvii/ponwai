# PonWai (ผ่อนไหว)

PWA ภาษาไทยเปรียบเทียบ/รีไฟแนนซ์/ติดตามสินเชื่อบ้าน — ตารางผ่อนต้องตรงใบแจ้งยอดธนาคาร **ระดับสตางค์**
React 19 + Vite + Tailwind · engine pure TS · Supabase (schema `ponwai`) · Cloudflare Pages + Worker

**เริ่มงานทุกครั้ง:** อ่าน [docs/README.md](docs/README.md) — ถ้าจะแตะตัวเลข อ่าน [docs/domain-rules.md](docs/domain-rules.md) ก่อน
ผู้ใช้สื่อสารภาษาไทย ตอบเป็นภาษาไทย

## คำสั่ง

```bash
npm run dev          # :5173
npm test             # ต้องเขียวก่อน commit
npm run typecheck
npm run build        # typecheck + vite build
```

push `main` = CI test แล้ว deploy ขึ้น https://ponwai.pages.dev อัตโนมัติ — เช็คสถานะ CI ตามวิธีใน [docs/operations.md](docs/operations.md#ci--deploy)
(ถ้าเครื่องไม่มี `gh` ใช้ GitHub API สาธารณะผ่าน curl ได้ เพราะ repo เป็น public)

## กฎที่ห้ามละเมิด

**ความปลอดภัย** (repo เป็น public)
- ⛔ Supabase secret / service_role key ห้ามอยู่ใน `.env` ห้ามแปะในแชท ห้าม commit — ถ้าต้องใช้ อยู่ใน Cloudflare Worker secret เท่านั้น
- `.env` commit ได้ เพราะมีแต่ publishable key · credential อื่นอยู่ `.env.local` (gitignored) เท่านั้น
- ⛔ ห้ามให้ผู้ใช้แปะรหัสผ่านบัญชีทดสอบในแชท — อ่านจาก `.env.local` เอง
- ⛔ ห้ามใส่ตัวเลขสัญญาจริงของผู้ใช้ลง repo (โค้ด เทสต์ เอกสาร commit message) ใช้ตัวเลขสมมติ

**ข้อมูล**
- ⛔ `payments` ห้าม hard delete (ไม่มี DELETE policy) — soft delete ด้วย `deleted_at`
- ⛔ ห้าม drop `prepay_lumps` · ห้ามให้ผู้ใช้ลบ `bank_holidays` ที่ `user_id is null` · `reference_rates` แก้ไม่ได้ (สร้างแถวใหม่)
- ⛔ แก้สัญญาห้ามลบแล้วสร้างใหม่ — cascade ลบประวัติการจ่าย
- ⛔ Service worker ห้าม cache request ไป Supabase · แก้ `public/sw.js` ต้องขึ้น `VERSION`
- ⛔ `deploy/pages/_redirects` ห้ามย้ายไป `public/` (ทำ `wrangler deploy` ตาย)

**ตัวเลข** — รายละเอียดและเหตุผลอยู่ใน docs/domain-rules.md
- เงินเป็น bigint (`Satang`, `Fixed`) อัตราเป็น bps ⛔ ห้าม float · ดอกคิดรายวัน ⛔ ห้าม `/12`
- วันที่เป็น civil date `'YYYY-MM-DD'` ⛔ ห้าม `Date` ของ JS ใน `src/engine/` · UI แสดง พ.ศ. ผ่าน `format.ts` ที่เดียว
- แสดงเงินมีสตางค์เสมอ ⛔ ห้ามส่ง `0` ทศนิยมเข้า `baht`/`bahtFixed`/`bahtNumber`
- คอลัมน์โปะใช้ `prepayOfRow` เท่านั้น · สัญญาที่ปิดแล้วตัดตารางด้วย `rowsUntilClose` ทุกที่ · ความจริงชนะแผนโปะเสมอ
- เพดานลดหย่อน 100,000 เป็นของ **คน** ไม่ใช่สัญญา — คิดรวมทุกสัญญา
- อ่านคอมเมนต์ ⛔ ในไฟล์ก่อนแก้ทุกครั้ง — แต่ละอันคือบั๊กที่เคยเกิดจริง

## วิธีทำงาน

- แก้บั๊กตัวเลข: เขียนเทสต์ที่ทำซ้ำบั๊กให้เห็นแดงก่อน แล้วค่อยแก้ ตั้งชื่อ `TV-<เลขถัดไป>`
- ยืนยันกับผู้ใช้ด้วยตัวเลขจริงจาก engine ไม่ใช่ประมาณเอา
- commit message ภาษาไทย บอกว่าแก้อะไรและทำไม

## เอกสารต้องตามโค้ดทัน

แก้โค้ดแล้วอัปเดต `docs/` ใน commit เดียวกัน ตามตารางใน [docs/README.md](docs/README.md#การดูแลเอกสาร--ต้องอัปเดตใน-commit-เดียวกับโค้ด)
TV ใหม่ → แถวใน `docs/test-vectors.md` · migration ใหม่ → `docs/data-model.md`
แก้ diagram → `docs/diagrams.md` แล้วรัน `node scripts/docs-diagrams.mjs` · เรื่องระดับภาพรวม → `docs/project-summary.html` ด้วย
(TV-56 ตรวจให้ ไม่ครบ CI แดง)
