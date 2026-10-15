# ภาพรวมโปรเจกต์

## PonWai (ผ่อนไหว) คืออะไร

PWA ภาษาไทยสำหรับคนผ่อนบ้าน ทำสามเรื่อง

| แท็บ | สำหรับ | ล็อกอิน | ข้อมูลอยู่ที่ |
|---|---|---|---|
| **เปรียบเทียบ** | ก่อนเซ็นสัญญา — จัดอันดับข้อเสนอหลายธนาคารให้ถูก | ไม่ต้อง | localStorage ในเครื่อง |
| **รีไฟแนนซ์** | ผ่อนอยู่แล้ว — เทียบ อยู่ต่อ / ขอลดดอก / ย้ายธนาคาร | ไม่ต้อง | localStorage ในเครื่อง |
| **ติดตาม** | สัญญาที่ผ่อนจริง — บันทึกการจ่าย ตารางผ่อน วางแผนโปะ กระทบยอด | ต้อง | Supabase |

**เป้าหมายหลักที่ทุกอย่างหมุนรอบ:** ตารางผ่อนต้องตรงกับใบแจ้งยอดธนาคาร **ระดับสตางค์**
ถ้าไม่ตรงต้องบอกได้ว่าต่างเท่าไหร่และน่าจะเพราะอะไร — ไม่ปัดตกเงียบ ๆ

เหตุผลที่ต้องมีแอพนี้: เครื่องคิดเลขสินเชื่อทั่วไปคิดดอก `/12` ใช้ "ดอกเฉลี่ย 3 ปี" จัดอันดับ
ไม่รวมค่าธรรมเนียม/MRTA และไม่สนใจว่าธนาคารตัดดอกตามวันจริง — ตัวเลขจึงผิดตั้งแต่งวดแรก

## URL

| | URL | หมายเหตุ |
|---|---|---|
| หลัก | https://ponwai.pages.dev | Cloudflare Pages |
| สำรอง | https://ponwai.pv-proj.workers.dev | Cloudflare Worker — ตัวที่ถือ cron keep-alive |
| dev | http://localhost:5173 | `npm run dev` |
| repo | https://github.com/polxvii/ponwai | **public** |

⚠️ ทั้งสามโดเมนต้องอยู่ใน Supabase → Authentication → URL Configuration → Redirect URLs
ไม่งั้นล็อกอินด้วย Google แล้วเด้งกลับไม่ได้

## Stack

| ชั้น | ใช้อะไร |
|---|---|
| UI | React 19, Vite 8, Tailwind 4, Recharts 3 |
| ภาษา | TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) |
| เครื่องคำนวณ | pure TS ใน `src/engine/` เงินเป็น bigint ล้วน |
| ฐานข้อมูล + login | Supabase free tier — schema `ponwai`, RLS ทุกตาราง |
| Hosting | Cloudflare Pages + Worker (static assets + cron) |
| CI/CD | GitHub Actions — typecheck → test → build → deploy |
| ทดสอบ | Vitest — หลายร้อยเทสต์ แกนหลักคือ test vector TV-0… ([test-vectors.md](test-vectors.md)) |
| PWA | `public/sw.js` + `manifest.webmanifest` ติดตั้งลงมือถือได้ ใช้ออฟไลน์ได้ (ยกเว้นแท็บติดตาม) |

## แผนที่ repo

```
CLAUDE.md                     กฎที่ Claude ต้องรู้ทุกครั้ง — โหลดเองอัตโนมัติ
home-loan-app-spec.md         spec ตั้งต้น (ใหญ่ ~1,900 บรรทัด) ยังเป็นแหล่งอ้างอิงของ "ข้อ x.y"
docs/                         เอกสารนี้ — เริ่มที่ README.md หรือเปิด project-summary.html
  diagrams.md                 ต้นฉบับ diagram (Mermaid)
  diagrams/NN-ชื่อเรื่อง.svg   ภาพที่สร้างจากต้นฉบับ — ห้ามแก้ตรง ๆ
scripts/docs-diagrams.mjs     สร้างภาพ diagram ใหม่ + ฝังลง project-summary.html
src/
  engine/                     เครื่องคำนวณ — ไม่มี React ไม่มี I/O ไม่มี Date ของ JS
  lib/                        db.ts (ทางเดียวไป Supabase), progress, closing, format, report, export
  components/                 ชิ้น UI ใช้ร่วม
  features/<tab>/             หน้าจอแต่ละส่วน + model.ts ของหน้านั้น
  App.tsx, main.tsx
supabase/
  migrations/                 รันตามลำดับชื่อไฟล์
  seed.sql                    ธนาคาร + วันหยุดธนาคาร (ของกลาง)
worker/index.ts               Cloudflare Worker: serve SPA + cron ping Supabase
deploy/pages/_redirects       SPA routing ของ Pages — ⛔ ห้ามย้ายไป public/
scripts/pages-assets.mjs      copy ไฟล์ของ Pages เข้า dist/ หลัง build
public/                       ไอคอน, manifest, sw.js
.github/workflows/deploy.yml  CI + deploy
.env                          commit ได้ — มีแต่ publishable key
.env.local                    gitignored — บัญชีทดสอบสำหรับ test:live
```

## เอกสารอื่น

อ่านต่อตามลำดับใน [README.md](README.md)
