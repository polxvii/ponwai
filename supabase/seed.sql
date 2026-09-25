-- ผ่อนไหว (ponwai) — seed ข้อมูลอ้างอิงกลาง
--
-- ⛔ ห้าม seed อัตราโปรโมชั่นรายผลิตภัณฑ์ลงในระบบ (spec ข้อ 2.5)
--    เพราะเปลี่ยนทุกเดือนและขึ้นกับ LTV โปรไฟล์ผู้กู้ และการทำ MRTA
--    ถ้า seed ไปจะกลายเป็นตัวเลขปลอมที่แปะชื่อธนาคารจริง
--    ให้กรอกจากใบเสนอที่ได้มาเท่านั้น

-- MRR จากตารางประกาศธนาคารพาณิชย์ ณ 7 สิงหาคม 2569 [SOURCE: อินโฟเควสท์]
-- ต้องมี as_of เสมอ ถ้าเกิน 90 วัน UI ต้องขึ้น badge เตือนว่าควรตรวจสอบใหม่
insert into ponwai.banks (bank_code, name_th, name_en, is_sfi, mrr_bps, mrr_as_of) values
  ('BBL',   'กรุงเทพ',            'Bangkok Bank',            false, 6500, '2026-08-07'),
  ('SCB',   'ไทยพาณิชย์',          'Siam Commercial Bank',    false, 6575, '2026-08-07'),
  ('KBANK', 'กสิกรไทย',           'Kasikornbank',            false, 6580, '2026-08-07'),
  ('BAY',   'กรุงศรีอยุธยา',        'Bank of Ayudhya',         false, 6670, '2026-08-07'),
  ('KTB',   'กรุงไทย',             'Krungthai Bank',          false, 6845, '2026-08-07'),
  ('TTB',   'ทหารไทยธนชาต',        'TMBThanachart Bank',      false, 7105, '2026-08-07'),
  ('UOB',   'ยูโอบี',              'United Overseas Bank',    false, 8075, '2026-08-07')
on conflict (bank_code) do update set
  mrr_bps = excluded.mrr_bps,
  mrr_as_of = excluded.mrr_as_of;

-- สถาบันการเงินเฉพาะกิจ — ไม่อยู่ในตารางธนาคารพาณิชย์ จึงยังไม่มีค่า MRR ในมือ
-- แต่เป็นตัวเลือกหลักของคนซื้อบ้านไทยเพราะให้วงเงินสูงกว่า จะขาดไม่ได้
insert into ponwai.banks (bank_code, name_th, name_en, is_sfi) values
  ('GHB',   'ธอส.',               'Government Housing Bank',      true),
  ('GSB',   'ออมสิน',             'Government Savings Bank',      true),
  ('BAAC',  'ธ.ก.ส.',             'BAAC',                         true)
on conflict (bank_code) do nothing;

-- ธนาคารพาณิชย์อื่นที่ยังไม่มีค่า MRR
insert into ponwai.banks (bank_code, name_th, name_en, is_sfi) values
  ('CIMBT', 'ซีไอเอ็มบี ไทย',      'CIMB Thai Bank',      false),
  ('LHB',   'แลนด์ แอนด์ เฮ้าส์',   'LH Bank',             false)
on conflict (bank_code) do nothing;

-- ------------------------------------------------------------
-- วันหยุดธนาคาร (user_id = null คือ seed ให้ทุกคน)
--
-- ⚠️ ธปท. ประกาศปีต่อปี และมีวันหยุดที่ไม่ตายตัว:
--    วันพระใหญ่ตามจันทรคติ / วันหยุดชดเชย / วันหยุดพิเศษที่ ครม. ประกาศกะทันหัน
--    จึงคำนวณล่วงหน้า 30 ปีไม่ได้ ต้องเติมปีต่อปี
--    ปีที่ยังไม่มีข้อมูล engine fallback เป็นเสาร์-อาทิตย์ แล้วติดป้ายว่าเป็นวันประมาณการ
--
-- ด้านล่างเป็นเฉพาะวันที่ตายตัวของปี 2569-2570 (ค.ศ. 2026-2027)
-- ยังไม่รวมวันพระและวันหยุดชดเชย ผู้ใช้เพิ่มเองได้จาก UI
-- ------------------------------------------------------------

insert into ponwai.bank_holidays (user_id, holiday_date, name_th, source) values
  -- ปี 2568 (ค.ศ. 2025) — เฉพาะวันที่ตายตัว
  -- ⛔ ไม่ใส่วันหยุดชดเชยกับวันพระตามจันทรคติ เพราะยืนยันวันที่ไม่ได้
  --    ใส่ผิดแล้วตารางจะเพี้ยนแบบเงียบ ๆ ซึ่งแย่กว่าไม่มีเลย — ผู้ใช้เติมเองจาก UI ได้
  (null, '2025-01-01', 'วันขึ้นปีใหม่',              'bot_announcement'),
  (null, '2025-05-01', 'วันแรงงานแห่งชาติ',          'bot_announcement'),
  (null, '2025-07-28', 'วันเฉลิมพระชนมพรรษา ร.10',    'bot_announcement'),
  (null, '2025-08-12', 'วันเฉลิมพระชนมพรรษาพระบรมราชชนนีพันปีหลวง', 'bot_announcement'),
  (null, '2025-10-13', 'วันนวมินทรมหาราช',           'bot_announcement'),
  (null, '2025-10-23', 'วันปิยมหาราช',               'bot_announcement'),
  (null, '2025-12-05', 'วันคล้ายวันพระบรมราชสมภพ ร.9', 'bot_announcement'),
  (null, '2025-12-10', 'วันรัฐธรรมนูญ',              'bot_announcement'),
  (null, '2025-12-31', 'วันสิ้นปี',                  'bot_announcement'),
  (null, '2026-01-01', 'วันขึ้นปีใหม่',              'bot_announcement'),
  (null, '2026-04-06', 'วันจักรี',                   'bot_announcement'),
  (null, '2026-04-13', 'วันสงกรานต์',                'bot_announcement'),
  (null, '2026-04-14', 'วันสงกรานต์',                'bot_announcement'),
  (null, '2026-04-15', 'วันสงกรานต์',                'bot_announcement'),
  (null, '2026-05-01', 'วันแรงงานแห่งชาติ',          'bot_announcement'),
  (null, '2026-07-28', 'วันเฉลิมพระชนมพรรษา ร.10',    'bot_announcement'),
  (null, '2026-08-12', 'วันเฉลิมพระชนมพรรษาพระบรมราชชนนีพันปีหลวง', 'bot_announcement'),
  (null, '2026-10-13', 'วันนวมินทรมหาราช',           'bot_announcement'),
  (null, '2026-10-23', 'วันปิยมหาราช',               'bot_announcement'),
  (null, '2026-12-05', 'วันคล้ายวันพระบรมราชสมภพ ร.9', 'bot_announcement'),
  (null, '2026-12-10', 'วันรัฐธรรมนูญ',              'bot_announcement'),
  (null, '2026-12-31', 'วันสิ้นปี',                  'bot_announcement'),
  (null, '2027-01-01', 'วันขึ้นปีใหม่',              'bot_announcement'),
  (null, '2027-04-06', 'วันจักรี',                   'bot_announcement'),
  (null, '2027-04-13', 'วันสงกรานต์',                'bot_announcement'),
  (null, '2027-04-14', 'วันสงกรานต์',                'bot_announcement'),
  (null, '2027-04-15', 'วันสงกรานต์',                'bot_announcement'),
  (null, '2027-05-01', 'วันแรงงานแห่งชาติ',          'bot_announcement'),
  (null, '2027-07-28', 'วันเฉลิมพระชนมพรรษา ร.10',    'bot_announcement'),
  (null, '2027-08-12', 'วันเฉลิมพระชนมพรรษาพระบรมราชชนนีพันปีหลวง', 'bot_announcement'),
  (null, '2027-10-13', 'วันนวมินทรมหาราช',           'bot_announcement'),
  (null, '2027-10-23', 'วันปิยมหาราช',               'bot_announcement'),
  (null, '2027-12-05', 'วันคล้ายวันพระบรมราชสมภพ ร.9', 'bot_announcement'),
  (null, '2027-12-10', 'วันรัฐธรรมนูญ',              'bot_announcement'),
  (null, '2027-12-31', 'วันสิ้นปี',                  'bot_announcement')
on conflict do nothing;
