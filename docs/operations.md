# Operations — รัน ทดสอบ deploy

## เริ่มต้นบนเครื่องใหม่

```bash
git clone https://github.com/polxvii/ponwai.git
cd ponwai
npm ci
npm run dev
```

- Node ≥ 20 (CI ใช้ 22)
- `.env` อยู่ใน repo แล้ว (URL + publishable key ของ Supabase) — clone มาแล้วรันได้เลย
- ถ้าจะรันเทสต์กับ Supabase จริง สร้าง `.env.local` (gitignored):
  ```
  PONWAI_TEST_EMAIL=...
  PONWAI_TEST_PASSWORD=...
  ```

## คำสั่ง

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | dev server ที่ :5173 (`.claude/launch.json` มี config `dev` และ `prod-preview`) |
| `npm test` | Vitest ทุกไฟล์ `src/**/*.test.ts` — live test ข้ามเองถ้าไม่มี env |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | typecheck + `vite build` → `dist/` |
| `npm run build:pages` | build + copy `deploy/pages/*` เข้า `dist/` |
| `npm run test:live` | ยิง Supabase จริงด้วยบัญชีใน `.env.local` (โหลด env ก่อน: `set -a; . ./.env.local; set +a`) |
| `npm run deploy` | build + `wrangler deploy` จากเครื่อง (ปกติให้ CI ทำ) |
| `npm run lint` | ⚠️ พังอยู่ — ยังไม่ได้ติดตั้ง eslint/config (ดู backlog) |
| `node scripts/docs-diagrams.mjs` | สร้างภาพ diagram จาก `docs/diagrams.md` + ฝังลง `docs/project-summary.html` — ต้องมี Chrome/Edge · ⛔ ไม่ต้องรันใน CI |

ก่อน commit ทุกครั้ง: `npm run typecheck && npm test && npm run build`

## ตัวแปรและความลับ

| ชื่อ | อยู่ที่ | ลับ? |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env` (commit) | ไม่ลับ — ฝังใน bundle อยู่แล้ว ตัวกันข้อมูลคือ RLS |
| `PONWAI_TEST_EMAIL`, `PONWAI_TEST_PASSWORD` | `.env.local` | ลับ ⛔ ห้ามแปะในแชท ห้าม commit |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub → Settings → Secrets → Actions | ลับ |
| `CLOUDFLARE_ENABLED` = `true` | GitHub → Settings → Variables → Actions | ไม่ลับ — ไม่ตั้ง = CI ข้าม deploy เงียบ ๆ |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Cloudflare Worker → Settings → Variables (`wrangler secret put`) | ใช้ publishable/anon key ⛔ ไม่ใช่ service_role |

⛔ **Secret key ของ Supabase (`sb_secret_...` / service_role) ห้ามอยู่ใน `.env`, ห้ามแปะในแชท, ห้าม commit**
ถ้าวันหนึ่งต้องใช้ ให้อยู่ใน Cloudflare Worker secret ฝั่ง server เท่านั้น
⛔ repo เป็น **public** — ห้าม hardcode credential ใด ๆ ในโค้ดหรือเอกสาร

## CI / Deploy

ไฟล์ `.github/workflows/deploy.yml` — ดู [diagrams.md §8](diagrams.md#8-ci--deploy)

1. ทุก push และ PR: `verify` = `npm ci` → typecheck → test → build
2. push ไป `main` + `vars.CLOUDFLARE_ENABLED == 'true'`: `deploy`
   - `wrangler deploy` (Worker) ⛔ **ต้องมาก่อน** copy `_redirects`
   - `wrangler pages project create ponwai` (continue-on-error — มีแล้วก็ข้าม)
   - `node scripts/pages-assets.mjs` → `wrangler pages deploy dist --project-name=ponwai --branch=main`

ดูสถานะ: `gh run list --limit 5` · ดู log ที่พัง: `gh run view <id> --log-failed`

## Supabase keep-alive

Free tier pause project หลังไม่มี request 7 วัน (และ project ที่ pause ค้างนานอาจถูกลบ)
→ Worker มี cron `0 3 */3 * *` (ทุก 3 วัน 10:00 น. เวลาไทย) ยิง `HEAD /rest/v1/`
ต้องตั้ง `SUPABASE_URL` + `SUPABASE_ANON_KEY` ให้ Worker ไม่งั้น cron log ว่า "keep-alive ข้าม"
⚠️ อยู่ที่ Cloudflare ไม่ใช่ pg_cron เพราะ project ที่ pause แล้ว cron ข้างในก็ไม่รัน

## ตั้งค่า Supabase ที่ทำด้วยมือ (ไม่อยู่ใน migration)

- Settings → API → **Exposed schemas** ต้องมี `ponwai` ไม่งั้น PostgREST มองไม่เห็นตาราง
- Authentication → URL Configuration → **Redirect URLs**: `http://localhost:5173/**`, `https://ponwai.pv-proj.workers.dev/**`, `https://ponwai.pages.dev`
- Authentication → Providers: Email (password) เปิด · Google เปิดได้ (ปุ่มขึ้นเองเมื่อ provider เปิด)
- บัญชีทดสอบ: ถ้าเปิด "Confirm email" ไว้ `signUp` จะไม่ได้ session — live test จะฟ้อง

## ปัญหาที่เคยเจอ และวิธีดู

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| CI deploy แดง ทั้งที่ build ผ่าน | `_redirects` หลุดเข้า `dist/` ก่อน `wrangler deploy` | ให้อยู่ใน `deploy/pages/` เท่านั้น |
| เว็บไม่อัปเดตหลัง push | CI แดง หรือ `CLOUDFLARE_ENABLED` ไม่ได้ตั้ง หรือ SW ถือ cache เก่า | `gh run list` / ปิดเปิดแท็บ / ขึ้น `VERSION` ใน `sw.js` |
| "permission denied for table" | grant ของ schema `ponwai` หาย | รัน grant ใน init migration ซ้ำ |
| query ไม่เจออะไรเลย ไม่มี error ชัด | ไม่ได้ expose schema `ponwai` หรือ client ไม่ได้ตั้ง `db.schema` | Settings → API |
| สร้างสัญญาไม่ได้ error FK | ไม่ได้รัน `seed.sql` (ไม่มีแถวธนาคาร) | รัน seed |
| 42501 ตอน insert | ไม่ได้ส่ง `user_id` ไปเอง | ดูหัวไฟล์ `db.ts` |
| งวดแรกไม่ตรงใบแจ้งยอด | `first_accrual_date` / `first_due_date` / ปฏิทินวันหยุดของปีนั้น | หน้า "กระทบยอด" |
| deep link รีเฟรชแล้ว 404 บน Pages | ไม่มี `_redirects` ใน dist | `npm run build:pages` |
| ล็อกอิน Google แล้วเด้งกลับไม่ได้ | URL ไม่อยู่ใน Redirect URLs | เพิ่มใน Supabase |
