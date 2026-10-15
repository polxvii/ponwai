# สถาปัตยกรรม

ภาพรวมดูที่ [diagrams.md §1–4](diagrams.md) ไฟล์นี้อธิบายว่าแต่ละส่วนรับผิดชอบอะไร

## หลักการ

1. **คำนวณในเบราว์เซอร์ทั้งหมด** ไม่มี backend ของตัวเอง — Supabase เก็บแค่ข้อมูลดิบที่ผู้ใช้กรอก
   ตารางผ่อนทุกแถวคิดใหม่ทุกครั้งที่โหลด ไม่มี cache ของผลคำนวณ (`payment_allocations` มีใน schema แต่ไม่ได้ใช้)
2. **engine เป็น pure function** รับ terms + events + plan คืน rows — ทดสอบได้โดยไม่ต้องมี DB หรือ UI
3. **ความจริงชนะแผน** ยอดที่บันทึกว่าจ่ายแล้วแทนค่างวดตามสัญญาเสมอ แผนโปะลงได้เฉพาะงวดที่ยังไม่รู้ผล
4. **ทุกหน้าใช้เส้นทางคำนวณเดียวกัน** (diagram §4) ห้ามมีหน้าไหนคิดเองแยก

## src/engine — เครื่องคำนวณ

| ไฟล์ | หน้าที่ |
|---|---|
| `money.ts` | `Satang` (สตางค์), `Fixed` (×10¹² ต่อสตางค์ ใช้ระหว่างคำนวณ), `Bps`, การปัดเศษ 4 แบบ |
| `date.ts` | civil date `'YYYY-MM-DD'` — ⛔ ห้ามใช้ `Date` ของ JS ในโฟลเดอร์นี้ |
| `schedule-dates.ts` | วันครบกำหนดรายงวด: anchor → roll วันหยุด → override รายงวด |
| `accrual.ts` | ดอกรายวัน 3 day-count basis ตัดช่วงเมื่ออัตราเปลี่ยน |
| `rates.ts` | อัตรา ณ วันใด = RateStep ของงวด + reference rate ณ วันนั้น, ค่างวดรายช่วง |
| `schedule.ts` | **`buildSchedule`** — daily event loop ทีละงวด (diagram §6) |
| `prepay.ts` | แผนโปะ 12 เดือน + override รายปี + โหมดทำซ้ำ |
| `prepay-roi.ts` | เทียบตารางมี/ไม่มีแผน → ดอกที่ประหยัด, ROI, ROI หลังภาษี |
| `grouping.ts` | สรุปรายปี 2 แกน (ปีสัญญา / ปีปฏิทิน) + สิทธิลดหย่อนรวมข้ามสัญญา |
| `compare.ts` | จัดอันดับข้อเสนอแบบ equal-payment, sensitivity, rank flip |
| `refinance.ts` | 3 ทางเลือก อยู่ต่อ / retention / ย้าย + ต้นทุนการย้าย + กับดักยืดเทอม |
| `fees.ts` | ค่าธรรมเนียมครั้งเดียว / เกิดซ้ำ / MRTA, ฟรีแบบมีเพดาน |
| `reconcile.ts` | เทียบกับใบแจ้งยอด + เดา convention 2 ขั้น (วันที่ก่อน แล้วค่อยจำนวนเงิน) |
| `import.ts` | สร้าง terms จากสัญญาที่ผ่อนไปแล้ว (quick/full) |
| `xirr.ts` | EIR จากกระแสเงินสดจริง |
| `types.ts` | `LoanTerms`, `PaymentEvent`, `ScheduleRow`, `RowFlag`, ... |
| `test-helpers.ts` | `makeTerms`, `fixedStep` สำหรับเทสต์ |

## src/lib — กาวระหว่าง UI กับ engine

| ไฟล์ | หน้าที่ |
|---|---|
| `supabase.ts` | client ตั้ง `db.schema = 'ponwai'` + storage แบบ "จำฉันไว้" (local/session) |
| `db.ts` | **ทางเดียวที่คุยกับ Supabase** แปลงแถว DB ↔ type ของ engine (`toLoanTerms`, `toPaymentEvents`) |
| `auth.tsx` | `AuthProvider` / `useAuth` |
| `progress.ts` | `settledPeriods`, `balanceOn`, `interestUpTo`, **`prepayOfRow`** (สูตรเดียวของคอลัมน์โปะ) |
| `closing.ts` | `rowsUntilClose`, `validateClose`, ป้ายเหตุผลการปิด |
| `format.ts` | เงิน (`baht`, `bahtFixed`, `bahtNumber` — มีสตางค์เสมอ), วันที่ พ.ศ., ช่วงคิดดอก |
| `report.ts` | รายงาน HTML ไฟล์เดียว เปิดออฟไลน์ได้ พิมพ์เป็น PDF ได้ |
| `export.ts` | CSV ตารางผ่อน / สรุปรายปี / การจ่าย / ภาษี / กระทบยอด |
| `persist.ts` | `useLocalState` — ฟอร์มหน้าเปรียบเทียบ/รีไฟแนนซ์ key ขึ้นต้น `ponwai:v2:` |

## src/features — หน้าจอ

| โฟลเดอร์ | หน้า | หมายเหตุ |
|---|---|---|
| `compare/` | ComparePage, ResultsTable, CostCurveChart | `model.ts` มี `BANK_PRESETS` (hardcode ฝั่ง client) |
| `refinance/` | RefinancePage, InterestCurveChart | ดึงหนี้จากสัญญาที่ติดตามได้ (TV-45) |
| `track/` | TrackPage (router ของแท็บ), LoanForm, LoanDetail | LoanDetail ใหญ่สุด: การจ่าย, ตารางผ่อน, ปิดสัญญา, ส่งออก |
| `dashboard/` | DashboardPage, charts | รวมทุกสัญญา — หนี้รวมไม่นับสัญญาที่ปิด |
| `prepay/` | PrepayPage | ปฏิทิน/รายการ, ROI, สิทธิลดหย่อนก่อน–หลังใส่แผน, บันทึกอัตโนมัติ |
| `reconcile/` | ReconcilePage | กรอกใบแจ้งยอด, ยืนยัน convention, ปฏิทินวันหยุด |
| `auth/` | SignInDialog | email+password, Google (โชว์เฉพาะเมื่อเปิด provider), จำฉันไว้ |

## เรื่องที่ตัดข้ามหลายส่วน

**การโหลดข้อมูลในแท็บติดตาม** — `TrackPage` โหลด `getAllLoansFull()` ครั้งเดียวเป็น `bundles`
แล้วส่งต่อให้ Dashboard / Prepay / Reconcile ส่วน `LoanDetail` โหลดสัญญาของตัวเองแยก
⚠️ ต้อง `reload()` ทุกครั้งก่อนสลับหน้า และ `LoanDetail` ต้องรับ item ตัวใหม่จาก bundles
(ไม่ใช่ `view.item` ที่ถือไว้ตอนกดเข้า) ไม่งั้นปิดสัญญาแล้วหน้ายังบอกว่ายังผ่อนอยู่

**เพดานลดหย่อนเป็นของคน ไม่ใช่ของสัญญา** — ทุกที่ที่คิดภาษีต้องส่งตารางของสัญญาอื่นเข้าไปด้วย
(`otherLoans`) และตารางเหล่านั้นต้องผ่าน `rowsUntilClose` แล้ว (`rowsOf` ใน TrackPage)

**PWA** — `sw.js` precache shell + bundle ตอนติดตั้ง, ⛔ ไม่ cache request ไป Supabase,
แก้ไฟล์นี้ต้องขึ้นเลข `VERSION` ไม่งั้น cache เก่าไม่ถูกล้าง

**Supabase ใช้ร่วมกับอีกแอพ** — free tier ได้ 2 project จึงแยกด้วย schema `ponwai`
`auth.users` เป็นชุดเดียวกัน ผู้ใช้อีกแอพล็อกอินได้แต่เห็นหน้าว่าง (RLS กรอง) — ไม่ใช่ช่องโหว่
