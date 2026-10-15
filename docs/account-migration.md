# ย้าย account — runbook

ภาพรวมดูที่ [diagrams.md §9](diagrams.md#9-ย้าย-account) · แต่ละส่วนย้ายแยกกันได้ ไม่ต้องย้ายพร้อมกัน

| ย้าย | กระทบข้อมูลผู้ใช้? | ยากแค่ไหน |
|---|---|---|
| Claude | ไม่ | ง่ายมาก — repo พกทุกอย่างไปเอง |
| GitHub | ไม่ | ง่าย — ตั้ง secrets ใหม่ |
| Cloudflare | ไม่ | ปานกลาง — URL เปลี่ยน ต้องตามไปแก้ Supabase |
| Supabase | **ใช่** | ยาก — ถ้า transfer project ได้จะง่ายลงมาก |

**ก่อนเริ่มทุกกรณี:** เปิดแอพ ส่งออก "รายงานฉบับเต็ม" + CSV บันทึกการจ่ายของทุกสัญญาเก็บไว้
เป็นหลักฐานไว้เทียบว่าหลังย้ายตัวเลขยังตรงทุกสตางค์ (แอพยังไม่มี backup ทั้งบัญชี — ดู [backlog.md](backlog.md))

---

## 1. Claude account

สิ่งที่ **ไม่** ตามไป: ประวัติแชท, memory ใน `~/.claude/projects/...` (ผูกกับเครื่อง/บัญชี)
สิ่งที่ตามไป: ทุกอย่างใน repo — `CLAUDE.md` โหลดเองทุก session, `docs/`, `home-loan-app-spec.md`, `.claude/launch.json`

1. ล็อกอิน Claude Code ด้วยบัญชีใหม่ แล้วเปิดโฟลเดอร์ repo เดิม (หรือ `git clone` ใหม่)
2. ข้อความแรกที่แนะนำ:
   > อ่าน CLAUDE.md และ docs/README.md ให้ครบก่อน แล้วสรุปสถานะโปรเจกต์ให้ฟัง
3. `.claude/settings.local.json` (permission ที่เคยอนุญาต) ไม่อยู่ใน repo — จะถูกถามสิทธิ์ใหม่ เป็นเรื่องปกติ
4. ถ้าจะรัน `npm run test:live` ต้องสร้าง `.env.local` ใหม่เอง (ไม่อยู่ใน repo โดยตั้งใจ)

## 2. GitHub account

1. ทางที่ง่ายที่สุด: repo เดิม → Settings → General → Transfer ownership ไปบัญชีใหม่
   (GitHub redirect URL เก่าให้) หรือสร้าง repo ใหม่แล้ว `git push --mirror`
2. บนเครื่อง: `git remote set-url origin https://github.com/<บัญชีใหม่>/ponwai.git`
3. ตรวจ Settings → Secrets and variables → Actions ว่ายังมีครบ ถ้าไม่มีให้ตั้งใหม่
   - secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - variables: `CLOUDFLARE_ENABLED` = `true`
4. ⛔ repo ยังต้องไม่มี credential — ถ้าเปลี่ยนเป็น private ได้ก็ดี แต่กฎ "ห้าม hardcode" ยังใช้เหมือนเดิม
5. แก้ URL repo ใน [overview.md](overview.md)

## 3. Cloudflare account

1. บัญชีใหม่ → My Profile → API Tokens → สร้างจาก template **"Edit Cloudflare Workers"**
   แล้วเพิ่มสิทธิ์ **Cloudflare Pages: Edit** · เอา Account ID จากหน้า Workers & Pages
   (ถ้า CI ฟ้องเรื่องสิทธิ์ ให้ดู log ว่าขาด scope ไหนแล้วเพิ่มทีละตัว)
2. ใส่ทั้งสองค่าใน GitHub secrets (ข้อ 2.3) แล้ว push อะไรก็ได้ขึ้น `main` — CI สร้าง Worker + Pages ให้เอง
3. Worker → Settings → Variables and Secrets: `SUPABASE_URL` (text) + `SUPABASE_ANON_KEY` (secret, publishable key)
   ไม่งั้น cron keep-alive ไม่ทำงาน แล้ว Supabase จะ pause ใน 7 วัน
4. **URL จะเปลี่ยน:**
   - Worker: `ponwai.<subdomain ของบัญชีใหม่>.workers.dev`
   - Pages: ชื่อ `ponwai.pages.dev` เป็นของบัญชีเก่าจนกว่าจะลบ project เก่า — ถ้ายังไม่ลบ บัญชีใหม่จะได้ชื่ออื่น
     ⚠️ ลบ Pages project เก่าก่อน = เว็บล่มช่วงหนึ่ง ถ้ายอมให้ URL เปลี่ยนได้ ไม่ต้องลบ
5. เอา URL ใหม่ไปเพิ่มใน Supabase → Authentication → URL Configuration → Redirect URLs
6. แก้ URL ใน [overview.md](overview.md), [operations.md](operations.md), [diagrams.md](diagrams.md)
7. ผู้ใช้ที่ติดตั้ง PWA จาก URL เก่าต้องติดตั้งใหม่จาก URL ใหม่ (ข้อมูลอยู่ใน Supabase ไม่หาย)
8. ตรวจ: Worker → Logs → รอรอบ cron หรือกด trigger เอง ต้องเห็น `keep-alive: 200`

## 4. Supabase account

⚠️ project ปัจจุบัน **ใช้ร่วมกับอีกแอพ** (free tier ได้ 2 project) แอพนี้อยู่ใน schema `ponwai` อย่างเดียว
`auth.users` เป็นชุดเดียวกันกับอีกแอพ

### ทาง A (แนะนำ) — ย้ายทั้ง project ไป organization ใหม่

Project Settings → General → Transfer project — ข้อมูล, URL, key, ผู้ใช้อยู่ครบ ไม่ต้องแก้โค้ด
ต้องเป็น owner ทั้งสอง org · ตรวจโควตา free project ของ org ปลายทางก่อน · อีกแอพที่อยู่ project เดียวกันย้ายตามไปด้วย

### ทาง B — สร้าง project ใหม่แล้วย้ายข้อมูล

**B1. โครงสร้าง**
1. รัน migration ทุกไฟล์ใน `supabase/migrations/` ตามลำดับชื่อ (SQL Editor หรือ `supabase db push`)
2. ⚠️ **อย่ารัน `seed.sql`** ถ้าจะ restore ข้อมูลเต็มจาก project เก่า — dump มี `banks` กับวันหยุดของกลางอยู่แล้ว
   รันซ้ำจะชน unique index ของวันหยุดและ COPY ล้มทั้งไฟล์ (ถ้าเริ่มใหม่ไม่ย้ายข้อมูล ให้รัน seed)
3. Settings → API → Exposed schemas เพิ่ม `ponwai`
4. Authentication: เปิด Email · ตั้ง Site URL + Redirect URLs (ดู [operations.md](operations.md))
5. ถ้าใช้ Google: ใน Google Cloud Console เพิ่ม redirect URI `https://<project-ref ใหม่>.supabase.co/auth/v1/callback`
   แล้วใส่ client id/secret ใน Supabase → Providers → Google

**B2. ข้อมูล** — ⚠️ ขั้นตอนนี้ยังไม่เคยทดสอบจริง ลองกับบัญชีทดสอบก่อน
1. dump เฉพาะข้อมูลของ schema `ponwai` จาก project เก่า (ใช้ connection string จาก Settings → Database)
   ```bash
   supabase db dump --db-url "<connection string เก่า>" --data-only --schema ponwai -f ponwai-data.sql
   ```
   (ตรวจ flag กับ `supabase db dump --help` ของเวอร์ชันที่ใช้ — หรือใช้ `pg_dump --data-only --schema=ponwai`)
2. ⛔ ไฟล์ dump คือข้อมูลการเงินส่วนตัว — ห้าม commit ห้ามส่งเข้าแชท เก็บนอก repo แล้วลบเมื่อเสร็จ
3. สมัคร/ล็อกอินบัญชีของตัวเองใน project ใหม่ก่อน แล้วดู user id ใหม่ (Authentication → Users)
4. **user id เปลี่ยน** — ทุกแถวที่มี `user_id` อ้าง `auth.users` ด้วย FK ถ้า restore ด้วย id เก่าจะล้ม
   แก้ใน dump ก่อน restore: แทน uuid เก่าด้วย uuid ใหม่ทั้งไฟล์ (uuid ไม่ซ้ำกับค่าอื่น แทนทั้งไฟล์ได้ปลอดภัย)
   ตารางที่มี `user_id` ตรง ๆ: `properties`, `reference_rates`, `bank_holidays`, `bank_holiday_optouts`, `user_prefs`
5. restore ด้วย `psql "<connection string ใหม่>" -f ponwai-data.sql`
6. ถ้ามีผู้ใช้หลายคน ทำข้อ 3–4 ทีละคน

**B3. ต่อแอพเข้ากับ project ใหม่**
1. แก้ `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — publishable key เท่านั้น) แล้ว commit/push
2. แก้ Worker vars `SUPABASE_URL` + `SUPABASE_ANON_KEY`
3. สร้างบัญชีทดสอบใหม่ แล้วแก้ `.env.local` · รัน `npm run test:live`
4. เก็บ project เก่าไว้จนเทียบตัวเลขครบ อย่าลบทันที

## ตรวจหลังย้าย (ทุกกรณี)

- [ ] ล็อกอินได้ทั้ง password และ Google
- [ ] แท็บติดตามเห็นสัญญาครบ ทั้งที่ยังผ่อนและที่ปิดแล้ว
- [ ] เปิดรายงานฉบับเต็มของแต่ละสัญญา เทียบกับไฟล์ที่ส่งออกไว้ก่อนย้าย — ยอดคงเหลือ ดอกรวม ตรงทุกสตางค์
- [ ] แผนโปะยังอยู่ · ปฏิทินวันหยุดของปีปัจจุบันยังอยู่
- [ ] CI รอบล่าสุดเขียว (GitHub → Actions) · URL ใหม่เปิดได้ · รีเฟรช deep link ไม่ 404
- [ ] Worker log เห็น `keep-alive: 200`
- [ ] อัปเดตเอกสารทุกที่ที่มี URL / ชื่อบัญชี แล้ว commit
