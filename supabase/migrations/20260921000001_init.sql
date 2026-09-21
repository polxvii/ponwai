-- ผ่อนไหว (ponwai) — schema ตั้งต้น
-- อ้างอิง spec ข้อ 7 พร้อมข้อตัดสินใจทั้งหมดจากรอบรีวิว
--
-- กฎชนิดข้อมูลที่ห้ามละเมิด:
--   เงิน            = bigint หน่วยสตางค์   ห้าม numeric ห้าม float
--   อัตรา/เปอร์เซ็นต์ = int หน่วย bps        ห้ามมี column ลงท้าย _pct
--   วันที่           = date ค.ศ. เสมอ       พ.ศ. แปลงที่ชั้น UI เท่านั้น (ข้อ 5.3)

create extension if not exists "pgcrypto";

-- ทุกอย่างอยู่ใน schema ของตัวเอง เพื่อให้ใช้ Supabase project ร่วมกับแอพอื่นได้
-- (free tier ให้ 2 project) ข้อมูลแยกสนิทด้วย schema + RLS
--
-- ⚠️ auth.users ใช้ร่วมกัน — GoTrue มีชุดเดียวต่อ project แยกไม่ได้
--    ผู้ใช้ของอีกแอพล็อกอินเข้ามาได้ แต่เห็นหน้าว่างเพราะ RLS กรองด้วย user_id
--    ไม่ใช่ช่องโหว่ เพราะข้อมูลไม่รั่ว
-- ⚠️ ต้องเพิ่ม 'ponwai' ใน Settings -> API -> Exposed schemas
--    ไม่งั้น PostgREST มองไม่เห็นตารางเลย
-- ⚠️ ฝั่ง client ต้องตั้ง createClient(url, key, { db: { schema: 'ponwai' } })
create schema if not exists ponwai;
grant usage on schema ponwai to authenticated, anon;

-- ============================================================
-- ข้อมูลอ้างอิงกลาง
-- ============================================================

-- preset ธนาคาร (ข้อ 2.5) — อ่านได้ทุกคน เขียนได้เฉพาะ service_role
-- ⛔ ห้าม seed อัตราโปรโมชั่นรายผลิตภัณฑ์ เพราะเปลี่ยนทุกเดือนและขึ้นกับ LTV
--    ถ้า seed จะกลายเป็นตัวเลขปลอมที่แปะชื่อธนาคารจริง
create table ponwai.banks (
  bank_code       text primary key,
  name_th         text not null,
  name_en         text,
  is_sfi          boolean not null default false,  -- สถาบันการเงินเฉพาะกิจ เช่น ธอส. ออมสิน
  rate_notice_url text,
  -- MRR ที่ seed ไว้ ต้องมี as_of_date เสมอ เกิน 90 วันให้ UI เตือนว่าควรตรวจใหม่
  mrr_bps         int,
  mrr_as_of       date,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- ทรัพย์สินและข้อเสนอ
-- ============================================================

-- ผู้ใช้หนึ่งคนมีได้หลายหลัง (ข้อ 7)
-- ⛔ ไม่มี property_members ใน v1 — กู้ร่วมแบบแชร์บัญชีอยู่นอกขอบเขต
--    แต่ tax_config.borrower_count ยังอยู่ เพื่อหารสิทธิลดหย่อน (ข้อ 1.9)
create table ponwai.properties (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  name                   text not null,
  purchase_price_satang  bigint,
  down_payment_satang    bigint,
  created_at             timestamptz not null default now()
);
create index properties_user_idx on ponwai.properties(user_id);

create table ponwai.loan_offers (
  id                        uuid primary key default gen_random_uuid(),
  property_id               uuid not null references ponwai.properties(id) on delete cascade,
  bank_code                 text references ponwai.banks(bank_code),
  bank_name                 text,
  product_name              text,
  loan_amount_satang        bigint not null,
  term_months               int not null,
  installment_basis         text not null default 'quoted'
                              check (installment_basis in ('quoted','computed_from_rate')),
  installment_quoted_satang bigint,
  lockin_months             int not null default 36,
  prepay_penalty_bps        int not null default 300,   -- 300 = 3.00%
  quote_date                date,
  source_url                text,
  notes                     text,
  created_at                timestamptz not null default now()
);
create index loan_offers_property_idx on ponwai.loan_offers(property_id);

-- อัตราชั้นที่ 1 — ผูกกับเลขงวด ไม่ใช่วันที่ (ข้อ 1.3)
create table ponwai.offer_rate_steps (
  id             uuid primary key default gen_random_uuid(),
  offer_id       uuid not null references ponwai.loan_offers(id) on delete cascade,
  from_month     int not null,
  to_month       int,                                   -- null = จนจบสัญญา
  kind           text not null check (kind in ('fixed','index_minus','index_plus')),
  fixed_rate_bps int,
  index_code     text check (index_code in ('MRR','MLR','MOR')),
  spread_bps     int,
  check (
    (kind = 'fixed' and fixed_rate_bps is not null)
    or (kind <> 'fixed' and index_code is not null and spread_bps is not null)
  )
);
create index offer_rate_steps_offer_idx on ponwai.offer_rate_steps(offer_id, from_month);

-- ค่าธรรมเนียม (ข้อ 1.7 ประเภท A)
-- cap_satang กับ waiver_cap_satang เป็นคนละตัว:
--   cap_satang        เพดานของค่าธรรมเนียมเอง  เช่น อากรแสตมป์ไม่เกิน 10,000
--   waiver_cap_satang เพดานของ "ฟรี"           เช่น ฟรีค่าจดจำนองสูงสุด 100,000
create table ponwai.offer_fees (
  id                uuid primary key default gen_random_uuid(),
  offer_id          uuid not null references ponwai.loan_offers(id) on delete cascade,
  fee_type          text not null,
  basis             text not null check (basis in ('flat','pct_of_loan')),
  amount_satang     bigint,
  pct_bps           int,
  cap_satang        bigint,
  is_waived         boolean not null default false,
  waiver_cap_satang bigint,
  is_financed       boolean not null default false,     -- รวมในวงเงิน = อยู่ในเงินต้นแล้ว
  clawback_months   int,                                -- ปิดก่อน N เดือนต้องคืนของแถม
  note              text
);
create index offer_fees_offer_idx on ponwai.offer_fees(offer_id);

-- ประกัน (ข้อ 1.7 ประเภท B และ C)
create table ponwai.offer_insurance (
  id                        uuid primary key default gen_random_uuid(),
  offer_id                  uuid not null references ponwai.loan_offers(id) on delete cascade,
  kind                      text not null check (kind in ('fire','MRTA','MLTA')),
  premium_satang            bigint not null,
  term_years                int,        -- ประกันอัคคีภัย ต่อทุกกี่ปี
  coverage_years            int,        -- MRTA มักสั้นกว่าอายุสัญญา
  waived_first_n_years      int not null default 0,
  escalation_bps_per_renewal int not null default 0,    -- default 0 ถ้าไม่รู้ อย่าเดา
  financed                  boolean not null default false,
  rate_discount_bps         int not null default 0,
  is_required               boolean not null default false,
  surrender_value_bps       int,        -- null = ยังไม่ยืนยัน ให้แสดงเป็นช่วง 30-50% (ข้อ 1.8)
  note                      text
);
create index offer_insurance_offer_idx on ponwai.offer_insurance(offer_id);

-- ============================================================
-- อัตราอ้างอิง — รายผู้ใช้ (ตัดสินใจแล้ว ข้อ 11.1)
-- ============================================================

-- ⛔ แถวเดิมห้ามแก้ ถ้าผิดให้สร้างแถวใหม่แล้วชี้ superseded_by
--    เพราะถ้าแก้ย้อนหลัง ตารางที่เคยกระทบยอดตรงกับใบแจ้งยอดจะเพี้ยนโดยไม่มีใครรู้ (ข้อ 12.1)
create table ponwai.reference_rates (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  bank_code      text,
  index_code     text not null check (index_code in ('MRR','MLR','MOR')),
  rate_bps       int not null,
  effective_date date not null,
  source         text not null default 'manual' check (source in ('manual','bank_notice')),
  confidence     text not null default 'unconfirmed' check (confidence in ('confirmed','unconfirmed')),
  source_url     text,
  entered_at     timestamptz not null default now(),
  superseded_by  uuid references ponwai.reference_rates(id)
);
create index reference_rates_lookup_idx
  on ponwai.reference_rates(user_id, bank_code, index_code, effective_date desc);

-- ปฏิทินวันหยุดธนาคาร — จำเป็นเมื่อ roll_calendar = 'weekend_and_bank_holidays' (ข้อ 1.4.1)
-- user_id null = seed มาให้ / ไม่ null = ผู้ใช้เพิ่มเอง
-- ปีที่ยังไม่มีข้อมูล engine fallback เป็นเสาร์-อาทิตย์ แล้วติดป้ายว่าเป็นวันประมาณการ
create table ponwai.bank_holidays (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  holiday_date date not null,
  name_th      text,
  source       text not null default 'user_added' check (source in ('bot_announcement','user_added')),
  unique nulls not distinct (user_id, holiday_date)
);
create index bank_holidays_date_idx on ponwai.bank_holidays(holiday_date);

-- ============================================================
-- สัญญาที่เซ็นแล้ว
-- ============================================================

create table ponwai.active_loans (
  id                      uuid primary key default gen_random_uuid(),
  property_id             uuid not null references ponwai.properties(id) on delete cascade,
  offer_id                uuid references ponwai.loan_offers(id),
  contract_date           date not null,
  -- วันเริ่มคิดดอกเบี้ยงวดแรก ผู้ใช้แก้ได้ default = วันเบิกเงินกู้ (ข้อ 1.4.2)
  -- แยกจาก contract_date เพราะเป็นสาเหตุอันดับหนึ่งที่งวดแรกกระทบยอดไม่ตรง
  first_accrual_date      date not null,
  first_due_date          date not null,
  due_day_of_month        int not null check (due_day_of_month between 1 and 31),
  -- กฎเลื่อนวันตัด (ข้อ 1.4.1) — preceding = ขยับมาเร็วขึ้น มีอยู่จริงในสัญญาไทย
  date_roll               text not null default 'none'
                            check (date_roll in ('none','preceding','following')),
  roll_calendar           text not null default 'weekend_only'
                            check (roll_calendar in ('weekend_only','weekend_and_bank_holidays')),
  term_months             int not null,
  disbursed_amount_satang bigint not null,   -- ค่าเดียว เบิกหลายงวดอยู่นอกขอบเขต v1 (ข้อ 0.1)
  installment_satang      bigint not null,
  prepay_mode             text not null default 'shorten_term'
                            check (prepay_mode in ('shorten_term','reduce_installment')),
  status                  text not null default 'active'
                            check (status in ('active','closed')),
  -- โซ่รีไฟแนนซ์ (ข้อ 2A.4)
  supersedes_loan_id      uuid references ponwai.active_loans(id),
  origin                  text not null default 'new_purchase'
                            check (origin in ('new_purchase','refinance','retention')),
  resets_lockin           boolean not null default true,
  closed_date             date,
  closing_reason          text check (closing_reason in ('refinanced','paid_off')),
  -- import แบบ Quick ไม่มีประวัติย้อนหลัง ต้องติดธงให้ UI เตือน (ข้อ 2A.5)
  import_mode             text check (import_mode in ('quick','full')),
  created_at              timestamptz not null default now()
);
create index active_loans_property_idx on ponwai.active_loans(property_id);

-- อัตราของสัญญาที่เซ็นแล้ว แยกจาก offer เพราะ retention/refinance เปลี่ยนเรตได้
create table ponwai.loan_rate_steps (
  id             uuid primary key default gen_random_uuid(),
  loan_id        uuid not null references ponwai.active_loans(id) on delete cascade,
  from_month     int not null,
  to_month       int,
  kind           text not null check (kind in ('fixed','index_minus','index_plus')),
  fixed_rate_bps int,
  index_code     text check (index_code in ('MRR','MLR','MOR')),
  spread_bps     int
);
create index loan_rate_steps_loan_idx on ponwai.loan_rate_steps(loan_id, from_month);

-- ⛔ วิธีนับวัน/ปัดเศษ ต้อง effective-dated เสมอ (ข้อ 1.1.1)
--    มีหลักฐานว่าธนาคารเปลี่ยน convention กลางสัญญา
--    การยืนยันจาก reconciliation ต้องสร้างแถวใหม่ ไม่ใช่แก้แถวเดิม
create table ponwai.loan_conventions (
  id                          uuid primary key default gen_random_uuid(),
  loan_id                     uuid not null references ponwai.active_loans(id) on delete cascade,
  effective_from              date not null,
  day_count_basis             text not null default 'ACT/365F'
                                check (day_count_basis in ('ACT/365F','ACT/ACT','ACT/365_SKIP')),
  interest_rounding           text not null default 'round_satang'
                                check (interest_rounding in ('floor_baht','floor_satang','round_satang','none')),
  -- false = ดอกค้างแยกบัญชี ไม่ทบต้น (default ตาม ป.พ.พ. ม.655) | true = ทบเข้าเงินต้น
  capitalise_unpaid_interest  boolean not null default false,
  source                      text not null default 'assumed'
                                check (source in ('contract','inferred','user_override','assumed')),
  confidence                  text not null default 'assumed'
                                check (confidence in ('confirmed','assumed')),
  note                        text,
  created_at                  timestamptz not null default now(),
  unique (loan_id, effective_from)
);

-- แก้วันตัดเฉพาะงวด (ข้อ 1.4.3) — override ชนะกฎอัตโนมัติเสมอ
-- ⛔ override งวดหนึ่งห้ามทำให้งวดถัดไปขยับ nominal นับจากวันเริ่มสัญญาเสมอ
create table ponwai.loan_schedule_overrides (
  id           uuid primary key default gen_random_uuid(),
  loan_id      uuid not null references ponwai.active_loans(id) on delete cascade,
  period_index int not null check (period_index >= 1),
  due_date     date not null,
  reason       text not null default 'user_correction'
                 check (reason in ('user_correction','from_statement','special_holiday')),
  created_at   timestamptz not null default now(),
  unique (loan_id, period_index)
);

-- ============================================================
-- การจ่ายจริง
-- ============================================================

-- ⛔ id ต้องสร้างฝั่ง client (crypto.randomUUID) ตั้งแต่ตอน enqueue
--    เพราะ 5A.5 ระบุ offline queue ใน IndexedDB + optimistic UI
--    ถ้าให้ DB gen เอง การ retry จะสร้างรายการจ่ายซ้ำ
-- ⛔ ห้าม DELETE จริง ใช้ deleted_at เท่านั้น
--    ไม่งั้นงวดที่เคยกระทบยอด 'เขียว' จะเปลี่ยนเงียบโดยไม่มีร่องรอย
create table ponwai.payments (
  id            uuid primary key,          -- ไม่มี default โดยตั้งใจ
  loan_id       uuid not null references ponwai.active_loans(id) on delete cascade,
  paid_date     date not null,
  amount_satang bigint not null check (amount_satang > 0),
  kind          text not null check (kind in ('installment','partial_prepay','full_redemption','fee')),
  channel       text,
  note          text,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index payments_loan_date_idx on ponwai.payments(loan_id, paid_date) where deleted_at is null;

-- ผลการคำนวณ derived — cache ได้ แต่ต้อง recompute ได้เสมอ
-- กฎ invalidate: insert/แก้/soft-delete payment ที่ paid_date = D
--   ต้อง recompute ทุกงวดตั้งแต่ D เป็นต้นไป ไม่ใช่แค่งวดนั้น
--   และต้อง re-flag reconciliation ของงวดที่กระทบด้วย
create table ponwai.payment_allocations (
  id                           uuid primary key default gen_random_uuid(),
  payment_id                   uuid not null references ponwai.payments(id) on delete cascade,
  interest_satang              bigint not null,
  principal_satang             bigint not null,
  fee_satang                   bigint not null default 0,
  accrued_interest_after_satang bigint not null default 0,  -- ดอกค้างยกไป (ข้อ 1.2)
  balance_after_satang         bigint not null,
  accrual_days                 int not null,
  effective_rate_bps           int not null,
  computed_at                  timestamptz not null default now(),
  engine_version               text not null,
  unique (payment_id)
);

-- ใบแจ้งยอดธนาคาร สำหรับกระทบยอด (ข้อ 3.3)
create table ponwai.statement_entries (
  id               uuid primary key default gen_random_uuid(),
  loan_id          uuid not null references ponwai.active_loans(id) on delete cascade,
  stmt_date        date not null,
  interest_satang  bigint,
  principal_satang bigint,
  balance_satang   bigint,
  source           text not null default 'manual' check (source in ('manual','import')),
  created_at       timestamptz not null default now(),
  unique (loan_id, stmt_date)
);

create table ponwai.rate_change_events (
  id             uuid primary key default gen_random_uuid(),
  loan_id        uuid not null references ponwai.active_loans(id) on delete cascade,
  effective_date date not null,
  new_rate_bps   int not null,
  reason         text,
  source_url     text
);

-- ============================================================
-- แผนโปะ / what-if (ข้อ 3.4)
-- ============================================================

create table ponwai.scenarios (
  id         uuid primary key default gen_random_uuid(),
  loan_id    uuid not null references ponwai.active_loans(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

-- เก็บเป็นแผน 12 เดือน + override รายปี ไม่ใช่ array 360 ช่อง
create table ponwai.prepay_plans (
  id                uuid primary key default gen_random_uuid(),
  scenario_id       uuid not null references ponwai.scenarios(id) on delete cascade,
  base_year         int not null,
  repeat_mode       text not null default 'repeat_forever'
                      check (repeat_mode in ('single_year','repeat_forever','repeat_until')),
  repeat_until_year int
);

create table ponwai.prepay_months (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references ponwai.prepay_plans(id) on delete cascade,
  month         int not null check (month between 1 and 12),
  amount_satang bigint not null default 0,
  unique (plan_id, month)
);

create table ponwai.prepay_overrides (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references ponwai.prepay_plans(id) on delete cascade,
  year          int not null,
  month         int not null check (month between 1 and 12),
  amount_satang bigint not null default 0,
  unique (plan_id, year, month)
);

-- ก้อนเดี่ยวตามวันที่ — "บวกเพิ่ม" จากยอดรายเดือน ไม่ใช่แทนที่ (TV-22)
create table ponwai.prepay_lumps (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references ponwai.prepay_plans(id) on delete cascade,
  pay_date      date not null,
  amount_satang bigint not null check (amount_satang > 0),
  label         text
);

-- ============================================================
-- ตั้งค่าผู้ใช้
-- ============================================================

create table ponwai.user_prefs (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  prepay_view           text not null default 'calendar' check (prepay_view in ('calendar','list')),
  schedule_axis         text not null default 'contract_year'
                          check (schedule_axis in ('contract_year','calendar_year')),
  marginal_tax_rate_bps int,        -- null = ซ่อนคอลัมน์ ROI หลังภาษี อย่าเดาอัตรา
  is_joint_loan         boolean not null default false,
  borrower_count        int not null default 1 check (borrower_count >= 1),
  last_property_id      uuid references ponwai.properties(id) on delete set null,
  updated_at            timestamptz not null default now()
);
