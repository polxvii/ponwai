-- ปิดวันหยุดที่ seed มาให้เป็นรายคน
--
-- ⚠️ วันหยุดที่ seed ไว้ (user_id is null) เป็นของกลาง ผู้ใช้ลบทิ้งไม่ได้
--    RLS ให้เห็นแต่ห้ามเขียน ซึ่งถูกแล้ว — ลบได้จะกระทบทุกคน
--    แต่ปฏิทินของแต่ละธนาคารไม่เท่ากันจริง บางแห่งเปิดทำการในวันที่ ธปท. ประกาศหยุด
--    จึงต้องให้ "ปิดเฉพาะของตัวเอง" ได้ โดยไม่แตะแถวของกลาง
--
-- ⛔ ห้ามแก้เป็นให้ผู้ใช้ลบแถว user_id is null ได้
--    ข้อมูลจะหายจากทุกบัญชีพร้อมกันโดยไม่มีใครรู้ตัว

create table if not exists ponwai.bank_holiday_optouts (
  user_id      uuid not null references auth.users(id) on delete cascade,
  holiday_date date not null,
  primary key (user_id, holiday_date)
);

comment on table ponwai.bank_holiday_optouts is
  'วันหยุดของกลางที่ผู้ใช้เลือกไม่นับ — ไม่กระทบผู้ใช้คนอื่น';

alter table ponwai.bank_holiday_optouts enable row level security;

create policy bank_holiday_optouts_own on ponwai.bank_holiday_optouts
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists bank_holiday_optouts_date_idx
  on ponwai.bank_holiday_optouts(holiday_date);
