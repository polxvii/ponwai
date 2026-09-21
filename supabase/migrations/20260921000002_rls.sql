-- ผ่อนไหว (ponwai) — Row Level Security
--
-- หลักการ (spec ข้อ 7):
--   ตารางของผู้ใช้        filter ผ่าน properties.user_id = auth.uid()
--   reference_rates       filter ด้วย user_id ตรง ๆ (ไม่ผูกกับทรัพย์สินใดทรัพย์สินหนึ่ง)
--   bank_holidays         เห็นของตัวเอง + ของที่ seed ไว้ (user_id is null)
--   banks                 preset อ่านอย่างเดียว เขียนได้เฉพาะ service_role
--   payment_allocations   เป็น derived ⛔ client ห้ามเขียนตรง

alter table banks                   enable row level security;
alter table properties              enable row level security;
alter table loan_offers             enable row level security;
alter table offer_rate_steps        enable row level security;
alter table offer_fees              enable row level security;
alter table offer_insurance         enable row level security;
alter table reference_rates         enable row level security;
alter table bank_holidays           enable row level security;
alter table active_loans            enable row level security;
alter table loan_rate_steps         enable row level security;
alter table loan_conventions        enable row level security;
alter table loan_schedule_overrides enable row level security;
alter table payments                enable row level security;
alter table payment_allocations     enable row level security;
alter table statement_entries       enable row level security;
alter table rate_change_events      enable row level security;
alter table scenarios               enable row level security;
alter table prepay_plans            enable row level security;
alter table prepay_months           enable row level security;
alter table prepay_overrides        enable row level security;
alter table prepay_lumps            enable row level security;
alter table user_prefs              enable row level security;

-- ------------------------------------------------------------
-- ข้อมูลอ้างอิงกลาง
-- ------------------------------------------------------------

create policy banks_read on banks
  for select to authenticated using (true);
-- ไม่มี policy เขียน = เขียนได้เฉพาะ service_role ซึ่ง bypass RLS

-- ------------------------------------------------------------
-- ทรัพย์สิน — เป็นรากของ ownership chain ทั้งหมด
-- ------------------------------------------------------------

create policy properties_own on properties
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- helper: ทรัพย์สินนี้เป็นของเราไหม
create or replace function owns_property(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from properties where id = p and user_id = auth.uid())
$$;

create or replace function owns_offer(o uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from loan_offers lo
    join properties p on p.id = lo.property_id
    where lo.id = o and p.user_id = auth.uid()
  )
$$;

create or replace function owns_loan(l uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from active_loans al
    join properties p on p.id = al.property_id
    where al.id = l and p.user_id = auth.uid()
  )
$$;

create or replace function owns_plan(pl uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from prepay_plans pp
    join scenarios s   on s.id = pp.scenario_id
    join active_loans al on al.id = s.loan_id
    join properties p  on p.id = al.property_id
    where pp.id = pl and p.user_id = auth.uid()
  )
$$;

-- ------------------------------------------------------------
-- ข้อเสนอ
-- ------------------------------------------------------------

create policy loan_offers_own on loan_offers
  for all to authenticated
  using (owns_property(property_id)) with check (owns_property(property_id));

create policy offer_rate_steps_own on offer_rate_steps
  for all to authenticated
  using (owns_offer(offer_id)) with check (owns_offer(offer_id));

create policy offer_fees_own on offer_fees
  for all to authenticated
  using (owns_offer(offer_id)) with check (owns_offer(offer_id));

create policy offer_insurance_own on offer_insurance
  for all to authenticated
  using (owns_offer(offer_id)) with check (owns_offer(offer_id));

-- ------------------------------------------------------------
-- อัตราอ้างอิง — รายผู้ใช้ ไม่ผ่าน properties
-- ------------------------------------------------------------

create policy reference_rates_own on reference_rates
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ⛔ แถวเดิมห้ามแก้ ถ้าผิดให้สร้างแถวใหม่แล้วชี้ superseded_by
-- อนุญาต UPDATE เฉพาะการเซ็ต superseded_by เท่านั้น ห้ามแก้ตัวเลขย้อนหลัง
create or replace function reference_rates_immutable()
returns trigger language plpgsql as $$
begin
  if new.rate_bps       is distinct from old.rate_bps
  or new.effective_date is distinct from old.effective_date
  or new.index_code     is distinct from old.index_code
  or new.bank_code      is distinct from old.bank_code then
    raise exception 'reference_rates เป็น immutable — ถ้าค่าผิด ให้สร้างแถวใหม่แล้วชี้ superseded_by (spec ข้อ 12.1)';
  end if;
  return new;
end $$;

create trigger reference_rates_no_rewrite
  before update on reference_rates
  for each row execute function reference_rates_immutable();

-- ------------------------------------------------------------
-- ปฏิทินวันหยุด — เห็นของตัวเอง + ของที่ seed ไว้
-- ------------------------------------------------------------

create policy bank_holidays_read on bank_holidays
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

create policy bank_holidays_write on bank_holidays
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy bank_holidays_modify on bank_holidays
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy bank_holidays_remove on bank_holidays
  for delete to authenticated using (user_id = (select auth.uid()));

-- ------------------------------------------------------------
-- สัญญา
-- ------------------------------------------------------------

create policy active_loans_own on active_loans
  for all to authenticated
  using (owns_property(property_id)) with check (owns_property(property_id));

create policy loan_rate_steps_own on loan_rate_steps
  for all to authenticated
  using (owns_loan(loan_id)) with check (owns_loan(loan_id));

create policy loan_conventions_own on loan_conventions
  for all to authenticated
  using (owns_loan(loan_id)) with check (owns_loan(loan_id));

create policy loan_schedule_overrides_own on loan_schedule_overrides
  for all to authenticated
  using (owns_loan(loan_id)) with check (owns_loan(loan_id));

create policy statement_entries_own on statement_entries
  for all to authenticated
  using (owns_loan(loan_id)) with check (owns_loan(loan_id));

create policy rate_change_events_own on rate_change_events
  for all to authenticated
  using (owns_loan(loan_id)) with check (owns_loan(loan_id));

-- ------------------------------------------------------------
-- การจ่าย — ห้ามลบจริง
-- ------------------------------------------------------------

create policy payments_read on payments
  for select to authenticated using (owns_loan(loan_id));

create policy payments_insert on payments
  for insert to authenticated with check (owns_loan(loan_id));

create policy payments_update on payments
  for update to authenticated
  using (owns_loan(loan_id)) with check (owns_loan(loan_id));

-- ⛔ ไม่มี policy DELETE โดยตั้งใจ — ลบด้วยการเซ็ต deleted_at เท่านั้น
--    เพื่อให้ตารางที่เคยกระทบยอดตรงแล้ว ไม่เปลี่ยนเงียบโดยไม่มีร่องรอย

-- ------------------------------------------------------------
-- ผลการคำนวณ — derived เท่านั้น
-- ------------------------------------------------------------

create policy payment_allocations_read on payment_allocations
  for select to authenticated
  using (exists (
    select 1 from payments pm where pm.id = payment_id and owns_loan(pm.loan_id)
  ));

-- ⛔ ไม่มี policy เขียน — client ห้ามเขียนตรง ต้องผ่าน service_role หรือ Edge Function
--    ถ้าให้ client เขียนได้ ตัวเลขที่ "คำนวณแล้ว" จะเชื่อถือไม่ได้

-- ------------------------------------------------------------
-- แผนโปะ
-- ------------------------------------------------------------

create policy scenarios_own on scenarios
  for all to authenticated
  using (owns_loan(loan_id)) with check (owns_loan(loan_id));

create policy prepay_plans_own on prepay_plans
  for all to authenticated
  using (exists (select 1 from scenarios s where s.id = scenario_id and owns_loan(s.loan_id)))
  with check (exists (select 1 from scenarios s where s.id = scenario_id and owns_loan(s.loan_id)));

create policy prepay_months_own on prepay_months
  for all to authenticated
  using (owns_plan(plan_id)) with check (owns_plan(plan_id));

create policy prepay_overrides_own on prepay_overrides
  for all to authenticated
  using (owns_plan(plan_id)) with check (owns_plan(plan_id));

create policy prepay_lumps_own on prepay_lumps
  for all to authenticated
  using (owns_plan(plan_id)) with check (owns_plan(plan_id));

-- ------------------------------------------------------------
-- ตั้งค่าผู้ใช้
-- ------------------------------------------------------------

create policy user_prefs_own on user_prefs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
