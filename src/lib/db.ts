/**
 * ชั้นเข้าถึงข้อมูลใน Supabase (schema ponwai)
 *
 * ⚠️ ตอนอ่าน RLS กรองด้วย auth.uid() ให้แล้ว — ⛔ ห้ามใส่ .eq('user_id', ...) เองซ้ำ
 *
 * ⚠️ ตอนเขียนกลับกัน ต้องส่ง user_id ไปเองเสมอ
 *    `with check (user_id = auth.uid())` เป็นการ "ตรวจ" ไม่ใช่ "เติม"
 *    ถ้าไม่ส่งไป ค่าจะเป็น null แล้วโดนปฏิเสธด้วย 42501 ซึ่งอ่านเหมือนเรื่องสิทธิ์
 *    ทั้งที่ต้นเหตุคือลืมใส่ค่า
 *
 * ⚠️ bigint ของ Postgres กลับมาเป็น number ของ JS ผ่าน PostgREST
 *    ปลอดภัยเพราะ 2^53 สตางค์ = 9 หมื่นล้านล้านบาท แต่ต้องแปลงเป็น BigInt
 *    ก่อนส่งเข้า engine เสมอ ห้ามปล่อยให้ number หลุดเข้าไป
 */

import { supabase } from './supabase'
import { isoDate, type ISODate } from '@engine/date.js'
import { bps, type Bps, type Satang } from '@engine/money.js'
import type {
  DateRoll, RollCalendar,
  LoanConvention, LoanTerms, PaymentEvent, PaymentKind, RateStep,
} from '@engine/types.js'
import type { DayCountBasis } from '@engine/accrual.js'
import type { RoundingMode } from '@engine/money.js'

const sat = (n: number | null | undefined): Satang => BigInt(Math.round(n ?? 0)) as Satang

/** อ่านจาก session ในเครื่อง ไม่ยิงเน็ต — ใช้เติม user_id ตอน insert */
async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('ต้องเข้าสู่ระบบก่อนบันทึกข้อมูล')
  return id
}

/** โยน error ที่อ่านรู้เรื่อง แทนที่จะปล่อย object ดิบของ PostgREST ขึ้นไปถึง UI */
function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new Error(translateDbError(res.error))
  if (res.data === null) throw new Error('ไม่พบข้อมูล')
  return res.data
}

function translateDbError(e: { message: string; code?: string }): string {
  if (e.code === '42501') return 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้ — ลองเข้าสู่ระบบใหม่'
  if (e.code === 'PGRST301' || e.message.includes('JWT')) return 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่'
  if (e.code === '23505') return 'ข้อมูลนี้มีอยู่แล้ว'
  return e.message
}

// ---------- รายการสัญญา ----------

export type LoanListItem = {
  loanId: string
  propertyId: string
  propertyName: string
  bankLabel: string
  contractDate: ISODate
  firstDueDate: ISODate
  termMonths: number
  disbursedSatang: Satang
  installmentSatang: Satang
  status: 'active' | 'closed'
  origin: 'new_purchase' | 'refinance' | 'retention'
}

type LoanRow = {
  id: string
  property_id: string
  contract_date: string
  first_accrual_date: string
  first_due_date: string
  due_day_of_month: number
  date_roll: DateRoll
  roll_calendar: RollCalendar
  term_months: number
  disbursed_amount_satang: number
  installment_satang: number
  prepay_mode: 'shorten_term' | 'reduce_installment'
  status: 'active' | 'closed'
  origin: 'new_purchase' | 'refinance' | 'retention'
  offer_id: string | null
}

type NestedProperty = { id: string; name: string } | null
type NestedOffer = { bank_code: string | null; bank_name: string | null } | null

export async function listLoans(): Promise<LoanListItem[]> {
  const rows = must(
    await supabase
      .from('active_loans')
      .select(
        'id, property_id, contract_date, first_due_date, term_months, disbursed_amount_satang,' +
          ' installment_satang, status, origin,' +
          ' properties(id, name), loan_offers(bank_code, bank_name)',
      )
      .order('contract_date', { ascending: false }),
  ) as unknown as (Partial<LoanRow> & { properties: NestedProperty; loan_offers: NestedOffer })[]

  return rows.map((r) => ({
    loanId: r.id!,
    propertyId: r.property_id!,
    propertyName: r.properties?.name ?? 'ไม่มีชื่อ',
    bankLabel: r.loan_offers?.bank_name ?? r.loan_offers?.bank_code ?? '—',
    contractDate: isoDate(r.contract_date!),
    firstDueDate: isoDate(r.first_due_date!),
    termMonths: r.term_months!,
    disbursedSatang: sat(r.disbursed_amount_satang),
    installmentSatang: sat(r.installment_satang),
    status: r.status!,
    origin: r.origin!,
  }))
}

// ---------- สร้างสัญญา ----------

export type NewLoanInput = {
  propertyName: string
  bankCode: string | null
  bankName: string
  contractDate: ISODate
  /** ⚠️ ไม่ใช่ contract_date — เป็นสาเหตุอันดับหนึ่งที่งวดแรกกระทบยอดไม่ตรง (ข้อ 1.4.2) */
  firstAccrualDate: ISODate
  firstDueDate: ISODate
  dueDayOfMonth: number
  dateRoll: DateRoll
  rollCalendar: RollCalendar
  termMonths: number
  disbursedSatang: Satang
  installmentSatang: Satang
  prepayMode: 'shorten_term' | 'reduce_installment'
  /** อัตราช่วงโปรเป็นรายปี ตามด้วยอัตราลอยตัว */
  promoRatesBps: readonly number[]
  floatingRateBps: number
  dayCountBasis: DayCountBasis
  rounding: RoundingMode
  capitaliseUnpaidInterest: boolean
}

/**
 * สร้างทรัพย์สิน + ข้อเสนอ + สัญญา + ขั้นอัตรา + convention
 *
 * PostgREST ไม่มี transaction ข้าม request ถ้าพังกลางทางจะเหลือขยะ
 * จึงลบ property ทิ้งเมื่อพัง — foreign key เป็น on delete cascade ลูกหายตามหมด
 */
export async function createLoan(input: NewLoanInput): Promise<string> {
  const property = must(
    await supabase
      .from('properties')
      // user_id ต้องส่งไปเอง ดูหมายเหตุหัวไฟล์
      .insert({ user_id: await currentUserId(), name: input.propertyName })
      .select('id')
      .single(),
  ) as { id: string }

  try {
    const offer = must(
      await supabase
        .from('loan_offers')
        .insert({
          property_id: property.id,
          bank_code: input.bankCode,
          bank_name: input.bankName,
          loan_amount_satang: Number(input.disbursedSatang),
          term_months: input.termMonths,
          installment_quoted_satang: Number(input.installmentSatang),
        })
        .select('id')
        .single(),
    ) as { id: string }

    const loan = must(
      await supabase
        .from('active_loans')
        .insert({
          property_id: property.id,
          offer_id: offer.id,
          contract_date: input.contractDate,
          first_accrual_date: input.firstAccrualDate,
          first_due_date: input.firstDueDate,
          due_day_of_month: input.dueDayOfMonth,
          date_roll: input.dateRoll,
          roll_calendar: input.rollCalendar,
          term_months: input.termMonths,
          disbursed_amount_satang: Number(input.disbursedSatang),
          installment_satang: Number(input.installmentSatang),
          prepay_mode: input.prepayMode,
          import_mode: 'quick',
        })
        .select('id')
        .single(),
    ) as { id: string }

    const steps = input.promoRatesBps.map((rate, i) => ({
      loan_id: loan.id,
      from_month: i * 12 + 1,
      to_month: (i + 1) * 12,
      kind: 'fixed',
      fixed_rate_bps: rate,
    }))
    steps.push({
      loan_id: loan.id,
      from_month: input.promoRatesBps.length * 12 + 1,
      to_month: null as unknown as number,
      kind: 'fixed',
      fixed_rate_bps: input.floatingRateBps,
    })
    must(await supabase.from('loan_rate_steps').insert(steps).select('id'))

    must(
      await supabase
        .from('loan_conventions')
        .insert({
          loan_id: loan.id,
          effective_from: input.firstAccrualDate,
          day_count_basis: input.dayCountBasis,
          interest_rounding: input.rounding,
          capitalise_unpaid_interest: input.capitaliseUnpaidInterest,
          // ยังไม่มีใบแจ้งยอดมายืนยัน ต้องติดธงไว้ให้ UI เตือน ไม่ใช่ทำเป็นว่ารู้แน่
          source: 'assumed',
          confidence: 'assumed',
        })
        .select('id'),
    )

    return loan.id
  } catch (e) {
    await supabase.from('properties').delete().eq('id', property.id)
    throw e
  }
}

/**
 * ลบสัญญา แล้วเก็บทรัพย์สินที่ไม่มีสัญญาเหลืออยู่ทิ้งด้วย
 *
 * ⚠️ ลบแค่ active_loans จะเหลือ properties กับ loan_offers ลอยอยู่เป็นขยะ
 *    ที่ UI มองไม่เห็น เพราะรายการสัญญา query จาก active_loans
 *    ทรัพย์สินหนึ่งมีได้หลายสัญญา (โซ่รีไฟแนนซ์) จึงลบเฉพาะตอนไม่เหลือสัญญาแล้ว
 */
export async function deleteLoan(loanId: string): Promise<void> {
  const target = await supabase
    .from('active_loans')
    .select('property_id')
    .eq('id', loanId)
    .single()
  if (target.error) throw new Error(translateDbError(target.error))
  const propertyId = (target.data as { property_id: string }).property_id

  const res = await supabase.from('active_loans').delete().eq('id', loanId)
  if (res.error) throw new Error(translateDbError(res.error))

  const left = await supabase
    .from('active_loans')
    .select('id')
    .eq('property_id', propertyId)
    .limit(1)
  if (left.error) throw new Error(translateDbError(left.error))
  if ((left.data ?? []).length === 0) {
    // cascade เก็บ loan_offers ให้เอง
    const drop = await supabase.from('properties').delete().eq('id', propertyId)
    if (drop.error) throw new Error(translateDbError(drop.error))
  }
}

// ---------- อ่านสัญญาเต็ม ----------

export type LoanFull = {
  loan: LoanRow
  rateSteps: RateStep[]
  conventions: LoanConvention[]
  /** true = ยังไม่มีใบแจ้งยอดมายืนยันวิธีคิดดอก UI ต้องเตือน ไม่ใช่เงียบ (ข้อ 9.1) */
  conventionAssumed: boolean
  scheduleOverrides: Record<number, ISODate>
  payments: StoredPayment[]
  bankHolidays: ISODate[]
}

export type StoredPayment = {
  id: string
  paidDate: ISODate
  amountSatang: Satang
  kind: PaymentKind | 'fee'
  note: string | null
}

export async function getLoanFull(loanId: string): Promise<LoanFull> {
  const loan = must(
    await supabase.from('active_loans').select('*').eq('id', loanId).single(),
  ) as LoanRow

  const [stepRows, convRows, overrideRows, paymentRows] = await Promise.all([
    supabase.from('loan_rate_steps').select('*').eq('loan_id', loanId).order('from_month'),
    supabase.from('loan_conventions').select('*').eq('loan_id', loanId).order('effective_from'),
    supabase.from('loan_schedule_overrides').select('*').eq('loan_id', loanId),
    supabase
      .from('payments')
      .select('id, paid_date, amount_satang, kind, note')
      .eq('loan_id', loanId)
      .is('deleted_at', null)
      .order('paid_date'),
  ])

  // ดึงวันหยุดเฉพาะตอนที่กฎเลื่อนวันตัดใช้มันจริง ไม่งั้นเสียรอบ query เปล่า
  const holidays =
    loan.roll_calendar === 'weekend_and_bank_holidays'
      ? must(await supabase.from('bank_holidays').select('holiday_date'))
      : []

  const rateSteps = (must(stepRows) as {
    from_month: number
    to_month: number | null
    kind: 'fixed' | 'index_minus' | 'index_plus'
    fixed_rate_bps: number | null
    index_code: 'MRR' | 'MLR' | 'MOR' | null
    spread_bps: number | null
  }[]).map((s): RateStep =>
    s.kind === 'fixed'
      ? {
          fromMonth: s.from_month,
          toMonth: s.to_month,
          kind: 'fixed',
          fixedRateBps: bps(s.fixed_rate_bps ?? 0),
        }
      : {
          fromMonth: s.from_month,
          toMonth: s.to_month,
          kind: s.kind,
          indexCode: s.index_code ?? 'MRR',
          spreadBps: bps(s.spread_bps ?? 0),
        },
  )

  const convData = must(convRows) as {
    effective_from: string
    day_count_basis: DayCountBasis
    interest_rounding: RoundingMode
    capitalise_unpaid_interest: boolean
    confidence: 'confirmed' | 'assumed'
  }[]

  const conventions = convData.map((c): LoanConvention => ({
    effectiveFrom: isoDate(c.effective_from),
    dayCountBasis: c.day_count_basis,
    rounding: c.interest_rounding,
    capitaliseUnpaidInterest: c.capitalise_unpaid_interest,
  }))

  const scheduleOverrides: Record<number, ISODate> = {}
  for (const o of must(overrideRows) as { period_index: number; due_date: string }[]) {
    scheduleOverrides[o.period_index] = isoDate(o.due_date)
  }

  const payments = (must(paymentRows) as {
    id: string
    paid_date: string
    amount_satang: number
    kind: PaymentKind | 'fee'
    note: string | null
  }[]).map((p): StoredPayment => ({
    id: p.id,
    paidDate: isoDate(p.paid_date),
    amountSatang: sat(p.amount_satang),
    kind: p.kind,
    note: p.note,
  }))

  return {
    loan,
    rateSteps,
    conventions,
    conventionAssumed: convData.some((c) => c.confidence === 'assumed'),
    scheduleOverrides,
    payments,
    bankHolidays: (holidays as { holiday_date: string }[]).map((h) => isoDate(h.holiday_date)),
  }
}

/**
 * โหลดทุกสัญญาแบบเต็ม — Dashboard ต้องรวมทุกหลัง (ข้อ 11 ข้อ 2)
 * และเพดานลดหย่อนภาษีต้องคิดข้ามสัญญา ซึ่งทำไม่ได้ถ้าโหลดมาทีละอัน (ข้อ 1.9)
 */
export async function getAllLoansFull(): Promise<{ item: LoanListItem; full: LoanFull }[]> {
  const items = await listLoans()
  const fulls = await Promise.all(items.map((i) => getLoanFull(i.loanId)))
  return items.map((item, i) => ({ item, full: fulls[i]! }))
}

/** แปลงเป็นสิ่งที่ engine รับ — ที่เดียวที่รู้จักทั้งรูปแบบ DB และรูปแบบ engine */
export function toLoanTerms(f: LoanFull): LoanTerms {
  return {
    principalSatang: sat(f.loan.disbursed_amount_satang),
    // ⛔ ไม่ใช่ contract_date — engine เริ่มคิดดอกจากวันเบิกเงินกู้ (ข้อ 1.4.2)
    startDate: isoDate(f.loan.first_accrual_date),
    termMonths: f.loan.term_months,
    dueDayOfMonth: f.loan.due_day_of_month,
    dateRoll: f.loan.date_roll,
    rollCalendar: f.loan.roll_calendar,
    bankHolidays: f.bankHolidays,
    scheduleOverrides: f.scheduleOverrides,
    rateSteps: f.rateSteps,
    referenceRates: [],
    conventions: f.conventions,
    installmentSatang: sat(f.loan.installment_satang),
    prepayMode: f.loan.prepay_mode,
  }
}

/** ค่าธรรมเนียมไม่ใช่เหตุการณ์ชำระหนี้ ต้องไม่ถูกนับเป็นการโปะ */
export function toPaymentEvents(f: LoanFull): PaymentEvent[] {
  return f.payments
    .filter((p): p is StoredPayment & { kind: PaymentKind } => p.kind !== 'fee')
    .map((p) => ({ date: p.paidDate, amountSatang: p.amountSatang, kind: p.kind }))
}

// ---------- การจ่าย ----------

export async function addPayment(
  loanId: string,
  p: { paidDate: ISODate; amountSatang: Satang; kind: PaymentKind | 'fee'; note?: string },
): Promise<void> {
  const res = await supabase.from('payments').insert({
    // payments.id ไม่มี default โดยตั้งใจ — client ต้องสร้างเอง
    // ทำให้กดซ้ำ/ส่งซ้ำแล้วไม่เกิดแถวซ้ำ เพราะ id เดิมชน primary key
    id: crypto.randomUUID(),
    loan_id: loanId,
    paid_date: p.paidDate,
    amount_satang: Number(p.amountSatang),
    kind: p.kind,
    note: p.note ?? null,
  })
  if (res.error) throw new Error(translateDbError(res.error))
}

/** ⛔ ห้ามลบจริง — ไม่มี policy DELETE บน payments โดยตั้งใจ ประวัติการจ่ายต้องตามรอยได้ */
export async function removePayment(paymentId: string): Promise<void> {
  const res = await supabase
    .from('payments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', paymentId)
  if (res.error) throw new Error(translateDbError(res.error))
}

export { bps as toBps, type Bps }
