# Diagrams

ทุก diagram เขียนเป็น Mermaid — GitHub แสดงผลให้เอง และแก้เป็นข้อความได้เหมือนโค้ด
**ไฟล์นี้คือต้นฉบับ** · ภาพ SVG ใน [`diagrams/`](diagrams/README.md) สร้างจากไฟล์นี้ เปิดด้วยเบราว์เซอร์ไหนก็ได้
และถูกฝังอยู่ใน [project-summary.html](project-summary.html) ด้วย

⚠️ แก้ diagram ในไฟล์นี้แล้วต้องสร้างภาพใหม่ใน commit เดียวกัน — TV-56 ตรวจว่าภาพตรงกับต้นฉบับ ไม่ตรง CI แดง

```bash
node scripts/docs-diagrams.mjs
```

สคริปต์อ่าน `<!-- svg: ชื่อไฟล์ -->` ที่อยู่เหนือแต่ละ block เพื่อตั้งชื่อไฟล์ — **เพิ่ม diagram ใหม่ต้องใส่บรรทัดนี้ด้วย**
ต้องมี Chrome หรือ Edge ในเครื่อง (สคริปต์หาเอง) · ครั้งแรกจะดาวน์โหลด mermaid-cli ผ่าน npx

| # | Diagram | ไฟล์ภาพ |
|---|---|---|
| 1 | [ระบบทั้งหมด](#1-ระบบทั้งหมด) | [`01-system-overview.svg`](diagrams/01-system-overview.svg) |
| 2 | [ชั้นของโค้ด](#2-ชั้นของโค้ด) | [`02-code-layers.svg`](diagrams/02-code-layers.svg) |
| 3 | [แผนที่หน้าจอ](#3-แผนที่หน้าจอ) | [`03-screen-map.svg`](diagrams/03-screen-map.svg) |
| 4 | [จากฐานข้อมูลถึงตัวเลขบนจอ](#4-จากฐานข้อมูลถึงตัวเลขบนจอ) | [`04-data-flow-db-to-screen.svg`](diagrams/04-data-flow-db-to-screen.svg) |
| 5 | [ตารางในฐานข้อมูล](#5-ตารางในฐานข้อมูล) | [`05-database-tables.svg`](diagrams/05-database-tables.svg) |
| 6 | [หนึ่งงวดในเครื่องคำนวณ](#6-หนึ่งงวดในเครื่องคำนวณ) | [`06-engine-one-period.svg`](diagrams/06-engine-one-period.svg) |
| 7 | [สถานะสัญญา](#7-สถานะสัญญา) | [`07-loan-status.svg`](diagrams/07-loan-status.svg) |
| 8 | [CI / Deploy](#8-ci--deploy) | [`08-ci-deploy.svg`](diagrams/08-ci-deploy.svg) |
| 9 | [ย้าย account](#9-ย้าย-account) | [`09-account-migration.svg`](diagrams/09-account-migration.svg) |

---

## 1. ระบบทั้งหมด

<!-- svg: 01-system-overview -->
```mermaid
---
title: 1. ระบบทั้งหมด — อะไรอยู่ที่ไหน คุยกับอะไร
---
flowchart LR
  user["ผู้ใช้<br/>มือถือ / desktop"]

  subgraph browser["เบราว์เซอร์"]
    spa["React SPA<br/>คำนวณทุกอย่างในเครื่อง"]
    sw["Service Worker<br/>public/sw.js"]
    ls["localStorage<br/>ฟอร์มเปรียบเทียบ/รีไฟแนนซ์"]
  end

  subgraph cf["Cloudflare"]
    pages["Pages: ponwai.pages.dev<br/>URL หลัก"]
    worker["Worker: ponwai.pv-proj.workers.dev<br/>static assets + cron"]
  end

  subgraph sb["Supabase - project ใช้ร่วมกับอีกแอพ"]
    auth["Auth / GoTrue<br/>email+password, Google"]
    rest["PostgREST<br/>schema ponwai + RLS"]
    pg[("Postgres")]
  end

  gh["GitHub polxvii/ponwai<br/>Actions CI"]

  user --> spa
  spa --- sw
  spa --- ls
  pages -->|"HTML/JS/CSS"| spa
  worker -->|"HTML/JS/CSS"| spa
  spa -->|"login"| auth
  spa -->|"อ่าน/เขียนข้อมูลสัญญา"| rest
  rest --> pg
  worker -->|"cron ทุก 3 วัน HEAD /rest/v1"| rest
  gh -->|"wrangler deploy"| worker
  gh -->|"wrangler pages deploy"| pages
```

- หน้าเปรียบเทียบกับรีไฟแนนซ์ **ไม่ต้องล็อกอิน** คำนวณในเครื่องล้วน ใช้ออฟไลน์ได้
- หน้าติดตาม **ต้องล็อกอิน** ข้อมูลอยู่ใน Supabase กันด้วย RLS
- ⛔ Service worker ห้าม cache อะไรที่ไปหา Supabase (ข้อมูลการเงินส่วนตัว + ยอดเก่าเงียบ ๆ อันตราย)
- Worker อยู่ต่อเพราะ **Pages ไม่มี cron** — ถ้าไม่มีใครปลุก Supabase free tier จะ pause หลัง 7 วัน

---

## 2. ชั้นของโค้ด

<!-- svg: 02-code-layers -->
```mermaid
---
title: 2. ชั้นของโค้ด — ไฟล์ไหน import อะไรได้
---
flowchart TB
  subgraph features["src/features/* — หน้าจอ React"]
    compare["compare/"]
    refi["refinance/"]
    track["track/"]
    dash["dashboard/"]
    prepay["prepay/"]
    recon["reconcile/"]
    authui["auth/"]
  end

  comps["src/components/*<br/>Field, BankSelect, SplitRibbon, ..."]

  subgraph lib["src/lib/* — กาวระหว่าง UI กับ engine"]
    db["db.ts<br/>ทางเดียวที่คุยกับ Supabase"]
    progress["progress.ts<br/>settledPeriods, balanceOn, prepayOfRow"]
    closing["closing.ts<br/>rowsUntilClose, validateClose"]
    format["format.ts<br/>เงิน, วันที่ พ.ศ."]
    report["report.ts / export.ts"]
    persist["persist.ts / auth.tsx / supabase.ts"]
  end

  subgraph engine["src/engine/* — pure TypeScript ไม่มี React ไม่มี I/O"]
    schedule["schedule.ts<br/>buildSchedule"]
    accrual["accrual.ts"]
    dates["date.ts / schedule-dates.ts"]
    money["money.ts<br/>Satang, Fixed, Bps"]
    others["compare, refinance, prepay,<br/>prepay-roi, grouping, reconcile,<br/>fees, import, rates, xirr"]
  end

  features --> comps
  features --> lib
  features --> engine
  lib --> engine
  db -->|"supabase-js"| supa[("Supabase")]
```

กฎ: ลูกศรชี้ลงอย่างเดียว — `engine/` ห้าม import จาก `lib/` หรือ `features/`
และห้ามใช้ `Date` ของ JS (วันที่เป็น civil date `'YYYY-MM-DD'` ล้วน)

---

## 3. แผนที่หน้าจอ

<!-- svg: 03-screen-map -->
```mermaid
---
title: 3. แผนที่หน้าจอ — กดอะไรไปหน้าไหน
---
flowchart LR
  app["App.tsx<br/>3 แท็บ"]
  app --> c["เปรียบเทียบ<br/>ก่อนเซ็นสัญญา"]
  app --> r["รีไฟแนนซ์<br/>ผ่อนอยู่แล้ว"]
  app --> t["ติดตาม<br/>สัญญาของฉัน"]

  t -->|"ยังไม่ล็อกอิน"| signin["SignInDialog"]
  t --> dashv["ภาพรวม<br/>DashboardPage"]
  t --> list["สัญญาทั้งหมด<br/>ยังผ่อน / ปิดแล้ว"]
  list --> newl["+ เพิ่มสัญญา<br/>LoanForm"]
  dashv --> detail["หน้าสัญญา<br/>LoanDetail"]
  list --> detail
  detail --> edit["แก้ไขสัญญา<br/>LoanForm"]
  detail --> pp["วางแผนโปะ<br/>PrepayPage"]
  detail --> rc["กระทบยอด<br/>ReconcilePage"]
  detail --> close["ปิดสัญญา / เปิดกลับ"]
  detail --> exp["รายงาน HTML + CSV"]
  r -.->|"ดึงหนี้จากสัญญาที่ติดตาม"| t
```

---

## 4. จากฐานข้อมูลถึงตัวเลขบนจอ

<!-- svg: 04-data-flow-db-to-screen -->
```mermaid
---
title: 4. จากฐานข้อมูลถึงตัวเลขบนจอ
---
flowchart TB
  full["getLoanFull / getAllLoansFull<br/>lib/db.ts"]
  terms["toLoanTerms"]
  events["toPaymentEvents<br/>เฉพาะ payments ที่ deleted_at is null"]
  plan["getPlan<br/>แผนโปะของสัญญา"]
  bs["buildSchedule terms, events, plan<br/>engine/schedule.ts"]
  cut["rowsUntilClose<br/>ตัดที่วันปิดสัญญา ถ้าปิดแล้ว"]
  prog["settledPeriods / balanceOn<br/>ผ่อนกี่งวด เหลือหนี้เท่าไหร่"]
  pre["prepayOfRow<br/>คอลัมน์โปะ ตัวเดียวทั้งแอพ"]
  grp["groupSchedule ปีสัญญา / ปีปฏิทิน"]
  tax["summariseTaxYears<br/>รวมทุกสัญญาของคนคนเดียว"]
  ui["Dashboard, LoanDetail, PrepayPage,<br/>report.ts, export.ts"]

  full --> terms --> bs
  full --> events --> bs
  plan --> bs
  bs --> cut
  cut --> prog --> ui
  cut --> pre --> ui
  cut --> grp --> ui
  cut --> tax --> ui
```

⛔ ทุกหน้าต้องเดินเส้นนี้เส้นเดียวกัน — ใส่แผนโปะเหมือนกัน ตัดวันปิดเหมือนกัน
ไม่งั้นการ์ดกับตารางบนจอเดียวกันจะบอกวันปิดหนี้คนละวัน (เคยเกิดจริง)

---

## 5. ตารางในฐานข้อมูล

ตารางทั้งหมดอยู่ใน schema `ponwai` · ★ = แอพอ่าน/เขียนอยู่จริง · ไม่มีดาว = มีใน schema แต่แอพยังไม่ใช้

<!-- svg: 05-database-tables -->
```mermaid
---
title: 5. ตารางในฐานข้อมูล — schema ponwai
---
erDiagram
  auth_users ||--o{ properties : "user_id"
  auth_users ||--o{ reference_rates : "user_id"
  auth_users ||--o{ bank_holidays : "user_id null = ของกลาง"
  auth_users ||--o{ bank_holiday_optouts : "user_id"
  auth_users ||--o| user_prefs : "user_id"

  properties ||--o{ loan_offers : "property_id"
  properties ||--o{ active_loans : "property_id"
  banks ||--o{ loan_offers : "bank_code FK"
  loan_offers ||--o{ offer_rate_steps : "rates"
  loan_offers ||--o{ offer_fees : "fees"
  loan_offers ||--o{ offer_insurance : "insurance"
  loan_offers ||--o{ active_loans : "offer_id"
  active_loans |o--o| active_loans : "supersedes_loan_id"

  active_loans ||--o{ loan_rate_steps : "อัตรา + ค่างวดรายช่วง"
  active_loans ||--o{ loan_conventions : "effective-dated"
  active_loans ||--o{ loan_schedule_overrides : "วันตัดรายงวด"
  active_loans ||--o{ payments : "ห้าม hard delete"
  payments ||--o| payment_allocations : "derived"
  active_loans ||--o{ statement_entries : "ใบแจ้งยอด"
  active_loans ||--o{ rate_change_events : "events"
  active_loans ||--o{ scenarios : "1 แผนต่อสัญญา"
  scenarios ||--o{ prepay_plans : "plan"
  prepay_plans ||--o{ prepay_months : "12 เดือน"
  prepay_plans ||--o{ prepay_overrides : "รายปี"
  prepay_plans ||--o{ prepay_lumps : "เลิกใช้ ห้าม drop"

  properties {
    uuid id PK
    uuid user_id "★ รากของ ownership"
    text name
  }
  active_loans {
    uuid id PK
    uuid property_id FK
    date first_accrual_date
    date first_due_date
    int due_day_of_month
    text date_roll
    text roll_calendar
    bigint disbursed_amount_satang
    bigint installment_satang
    text status "active / closed"
    date closed_date
    text closing_reason "refinanced / paid_off"
    uuid supersedes_loan_id
  }
  payments {
    uuid id PK "สร้างฝั่ง client"
    uuid loan_id FK
    date paid_date
    bigint amount_satang
    text kind "installment / partial_prepay / full_redemption / fee"
    timestamptz deleted_at "soft delete"
  }
  loan_rate_steps {
    int from_month
    int to_month "null = ถึงจบสัญญา"
    text kind
    int fixed_rate_bps
    bigint installment_satang "null = ใช้ค่างวดตั้งต้น"
  }
```

---

## 6. หนึ่งงวดในเครื่องคำนวณ

`buildSchedule` ใน `src/engine/schedule.ts` — วนทีละงวด แต่ละงวดทำแบบนี้

<!-- svg: 06-engine-one-period -->
```mermaid
---
title: 6. หนึ่งงวดในเครื่องคำนวณ — buildSchedule
---
flowchart TB
  start["งวด n: หา due = actualDueDate n<br/>anchor คงที่ ห้ามนับต่อจากงวดก่อน TV-32"]
  collect["เก็บเหตุการณ์ในช่วง from, due<br/>partial_prepay + ยอดจ่ายจริงที่ลงก่อนวันตัด"]
  sort["เรียงตามวันที่"]
  loop{"ยังมีเหตุการณ์?"}
  acc1["คิดดอกรายวัน segFrom ถึงวันเหตุการณ์<br/>ตัดช่วงทุกครั้งที่อัตรา/convention เปลี่ยน"]
  kind{"ประเภท"}
  pp["โปะ: ตัดเงินต้นเต็มจำนวน<br/>ไม่หักดอกก่อน"]
  early["ยอดจ่ายจริง: ปัดเศษดอก ณ วันนั้น<br/>ตัดดอกค้างก่อน ที่เหลือเข้าเงินต้น TV-51"]
  acc2["คิดดอกต่อจนถึงวันตัด"]
  known{"งวดนี้รู้แล้วหรือยัง?<br/>มีรายการจ่าย หรืออยู่ก่อนรายการล่าสุด"}
  plan["ลงยอดโปะตามแผน ณ วันตัด"]
  skip["ข้ามแผน — ความจริงชนะแผน TV-55"]
  settle["ตัดชำระ ณ วันตัด<br/>payment = ยอดจริง หรือค่างวดตามสัญญา<br/>ดอกก่อน ที่เหลือเข้าเงินต้น"]
  short{"จ่ายไม่พอดอก?"}
  cap["ทบต้น หรือยกเป็นดอกค้าง<br/>ตาม capitalise_unpaid_interest"]
  row["สร้างแถว ScheduleRow<br/>flags: actual_payment, prepay, early_payment, ..."]

  start --> collect --> sort --> loop
  loop -->|"มี"| acc1 --> kind
  kind -->|"partial_prepay"| pp --> loop
  kind -->|"installment ก่อนวันตัด"| early --> loop
  loop -->|"หมด"| acc2 --> known
  known -->|"ยัง"| plan --> settle
  known -->|"รู้แล้ว"| skip --> settle
  settle --> short
  short -->|"ใช่"| cap --> row
  short -->|"ไม่"| row
```

---

## 7. สถานะสัญญา

<!-- svg: 07-loan-status -->
```mermaid
---
title: 7. สถานะสัญญา — ปิด / เปิดกลับ / โซ่รีไฟแนนซ์
---
stateDiagram-v2
  [*] --> active : createLoan
  active --> closed : closeLoan<br/>status, closed_date, closing_reason
  closed --> active : reopenLoan<br/>ล้างทุกช่อง + ล้างลิงก์ supersedes
  active --> [*] : deleteLoan<br/>cascade ลบ payments ทั้งหมด
  closed --> [*] : deleteLoan

  note right of closed
    ปิด = ป้ายสถานะอย่างเดียว ไม่ลบอะไรเลย
    ตารางถูกตัดที่ closed_date ทุกหน้า
    ไม่นับเข้าหนี้รวม แต่ดอกก่อนวันปิดยังเข้าสิทธิลดหย่อน
    สัญญาใหม่ชี้กลับมาด้วย supersedes_loan_id
  end note
```

---

## 8. CI / Deploy

<!-- svg: 08-ci-deploy -->
```mermaid
---
title: 8. CI / Deploy — push แล้วเกิดอะไรขึ้น
---
sequenceDiagram
  participant Dev as git push main
  participant GA as GitHub Actions
  participant W as Cloudflare Worker
  participant P as Cloudflare Pages

  Dev->>GA: push
  GA->>GA: verify: npm ci, typecheck, test, build
  alt vars.CLOUDFLARE_ENABLED == 'true'
    GA->>GA: deploy job: npm ci, build
    GA->>W: wrangler deploy - ต้องก่อน copy _redirects เสมอ
    GA->>P: wrangler pages project create - ข้ามถ้ามีแล้ว
    GA->>GA: node scripts/pages-assets.mjs - copy _redirects เข้า dist
    GA->>P: wrangler pages deploy dist
  else ยังไม่ตั้งตัวแปร
    GA->>GA: ข้าม deploy เงียบ ๆ
  end
```

⛔ ห้ามย้าย `deploy/pages/_redirects` ไปไว้ใน `public/` — wrangler อ่าน `dist/_redirects`
เป็น metadata ของ Worker แล้ว `wrangler deploy` ตาย (CI เคยแดง 3 commit, ab94543 → 2cefb8d)

---

## 9. ย้าย account

รายละเอียดทีละขั้นอยู่ที่ [account-migration.md](account-migration.md)

<!-- svg: 09-account-migration -->
```mermaid
---
title: 9. ย้าย account — ย้ายอะไร ลำดับไหน
---
flowchart TB
  q{"ย้าย account อะไร"}
  q --> claude["Claude"]
  q --> github["GitHub"]
  q --> cfa["Cloudflare"]
  q --> supa["Supabase"]

  claude --> c1["เปิดโฟลเดอร์ repo เดิม<br/>CLAUDE.md + docs/ โหลดเอง<br/>ไม่ต้องย้ายอะไร"]

  github --> g1["Transfer repo หรือ push ขึ้น repo ใหม่"]
  g1 --> g2["ตั้ง secrets CLOUDFLARE_API_TOKEN,<br/>CLOUDFLARE_ACCOUNT_ID<br/>+ variable CLOUDFLARE_ENABLED=true"]

  cfa --> f1["token + account id ใหม่ใน GitHub secrets"]
  f1 --> f2["push main ให้ CI deploy Worker + Pages ใหม่"]
  f2 --> f3["ตั้ง SUPABASE_URL, SUPABASE_ANON_KEY<br/>ให้ Worker - cron keep-alive"]
  f3 --> f4["URL workers.dev เปลี่ยนตามชื่อ account<br/>ไปเพิ่มใน Supabase Redirect URLs"]

  supa --> s0{"ย้ายทั้ง project ได้ไหม"}
  s0 -->|"ได้ - แนะนำ"| s1["Transfer project ไป org ใหม่<br/>ข้อมูล URL key อยู่ครบ"]
  s0 -->|"ไม่ได้"| s2["สร้าง project ใหม่<br/>migrations ตามลำดับ + seed.sql"]
  s2 --> s3["Exposed schemas + ponwai<br/>Auth URLs + providers"]
  s3 --> s4["dump/restore ข้อมูล schema ponwai<br/>remap user_id 5 ตาราง"]
  s4 --> s5["อัปเดต .env + Worker secrets"]
```
