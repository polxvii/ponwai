-- ผ่อนไหว (ponwai) — Row Level Security
--
-- หลักการ (spec ข้อ 7):
--   ตารางของผู้ใช้        filter ผ่าน properties.user_id = auth.uid()
--   reference_rates       filter ด้วย user_id ตรง ๆ (ไม่ผูกกับทรัพย์สินใดทรัพย์สินหนึ่ง)
--   bank_holidays         เห็นของตัวเอง + ของที่ seed ไว้ (user_id is null)
--   banks                 preset อ่านอย่างเดียว เขียนได้เฉพาะ service_role
--   payment_allocations   เป็น derived ⛔ client ห้ามเขียนตรง

alter table ponwai.banks                   enable row level security;
alter table ponwai.properties              enable row level security;
alter table ponwai.loan_offers             enable row level security;
alter table ponwai.offer_rate_steps        enable row level security;
alter table ponwai.offer_fees              enable row level security;
alter table ponwai.offer_insurance         enable row level security;
alter table ponwai.reference_rates         enable row level security;
alter table ponwai.bank_holidays           enable row level security;
alter table ponwai.active_loans            enable row level security;
alter table ponwai.loan_rate_steps         enable row level security;
alter table ponwai.loan_conventions        enable row level security;
alter table ponwai.loan_schedule_overrides enable row level security;
alter table ponwai.payments                enable row level security;
alter table ponwai.payment_allocations     enable row level security;
alter table ponwai.statement_entries       enable row level security;
alter table ponwai.rate_change_events      enable row level security;
alter table ponwai.scenarios               enable row level security;
alter table ponwai.prepay_plans            enable row level security;
alter table ponwai.prepay_months           enable row level security;
alter table ponwai.prepay_overrides        enable row level security;
alter table ponwai.prepay_lumps            enable row level security;
alter table ponwai.user_prefs              enable row level security;

-- ------------------------------------------------------------
-- ข้อมูลอ้างอิงกลาง
-- ------------------------------------------------------------

create policy banks_read on ponwai.banks
  for select to authenticated using (true);
-- ไม่มี policy เขียน = เขียนได้เฉพาะ service_role ซึ่ง bypass RLS

-- ------------------------------------------------------------
-- ทรัพย์สิน — เป็นรากของ ownership chain ทั้งหมด
-- ------------------------------------------------------------

create policy properties_own on ponwai.properties
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- helper: ทรัพย์สินนี้เป็นของเราไหม
create or replace function ponwai.owns_property(p uuid)
returns boolean language sql stable security definer set search_path = ponwai, public as $$
  select exists (select 1 from ponwai.properties where id = p and user_id = auth.uid())
$$;

create or replace function ponwai.owns_offer(o uuid)
returns boolean language sql stable security definer set search_path = ponwai, public as $$
  select exists (
    select 1 from ponwai.loan_offers lo
    join ponwai.properties p on p.id = lo.property_id
    where lo.id = o and p.user_id = auth.uid()
  )
$$;

create or replace function ponwai.owns_loan(l uuid)
returns boolean language sql stable security definer set search_path = ponwai, public as $$
  select exists (
    select 1 from ponwai.active_loans al
    join ponwai.properties p on p.id = al.property_id
    where al.id = l and p.user_id = auth.uid()
  )
$$;

create or replace function ponwai.owns_plan(pl uuid)
returns boolean language sql stable security definer set search_path = ponwai, public as $$
  select exists (
    select 1 from ponwai.prepay_plans pp
    join ponwai.scenarios s   on s.id = pp.scenario_id
    join ponwai.active_loans al on al.id = s.loan_id
    join ponwai.properties p  on p.id = al.property_id
    where pp.id = pl and p.user_id = auth.uid()
  )
$$;

-- ------------------------------------------------------------
-- ข้อเสนอ
-- ------------------------------------------------------------

create policy loan_offers_own on ponwai.loan_offers
  for all to authenticated
  using (ponwai.owns_property(property_id)) with check (ponwai.owns_property(property_id));

create policy offer_rate_steps_own on ponwai.offer_rate_steps
  for all to authenticated
  using (ponwai.owns_offer(offer_id)) with check (ponwai.owns_offer(offer_id));

create policy offer_fees_own on ponwai.offer_fees
  for all to authenticated
  using (ponwai.owns_offer(offer_id)) with check (ponwai.owns_offer(offer_id));

create policy offer_insurance_own on ponwai.offer_insurance
  for all to authenticated
  using (ponwai.owns_offer(offer_id)) with check (ponwai.owns_offer(offer_id));

-- ------------------------------------------------------------
-- อัตราอ้างอิง — รายผู้ใช้ ไม่ผ่าน properties
-- ------------------------------------------------------------

create policy reference_rates_own on ponwai.reference_rates
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ⛔ แถวเดิมห้ามแก้ ถ้าผิดให้สร้างแถวใหม่แล้วชี้ superseded_by
-- อนุญาต UPDATE เฉพาะการเซ็ต superseded_by เท่านั้น ห้ามแก้ตัวเลขย้อนหลัง
create or replace function ponwai.reference_rates_immutable()
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
  before update on ponwai.reference_rates
  for each row execute function ponwai.reference_rates_immutable();

-- ------------------------------------------------------------
-- ปฏิทินวันหยุด — เห็นของตัวเอง + ของที่ seed ไว้
-- ------------------------------------------------------------

create policy bank_holidays_read on ponwai.bank_holidays
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

create policy bank_holidays_write on ponwai.bank_holidays
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy bank_holidays_modify on ponwai.bank_holidays
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy bank_holidays_remove on ponwai.bank_holidays
  for delete to authenticated using (user_id = (select auth.uid()));

-- ------------------------------------------------------------
-- สัญญา
-- ------------------------------------------------------------

create policy active_loans_own on ponwai.active_loans
  for all to authenticated
  using (ponwai.owns_property(property_id)) with check (ponwai.owns_property(property_id));

create policy loan_rate_steps_own on ponwai.loan_rate_steps
  for all to authenticated
  using (ponwai.owns_loan(loan_id)) with check (ponwai.owns_loan(loan_id));

create policy loan_conventions_own on ponwai.loan_conventions
  for all to authenticated
  using (ponwai.owns_loan(loan_id)) with check (ponwai.owns_loan(loan_id));

create policy loan_schedule_overrides_own on ponwai.loan_schedule_overrides
  for all to authenticated
  using (ponwai.owns_loan(loan_id)) with check (ponwai.owns_loan(loan_id));

create policy statement_entries_own on ponwai.statement_entries
  for all to authenticated
  using (ponwai.owns_loan(loan_id)) with check (ponwai.owns_loan(loan_id));

create policy rate_change_events_own on ponwai.rate_change_events
  for all to authenticated
  using (ponwai.owns_loan(loan_id)) with check (ponwai.owns_loan(loan_id));

-- ------------------------------------------------------------
-- การจ่าย — ห้ามลบจริง
-- ------------------------------------------------------------

create policy payments_read on ponwai.payments
  for select to authenticated using (ponwai.owns_loan(loan_id));

create policy payments_insert on ponwai.payments
  for insert to authenticated with check (ponwai.owns_loan(loan_id));

create policy payments_update on ponwai.payments
  for update to authenticated
  using (ponwai.owns_loan(loan_id)) with check (ponwai.owns_loan(loan_id));

-- ⛔ ไม่มี policy DELETE โดยตั้งใจ — ลบด้วยการเซ็ต deleted_at เท่านั้น
--    เพื่อให้ตารางที่เคยกระทบยอดตรงแล้ว ไม่เปลี่ยนเงียบโดยไม่มีร่องรอย

-- ------------------------------------------------------------
-- ผลการคำนวณ — derived เท่านั้น
-- ------------------------------------------------------------

create policy payment_allocations_read on ponwai.payment_allocations
  for select to authenticated
  using (exists (
    select 1 from ponwai.payments pm where pm.id = payment_id and ponwai.owns_loan(pm.loan_id)
  ));

-- ⛔ ไม่มี policy เขียน — client ห้ามเขียนตรง ต้องผ่าน service_role หรือ Edge Function
--    ถ้าให้ client เขียนได้ ตัวเลขที่ "คำนวณแล้ว" จะเชื่อถือไม่ได้

-- ------------------------------------------------------------
-- แผนโปะ
-- ------------------------------------------------------------

create policy scenarios_own on ponwai.scenarios
  for all to authenticated
  using (ponwai.owns_loan(loan_id)) with check (ponwai.owns_loan(loan_id));

create policy prepay_plans_own on ponwai.prepay_plans
  for all to authenticated
  using (exists (select 1 from ponwai.scenarios s where s.id = scenario_id and ponwai.owns_loan(s.loan_id)))
  with check (exists (select 1 from ponwai.scenarios s where s.id = scenario_id and ponwai.owns_loan(s.loan_id)));

create policy prepay_months_own on ponwai.prepay_months
  for all to authenticated
  using (ponwai.owns_plan(plan_id)) with check (ponwai.owns_plan(plan_id));

create policy prepay_overrides_own on ponwai.prepay_overrides
  for all to authenticated
  using (ponwai.owns_plan(plan_id)) with check (ponwai.owns_plan(plan_id));

create policy prepay_lumps_own on ponwai.prepay_lumps
  for all to authenticated
  using (ponwai.owns_plan(plan_id)) with check (ponwai.owns_plan(plan_id));

-- ------------------------------------------------------------
-- ตั้งค่าผู้ใช้
-- ------------------------------------------------------------

create policy user_prefs_own on ponwai.user_prefs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
