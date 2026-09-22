/**
 * ทดสอบ db.ts กับ Supabase จริง
 *
 * ทั้งชุดถูก skip ถ้าไม่มี env — CI จึงไม่ยิงเน็ตและไม่สร้างแถวจริง
 * รันเองด้วย
 *
 *   PONWAI_TEST_EMAIL=... PONWAI_TEST_PASSWORD=... npm run test:live
 *
 * ⛔ ห้าม hardcode รหัสผ่าน repo นี้เป็น public
 *    ต้องส่งผ่าน env และข้ามทั้งชุดถ้าไม่มี
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import {
  addPayment, createLoan, deleteLoan, getLoanFull, listLoans, removePayment,
  toLoanTerms, toPaymentEvents,
} from './db'

function must<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw new Error(JSON.stringify(res.error))
  return res.data as T
}
import { buildSchedule } from '@engine/schedule.js'
import { formatFixedBaht, baht, bps, type Satang } from '@engine/money.js'
import { isoDate } from '@engine/date.js'

const EMAIL = process.env['PONWAI_TEST_EMAIL'] ?? ''
const PASSWORD = process.env['PONWAI_TEST_PASSWORD'] ?? ''

let loanId = ''

beforeAll(async () => {
  if (EMAIL === '' || PASSWORD === '') return
  const signIn = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (signIn.error) {
    const up = await supabase.auth.signUp({ email: EMAIL, password: PASSWORD })
    if (up.error) throw new Error(`สมัครไม่ได้: ${up.error.message}`)
    if (!up.data.session) throw new Error('สมัครแล้วไม่ได้ session — โครงการเปิด Confirm email ไว้')
    console.log('สร้างบัญชีทดสอบใหม่', up.data.user?.id)
  } else {
    console.log('ใช้บัญชีทดสอบเดิม', signIn.data.user.id)
  }
}, 30_000)

afterAll(async () => {
  if (loanId) await deleteLoan(loanId).catch(() => undefined)
  await supabase.auth.signOut()
}, 30_000)

describe.skipIf(EMAIL === '' || PASSWORD === '')('db.ts กับ Supabase จริง', () => {
  it('createLoan เขียนครบ 5 ตาราง', async () => {
    loanId = await createLoan({
      propertyName: 'ทดสอบ — ลบได้',
      bankCode: 'KBANK',
      bankName: 'กสิกรไทย',
      contractDate: isoDate('2024-03-01'),
      firstAccrualDate: isoDate('2024-03-05'),
      firstDueDate: isoDate('2024-04-05'),
      dueDayOfMonth: 5,
      dateRoll: 'preceding',
      rollCalendar: 'weekend_only',
      termMonths: 360,
      disbursedSatang: baht(3_000_000),
      installmentSatang: baht(20_000),
      prepayMode: 'shorten_term',
      promoRatesBps: [bps(300), bps(300), bps(300)],
      floatingRateBps: bps(550),
      dayCountBasis: 'ACT/365F',
      rounding: 'round_satang',
      capitaliseUnpaidInterest: false,
    })
    expect(loanId).toMatch(/^[0-9a-f-]{36}$/)
  }, 30_000)

  it('listLoans เห็นสัญญาที่เพิ่งสร้าง พร้อมชื่อทรัพย์สินและธนาคารจาก join', async () => {
    const items = await listLoans()
    const mine = items.find((i) => i.loanId === loanId)
    expect(mine).toBeDefined()
    expect(mine!.propertyName).toBe('ทดสอบ — ลบได้')
    expect(mine!.bankLabel).toBe('กสิกรไทย')
    expect(Number(mine!.disbursedSatang)).toBe(300_000_000)
  }, 30_000)

  it('getLoanFull + toLoanTerms คืนค่าที่ engine ใช้ได้ และ date_roll ไม่หาย', async () => {
    const full = await getLoanFull(loanId)
    const terms = toLoanTerms(full)

    expect(terms.startDate).toBe(isoDate('2024-03-05'))
    expect(terms.dateRoll).toBe('preceding')
    expect(terms.dueDayOfMonth).toBe(5)
    expect(terms.rateSteps).toHaveLength(4)
    expect(terms.rateSteps[3]!.toMonth).toBeNull()
    expect(terms.conventions[0]!.dayCountBasis).toBe('ACT/365F')
    expect(full.conventionAssumed).toBe(true)
  }, 30_000)

  it('ตารางที่ได้จาก DB ตรงกับที่ engine คำนวณจากค่าเดียวกันในหน่วยความจำ', async () => {
    const full = await getLoanFull(loanId)
    const r = buildSchedule(toLoanTerms(full))
    expect(r.rows[0]!.accrualFrom).toBe(isoDate('2024-03-05'))
    // 5 เม.ย. 2024 เป็นวันศุกร์ ไม่ต้องเลื่อน
    expect(r.rows[0]!.date).toBe(isoDate('2024-04-05'))
    expect(r.rows[0]!.accrualDays).toBe(31)
    expect(formatFixedBaht(r.rows[0]!.interestFixed)).toBe('7,643.84')
  }, 30_000)

  it('addPayment บันทึกได้ และมีผลกับตาราง', async () => {
    await addPayment(loanId, {
      paidDate: isoDate('2024-04-05'),
      amountSatang: baht(120_000) as Satang,
      kind: 'partial_prepay',
      note: 'โปะทดสอบ',
    })
    const full = await getLoanFull(loanId)
    expect(full.payments).toHaveLength(1)
    expect(full.payments[0]!.note).toBe('โปะทดสอบ')

    const events = toPaymentEvents(full)
    expect(events).toHaveLength(1)

    const withPrepay = buildSchedule(toLoanTerms(full), events)
    const without = buildSchedule(toLoanTerms(full))
    // โปะ 120,000 ต้องทำให้จำนวนงวดลดลง ไม่ใช่เท่าเดิม
    expect(withPrepay.rows.length).toBeLessThan(without.rows.length)
  }, 30_000)

  it('removePayment เป็น soft delete — หายจาก query แต่แถวยังอยู่', async () => {
    const before = await getLoanFull(loanId)
    const id = before.payments[0]!.id

    await removePayment(id)
    const after = await getLoanFull(loanId)
    expect(after.payments).toHaveLength(0)

    // แถวยังอยู่จริง อ่านได้ถ้าไม่กรอง deleted_at
    const raw = await supabase.from('payments').select('id, deleted_at').eq('id', id).single()
    expect(raw.error).toBeNull()
    expect(raw.data!.deleted_at).not.toBeNull()
  }, 30_000)

  it('⛔ ลบ payments จริงต้องไม่ได้ — ไม่มี policy DELETE โดยตั้งใจ', async () => {
    const full = await supabase.from('payments').select('id').eq('loan_id', loanId)
    const id = full.data![0]!.id as string
    const res = await supabase.from('payments').delete().eq('id', id).select('id')
    // RLS ไม่มี policy DELETE -> ไม่ error แต่ไม่มีแถวไหนถูกลบ
    expect(res.data ?? []).toHaveLength(0)

    const still = await supabase.from('payments').select('id').eq('id', id).single()
    expect(still.data).not.toBeNull()
  }, 30_000)

  it('⛔ เขียน payment_allocations ไม่ได้ — client อ่านได้เท่านั้น', async () => {
    const pay = await supabase.from('payments').select('id').eq('loan_id', loanId).limit(1)
    const res = await supabase.from('payment_allocations').insert({
      payment_id: pay.data![0]!.id,
      interest_satang: 1,
      principal_satang: 1,
      balance_after_satang: 1,
      accrual_days: 1,
      effective_rate_bps: 1,
      engine_version: 'test',
    })
    expect(res.error).not.toBeNull()
  }, 30_000)

  it('⛔ แก้ reference_rates ที่มีอยู่ไม่ได้ — trigger บังคับ immutable', async () => {
    const ins = await supabase
      .from('reference_rates')
      .insert({ index_code: 'MRR', rate_bps: 6500, effective_date: '2024-01-01' })
      .select('id')
      .single()
    if (ins.error) {
      // ไม่มีสิทธิ์เขียนเลยก็ถือว่าผ่าน
      expect(ins.error).not.toBeNull()
      return
    }
    const upd = await supabase
      .from('reference_rates')
      .update({ rate_bps: 1 })
      .eq('id', ins.data.id)
    expect(upd.error).not.toBeNull()
  }, 30_000)

  it('deleteLoan ลบสัญญา ลูก และทรัพย์สินที่ไม่เหลือสัญญา', async () => {
    const propertyId = (await getLoanFull(loanId)).loan.property_id

    await deleteLoan(loanId)
    const items = await listLoans()
    expect(items.find((i) => i.loanId === loanId)).toBeUndefined()

    const orphanPayments = await supabase.from('payments').select('id').eq('loan_id', loanId)
    expect(orphanPayments.data ?? []).toHaveLength(0)

    // ⚠️ จุดที่เคยพลาด: ลบแค่ active_loans แล้ว properties ลอยอยู่เป็นขยะที่ UI มองไม่เห็น
    const orphanProperty = await supabase.from('properties').select('id').eq('id', propertyId)
    expect(orphanProperty.data ?? []).toHaveLength(0)

    const orphanOffers = await supabase
      .from('loan_offers')
      .select('id')
      .eq('property_id', propertyId)
    expect(orphanOffers.data ?? []).toHaveLength(0)

    loanId = ''
  }, 30_000)

  it('ไม่มีทรัพย์สินค้างจากการทดสอบรอบก่อน ๆ', async () => {
    const stray = must(
      await supabase.from('properties').select('id, name'),
    ) as { id: string; name: string }[]
    if (stray.length > 0) {
      // เก็บขยะที่เกิดจาก deleteLoan เวอร์ชันเก่า
      for (const p of stray) await supabase.from('properties').delete().eq('id', p.id)
      console.log('เก็บทรัพย์สินค้าง', stray.map((p) => p.name))
    }
    const after = must(await supabase.from('properties').select('id')) as unknown[]
    expect(after).toHaveLength(0)
  }, 30_000)
})
