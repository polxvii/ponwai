# Data model (Supabase)

ความสัมพันธ์ของตารางดูที่ [diagrams.md §5](diagrams.md#5-ตารางในฐานข้อมูล)

## กฎชนิดข้อมูล — ห้ามละเมิด

| เรื่อง | เก็บเป็น | ห้าม |
|---|---|---|
| เงิน | `bigint` หน่วยสตางค์ | numeric, float |
| อัตรา / เปอร์เซ็นต์ | `int` หน่วย bps (300 = 3.00%) | คอลัมน์ลงท้าย `_pct` |
| วันที่ | `date` ค.ศ. | เก็บ พ.ศ. — แปลงที่ `src/lib/format.ts` เท่านั้น |

PostgREST คืน `bigint` เป็น `number` ของ JS — ต้องแปลงเป็น `BigInt` ใน `db.ts` ก่อนส่งเข้า engine เสมอ

## Migrations — รันตามลำดับชื่อไฟล์

| ไฟล์ | ทำอะไร |
|---|---|
| `20260921000001_init.sql` | schema `ponwai` + ทุกตาราง + table grants ให้ `authenticated` |
| `20260921000002_rls.sql` | เปิด RLS ทุกตาราง + policy + helper `owns_property/offer/loan/plan` + trigger ห้ามแก้ `reference_rates` |
| `20260924000001_installment_per_step.sql` | `loan_rate_steps.installment_satang` — ค่างวดรายช่วง (TV-41) |
| `20260925000001_holiday_optouts.sql` | `bank_holiday_optouts` — ปิดวันหยุดของกลางเฉพาะตัวเอง |
| `seed.sql` | ธนาคาร 12 แห่ง (MRR ณ 7 ส.ค. 2569) + วันหยุดธนาคารแบบตายตัวปี 2568–2570 |

⚠️ ต้องรัน `seed.sql` ด้วย — `loan_offers.bank_code` เป็น FK ไป `banks` ถ้าไม่มีแถวธนาคาร สร้างสัญญาไม่ได้ (error 23503)
⚠️ schema ที่สร้างเองไม่มี grant ให้อัตโนมัติเหมือน `public` — ถ้าเจอ "permission denied for table" ทั้งที่ RLS ถูก ให้ดู grant ใน init

## ตาราง

★ = แอพใช้อยู่จริง (`src/lib/db.ts`)

| ตาราง | ★ | เจ้าของผ่าน | หมายเหตุ |
|---|---|---|---|
| `properties` | ★ | `user_id` | รากของ ownership — ทุกอย่างของสัญญาไล่กลับมาที่นี่ |
| `loan_offers` | ★ | property | เก็บธนาคารของสัญญา (`bank_code`, `bank_name`) |
| `active_loans` | ★ | property | สัญญา + สถานะปิด + `supersedes_loan_id` |
| `loan_rate_steps` | ★ | loan | อัตรารายช่วงเดือน + ค่างวดรายช่วง ลบทั้งชุดแล้วใส่ใหม่ตอนแก้ |
| `loan_conventions` | ★ | loan | day-count / ปัดเศษ / ทบต้น แบบ effective-dated |
| `loan_schedule_overrides` | ★ | loan | แก้วันตัดเฉพาะงวด |
| `payments` | ★ | loan | ⛔ ไม่มี DELETE policy — ลบด้วย `deleted_at` เท่านั้น · id สร้างฝั่ง client |
| `statement_entries` | ★ | loan | ใบแจ้งยอดที่กรอกไว้กระทบยอด |
| `scenarios` / `prepay_plans` / `prepay_months` / `prepay_overrides` | ★ | loan | แผนโปะ — 1 แผนต่อสัญญา (บันทึกอัตโนมัติ) |
| `bank_holidays` | ★ | `user_id` / null | null = ของกลางจาก seed ⛔ ห้ามให้ผู้ใช้ลบได้ |
| `bank_holiday_optouts` | ★ | `user_id` | ปิดวันหยุดของกลางเฉพาะตัวเอง |
| `user_prefs` | ★ | `user_id` | อัตราภาษีส่วนเพิ่ม (`marginal_tax_rate_bps`, null = ไม่เดา) |
| `banks` | FK เท่านั้น | อ่านได้ทุกคน | หน้าจอใช้ `BANK_PRESETS` ใน `compare/model.ts` ไม่ได้อ่านตารางนี้ |
| `prepay_lumps` | เลิกใช้ | plan | ⛔ ห้าม drop — ข้อมูลเก่าของผู้ใช้หาย แค่เลิกอ่านเลิกเขียน |
| `reference_rates` | – | `user_id` | ⛔ immutable (trigger) แก้ด้วยแถวใหม่ + `superseded_by` |
| `payment_allocations` | – | อ่านอย่างเดียว | derived cache — ⛔ ไม่มี policy เขียนจาก client |
| `offer_rate_steps` / `offer_fees` / `offer_insurance` | – | offer | หน้าเปรียบเทียบเก็บใน localStorage แทน |
| `rate_change_events` | – | loan | สำรองไว้ |

## ตารางที่มี `user_id` ตรง ๆ (สำคัญตอนย้าย project)

`properties`, `reference_rates`, `bank_holidays` (เฉพาะแถวที่ผู้ใช้เพิ่ม), `bank_holiday_optouts`, `user_prefs`
ตารางอื่นทั้งหมดผูกกับผู้ใช้ผ่าน FK ไล่ขึ้นไปถึง `properties` — ย้ายข้อมูลข้าม project แล้ว remap แค่ 5 ตารางนี้พอ

## ค่าที่ต้องรู้ของ `active_loans`

| คอลัมน์ | ความหมาย |
|---|---|
| `first_accrual_date` | วันเริ่มคิดดอกงวดแรก = วันเบิกเงิน ไม่ใช่วันทำสัญญา (สาเหตุอันดับหนึ่งที่งวดแรกไม่ตรง) |
| `first_due_date` | วันตัดงวดแรกที่ธนาคารกำหนด — เป็น anchor ของทุกงวดถัดไป (TV-0) |
| `date_roll` | `none` / `preceding` / `following` เมื่อวันตัดตรงวันหยุด |
| `roll_calendar` | `weekend_only` / `weekend_and_bank_holidays` |
| `installment_satang` | ค่างวดตั้งต้น ใช้เมื่อขั้นอัตราไม่ได้กำหนดค่างวดของตัวเอง |
| `status` | `active` / `closed` |
| `closed_date`, `closing_reason` | `refinanced` / `paid_off` — เขียนโดย `closeLoan`, ล้างโดย `reopenLoan` |
| `supersedes_loan_id` | อยู่ฝั่ง **สัญญาใหม่** ชี้ไปสัญญาเก่า — หาย้อนกลับเพื่อบอกว่าสัญญาเก่าย้ายไปไหน |
| `origin`, `import_mode`, `prepay_mode` | มีค่า default ในตาราง UI ยังไม่ให้แก้ |

## RLS ย่อ

- ตารางของผู้ใช้ → `user_id = auth.uid()` หรือ `owns_*()` ไล่ ownership ขึ้นไปถึง `properties`
- ⚠️ ตอน **อ่าน** RLS กรองให้แล้ว ห้ามใส่ `.eq('user_id', …)` ซ้ำ
- ⚠️ ตอน **เขียน** ต้องส่ง `user_id` ไปเองเสมอ — `with check` ตรวจ ไม่ได้เติมให้ ไม่ส่งจะโดน 42501
- PostgREST ไม่มี transaction ข้าม request → `createLoan` ลบ property ทิ้งเมื่อพังกลางทาง (cascade เก็บลูกให้),
  `closeLoan` ผูกลิงก์ก่อนเปลี่ยนสถานะ, `reopenLoan` ล้างลิงก์ก่อนเปลี่ยนสถานะ
