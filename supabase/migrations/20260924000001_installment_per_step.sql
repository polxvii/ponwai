-- ค่างวดที่ต่างกันตามช่วงของสัญญา
--
-- ธนาคารไทยมักคิดค่างวดช่วงโปร (ปี 1-3) ต่ำกว่าช่วงลอยตัว
-- ก่อนหน้านี้เก็บค่างวดค่าเดียวที่ active_loans.installment_satang
-- ตารางผ่อนจึงเพี้ยนตั้งแต่งวดที่พ้นโปรเป็นต้นไปสำหรับทุกสัญญาแบบนี้
--
-- ⚠️ เก็บไว้บนแถวเดียวกับขั้นอัตรา ไม่แยกตารางใหม่
--    เพราะช่วงของค่างวดกับช่วงของอัตราเป็นช่วงเดียวกันเสมอในใบเสนอของธนาคาร
--    แยกตารางจะเปิดทางให้สองชุดช่วงเวลาเพี้ยนจากกันโดยไม่มีอะไรบังคับให้ตรง
--
-- null = ใช้ active_loans.installment_satang ตามเดิม
-- สัญญาที่บันทึกไว้ก่อนหน้านี้จึงทำงานเหมือนเดิมทุกประการ ไม่ต้อง backfill

alter table ponwai.loan_rate_steps
  add column if not exists installment_satang bigint
    check (installment_satang is null or installment_satang > 0);

comment on column ponwai.loan_rate_steps.installment_satang is
  'ค่างวดของช่วงนี้ เป็นสตางค์ — null = ใช้ค่างวดตั้งต้นของสัญญา';
