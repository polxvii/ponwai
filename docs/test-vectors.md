# Test vectors

TV = test vector — เทสต์ที่ตรึงกฎข้อหนึ่งไว้ ถ้าใครแก้กฎกลับ เทสต์ต้องแดงทันที
TV-1..TV-35 มาจาก spec ข้อ 9 ที่เหลือเพิ่มระหว่างพัฒนา ส่วนใหญ่มาจากบั๊กที่เจอจริง

⚠️ เพิ่ม TV ใหม่ต้องเพิ่มแถวในตารางนี้ด้วย — `src/lib/docs-sync.test.ts` (TV-56) ตรวจให้ ไม่มีแถว = CI แดง

| TV | ไฟล์ | ตรึงอะไรไว้ |
|---|---|---|
| TV-0 | engine/first-due-anchor.test.ts | งวดแรกและงวดถัดไปตรงใบแจ้งยอดจริง — anchor จาก `first_due_date` |
| TV-1 | engine/accrual.test.ts | ดอกรายวัน ตัวเลขอ้างอิงจาก spec |
| TV-2 | engine/schedule.test.ts | การแบ่งงวด ดอก/ต้น/คงเหลือของงวดแรก |
| TV-3 | engine/schedule.test.ts, accrual.test.ts | negative amortization ทั้งโหมดทบต้นและไม่ทบ |
| TV-4 | engine/schedule.test.ts | PMT ใช้ประมาณค่างวดตั้งต้นเท่านั้น |
| TV-5 | engine/accrual.test.ts | เดือนสั้น / เดือนยาว |
| TV-6 | engine/schedule.test.ts | เปลี่ยนขั้นอัตรา |
| TV-7 | engine/accrual.test.ts | อัตราเปลี่ยนกลางงวด แบ่งเป็นท่อน |
| TV-8 | engine/schedule.test.ts | โปะแบบลดงวด (shorten_term) ปิดที่ 0 พอดี |
| TV-9 | engine/schedule.test.ts | โปะเร็วขึ้น 1 วันประหยัดดอกมากกว่า — จุดที่ daily engine ชนะ monthly |
| TV-10 | engine/schedule.test.ts | งวดสุดท้าย ผลรวม = ดอก + ต้น |
| TV-11 | engine/compare.test.ts | เทียบแบบค่างวดเท่ากัน |
| TV-12 | engine/reconcile.test.ts | เดา convention จากใบแจ้งยอด |
| TV-13 | engine/accrual.test.ts | ปีปกติ ACT/365F กับ ACT/ACT ต้องเท่ากัน |
| TV-14 | engine/accrual.test.ts | ก.พ. ปีอธิกสุรทิน |
| TV-15 | engine/accrual.test.ts | ACT/ACT ตัดช่วงที่ขอบปี |
| TV-16 | engine/schedule.test.ts | ยอดรวมตลอดสัญญา |
| TV-17 | engine/schedule.test.ts | MRTA รวมในวงเงิน ไม่นับซ้ำ |
| TV-18 | engine/refinance.test.ts | กับดักยืดเทอมตอนรีไฟแนนซ์ |
| TV-19 | engine/fees.test.ts | ค่าธรรมเนียมแบบมีเพดาน |
| TV-20 | engine/fees.test.ts | ประกันอัคคีภัยเกิดซ้ำ |
| TV-21 | engine/prepay.test.ts, grouping.test.ts, import.test.ts | แผนโปะไม่เท่ากันรายเดือน |
| TV-22 | engine/prepay.test.ts | การ resolve ยอดโปะ (override > แผนฐาน > 0) |
| TV-23 | engine/schedule.test.ts | ยอดโปะเกินหนี้ ห้ามตัดเกิน |
| TV-24 | engine/grouping.test.ts | ปีสัญญา: เรตที่จ่ายจริงตรงกับที่ตกลง |
| TV-25 | engine/grouping.test.ts | สองแกนรวมได้เท่ากันทุกสตางค์ |
| TV-26 | engine/grouping.test.ts | ปีปฏิทิน: เพดานลดหย่อน |
| TV-27 | engine/grouping.test.ts | ห้ามเฉลี่ยอัตราแบบเลขคณิต |
| TV-28 | engine/invariants.test.ts, schedule.test.ts | invariant แบบสุ่ม 1,000 ชุด |
| TV-29 | engine/schedule.test.ts | date_roll ทิศทางถูก |
| TV-30 | engine/grouping.test.ts | เพดานลดหย่อนรวมข้ามสัญญา |
| TV-31 | engine/schedule.test.ts | override วันตัดรายงวด |
| TV-32 | engine/schedule.test.ts, first-due-anchor.test.ts | anchor ต้องไม่ไหล |
| TV-33 | engine/schedule.test.ts | guard ของ override |
| TV-34 | engine/refinance.test.ts | ค่างวดใหม่ต่ำกว่าดอก ต้องตีตก |
| TV-35 | engine/schedule.test.ts | ยอดจ่ายจริงแทนค่างวดตามสัญญา |
| TV-36 | lib/pwa.test.ts | service worker ลงทะเบียนจริง |
| TV-37 | features/dashboard/charts.test.ts | tooltip กราฟแท่งซ้อนบอกยอดรวม |
| TV-38 | features/compare/promo-gap.test.ts | เรตโปรเว้นว่างตรงกลางไม่ได้ |
| TV-39 | lib/progress.test.ts | ยอดคงเหลือวันนี้นับยอดที่จ่ายจริงแล้ว |
| TV-40 | features/dashboard/year-ticks.test.ts | ป้ายแกน x ไม่ทับกัน |
| TV-41 | engine/installment-steps.test.ts | ค่างวดต่างกันตามช่วง |
| TV-42 | features/track/installment-fallback.test.ts | ค่างวดตามสัญญาเว้นว่างได้เมื่อครบทุกช่วง |
| TV-43 | engine/prepay-roi.test.ts | เงินโปะที่จ่ายแล้วไม่ถูกนับเป็นเงินของแผนใหม่ |
| TV-44 | lib/interest-saved.test.ts | ดอกที่ประหยัดไปแล้ว ตัดที่งวดเดียวกันทั้งสองฝั่ง |
| TV-45 | features/refinance/prefill.test.ts | รีไฟแนนซ์ดึงหนี้จากสัญญาที่ติดตาม |
| TV-46 | features/prepay/before-term.test.ts | ค่างวดไม่พอปิดหนี้ ยังตอบ "ลดไปกี่ปี" ได้ |
| TV-47 | engine/missing-period.test.ts | งวดไม่มีบันทึกในช่วงที่บันทึกแล้ว = ไม่ได้จ่าย |
| TV-48 | features/compare/band-installments.test.ts | ค่างวดรายช่วงของใบเสนอ + ปิดเมื่อบังคับจ่ายเท่ากัน |
| TV-49 | lib/prepay-of-row.test.ts | คอลัมน์โปะตรงกับปฏิทินโปะ |
| TV-50 | engine/accrual-window.test.ts | ช่วงคิดดอก (วันตัดก่อน, วันตัดนี้] |
| TV-51 | engine/early-payment.test.ts | จ่ายก่อนวันตัด ตัดดอก ณ วันนั้น |
| TV-52 | lib/report.test.ts | รายงาน HTML ปลอดภัย ครบ คอลัมน์โปะถูก |
| TV-53 | lib/closing.test.ts, report.test.ts | ปิดสัญญา: ตัดตาราง เงื่อนไข ตารางฐานตัดด้วย |
| TV-54 | lib/format.test.ts | เงินแสดงสตางค์เสมอ — สแกนซอร์สหาที่สั่งปัดทิ้ง |
| TV-55 | engine/plan-vs-actual.test.ts | แผนโปะห้ามบวกทับเดือนที่จ่ายจริงแล้ว |
| TV-56 | lib/docs-sync.test.ts | เอกสารตามโค้ดทัน — ทุก TV / migration อยู่ใน docs, ลิงก์ไม่เสีย, ภาพ diagram ตรงต้นฉบับ, สรุป HTML ไม่อ้างของภายนอก |

## เทสต์ที่ไม่มีเลข TV

| ไฟล์ | ทำอะไร |
|---|---|
| `lib/db.live.test.ts` | ยิง Supabase จริง (ข้ามถ้าไม่มี `PONWAI_TEST_EMAIL/PASSWORD` ใน env) — `npm run test:live` |
| `lib/export.test.ts` | CSV |
| `components/ribbon-crossover.test.ts` | จุดที่เงินต้นแซงดอกใน Split Ribbon |
| `engine/xirr`, `compare`, `fees`, `import` … | เทสต์ย่อยที่ไม่ได้ผูกกฎเฉพาะ |
