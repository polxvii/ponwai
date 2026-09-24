/**
 * State ของฟอร์มสร้างสัญญา — แปลงจากสิ่งที่ผู้ใช้กรอก เป็น NewLoanInput
 *
 * ค่าตั้งต้นทุกตัวที่เดาไม่ได้จริง ๆ ต้องติดธง assumed ไว้ใน DB (ข้อ 9.1)
 * ⛔ ห้ามทำเหมือนรู้แน่ว่าธนาคารใช้ ACT/365F หรือปัดตอนจบงวด
 *    จนกว่าจะเทียบกับใบแจ้งยอดจริงแล้ว
 */

import { baht, bps, type Satang } from '@engine/money.js'
import { isoDate, type ISODate } from '@engine/date.js'
import type { DateRoll, RollCalendar } from '@engine/types.js'
import type { DayCountBasis } from '@engine/accrual.js'
import type { RoundingMode } from '@engine/money.js'
import type { LoanFull, NewLoanInput } from '@/lib/db'
import type { RateStep } from '@engine/types.js'
import { BANK_PRESETS, OTHER_BANK, bankName } from '../compare/model'

export type LoanDraft = {
  propertyName: string
  bankCode: string
  customName: string

  contractDate: ISODate
  /** วันเบิกเงินกู้ = วันเริ่มคิดดอกงวดแรก แยกจากวันทำสัญญา (ข้อ 1.4.2) */
  firstAccrualDate: ISODate
  firstDueDate: ISODate
  dueDayOfMonth: number

  dateRoll: DateRoll
  rollCalendar: RollCalendar

  termYears: number
  disbursed: number | ''
  installment: number | ''
  prepayMode: 'shorten_term' | 'reduce_installment'

  promoRates: (number | '')[]
  floatingRate: number | ''
  /**
   * ค่างวดของแต่ละช่วง เว้นว่าง = ใช้ "ค่างวดตามสัญญา" ด้านบน
   * ธนาคารไทยมักคิดค่างวดช่วงโปรต่ำกว่าช่วงลอยตัว ถ้าบังคับใช้ค่าเดียว
   * ตารางจะเพี้ยนตั้งแต่งวดที่พ้นโปรเป็นต้นไป
   */
  promoInstallments: (number | '')[]
  floatingInstallment: number | ''

  dayCountBasis: DayCountBasis
  rounding: RoundingMode
  capitaliseUnpaidInterest: boolean
}

export function emptyLoanDraft(today: ISODate): LoanDraft {
  const day = Number(today.slice(8, 10))
  return {
    propertyName: '',
    bankCode: 'KBANK',
    customName: '',
    contractDate: today,
    firstAccrualDate: today,
    firstDueDate: today,
    dueDayOfMonth: day,
    dateRoll: 'none',
    rollCalendar: 'weekend_only',
    termYears: 30,
    disbursed: '',
    installment: '',
    prepayMode: 'shorten_term',
    promoRates: ['', '', ''],
    promoInstallments: ['', '', ''],
    floatingInstallment: '',
    floatingRate: '',
    dayCountBasis: 'ACT/365F',
    rounding: 'round_satang',
    capitaliseUnpaidInterest: false,
  }
}

export function loanBankName(d: LoanDraft): string {
  if (d.bankCode === OTHER_BANK) return d.customName.trim() || 'ธนาคารอื่น'
  return bankName(d.bankCode)
}

const num = (v: number | '' | undefined): number => (typeof v === 'number' ? v : 0)

/** ช่องที่ยังขาด — คืนข้อความว่าง = กรอกครบแล้ว */
export function validateDraft(d: LoanDraft): string[] {
  const errors: string[] = []
  if (d.propertyName.trim() === '') errors.push('ตั้งชื่อทรัพย์สิน เช่น "บ้านรังสิต"')
  if (d.bankCode === OTHER_BANK && d.customName.trim() === '') errors.push('กรอกชื่อธนาคาร')
  // ⚠️ bank_code เป็น FK ไปตาราง banks ค่าว่างจะพังที่ระดับ DB เป็นภาษาอังกฤษดิบ
  //    ต้องดักตั้งแต่ตรงนี้ ไม่ใช่รอให้ Postgres ปฏิเสธ
  if (d.bankCode === '') errors.push('เลือกธนาคาร')
  if (num(d.disbursed) <= 0) errors.push('กรอกวงเงินที่เบิกจริง')
  if (num(d.installment) <= 0) errors.push('กรอกค่างวดตามสัญญา')
  if (!d.promoRates.some((r) => typeof r === 'number')) errors.push('กรอกอัตราดอกเบี้ยปีที่ 1')
  if (num(d.floatingRate) <= 0) errors.push('กรอกอัตราหลังพ้นโปร')
  if (d.dueDayOfMonth < 1 || d.dueDayOfMonth > 31) errors.push('วันตัดรอบต้องอยู่ระหว่าง 1–31')
  if (d.firstAccrualDate < d.contractDate) {
    errors.push('วันเบิกเงินกู้ต้องไม่ก่อนวันทำสัญญา')
  }
  if (d.firstDueDate <= d.firstAccrualDate) {
    errors.push('วันตัดงวดแรกต้องหลังวันเบิกเงินกู้')
  }
  return errors
}

/** เว้นว่าง = ไม่กำหนดค่างวดเฉพาะช่วง ให้ตกไปใช้ค่างวดตั้งต้น */
const payOf = (v: number | '' | undefined): Satang | null =>
  typeof v === 'number' && v > 0 ? baht(Math.round(v * 100) / 100) : null

export function toNewLoanInput(d: LoanDraft): NewLoanInput {
  const promo = d.promoRates
    .filter((r): r is number => typeof r === 'number')
    .map((r) => bps(Math.round(r * 100)))

  return {
    propertyName: d.propertyName.trim(),
    bankCode: d.bankCode === OTHER_BANK ? null : d.bankCode,
    bankName: loanBankName(d),
    contractDate: d.contractDate,
    firstAccrualDate: d.firstAccrualDate,
    firstDueDate: d.firstDueDate,
    dueDayOfMonth: d.dueDayOfMonth,
    dateRoll: d.dateRoll,
    rollCalendar: d.rollCalendar,
    termMonths: d.termYears * 12,
    disbursedSatang: baht(Math.round(num(d.disbursed) * 100) / 100),
    installmentSatang: baht(Math.round(num(d.installment) * 100) / 100),
    prepayMode: d.prepayMode,
    promoRatesBps: promo,
    floatingRateBps: bps(Math.round(num(d.floatingRate) * 100)),
    // ส่งเฉพาะช่วงที่มีเรตจริง ให้ยาวตรงกับ promoRatesBps เสมอ
    promoInstallmentsSatang: d.promoRates
      .map((r, i) => (typeof r === 'number' ? payOf(d.promoInstallments[i]) : null))
      .filter((_, i) => typeof d.promoRates[i] === 'number'),
    floatingInstallmentSatang: payOf(d.floatingInstallment),
    dayCountBasis: d.dayCountBasis,
    rounding: d.rounding,
    capitaliseUnpaidInterest: d.capitaliseUnpaidInterest,
  }
}

/**
 * เติมฟอร์มจากสัญญาที่บันทึกไว้แล้ว — ทางกลับของ toNewLoanInput
 *
 * ⚠️ ขั้นอัตราเก็บเป็นช่วงเดือน (from_month/to_month) แต่ฟอร์มกรอกเป็น "ปีที่ 1/2/3"
 *    ต้องแปลงกลับโดยยึดว่าขั้นสุดท้ายที่ toMonth เป็น null คืออัตราลอยตัว
 *    ที่เหลือคือโปรรายปีเรียงตามลำดับ ซึ่งตรงกับที่ toNewLoanInput เขียนลงไป
 */
export function toLoanDraft(full: LoanFull): LoanDraft {
  const l = full.loan
  const known = BANK_PRESETS.some((b) => b.code === full.bankCode)
  const fixedBps = (st: RateStep): number =>
    st.kind === 'fixed' ? Number(st.fixedRateBps) / 100 : 0

  const floatingStep = full.rateSteps.find((st) => st.toMonth === null)
  const promo = full.rateSteps.filter((st) => st.toMonth !== null).map(fixedBps)
  // ฟอร์มมีช่องเรตโปร 3 ช่องเสมอ เติมช่องว่างให้ครบเพื่อไม่ให้ช่องหาย
  const promoRates: (number | '')[] = [0, 1, 2].map((i) => promo[i] ?? '')

  const conv = full.conventions[0]
  const payAt = (from: number): number | '' => {
    const hit = full.installmentSteps.find((st) => st.fromMonth === from)
    return hit ? Number(hit.amountSatang) / 100 : ''
  }

  return {
    propertyName: full.propertyName,
    bankCode: known && full.bankCode !== null ? full.bankCode : OTHER_BANK,
    customName: known ? '' : full.bankName,
    contractDate: isoDate(l.contract_date),
    firstAccrualDate: isoDate(l.first_accrual_date),
    firstDueDate: isoDate(l.first_due_date),
    dueDayOfMonth: l.due_day_of_month,
    dateRoll: l.date_roll,
    rollCalendar: l.roll_calendar,
    termYears: Math.round(l.term_months / 12),
    disbursed: l.disbursed_amount_satang / 100,
    installment: l.installment_satang / 100,
    prepayMode: l.prepay_mode,
    promoRates,
    promoInstallments: [0, 1, 2].map((i) => payAt(i * 12 + 1)),
    floatingInstallment: floatingStep ? payAt(floatingStep.fromMonth) : '',
    floatingRate: floatingStep ? fixedBps(floatingStep) : '',
    dayCountBasis: conv?.dayCountBasis ?? 'ACT/365F',
    rounding: conv?.rounding ?? 'round_satang',
    capitaliseUnpaidInterest: conv?.capitaliseUnpaidInterest ?? false,
  }
}

export const DAY_COUNT_OPTIONS: readonly { value: DayCountBasis; label: string }[] = [
  { value: 'ACT/365F', label: 'ACT/365F — หาร 365 ตลอด (พบมากที่สุด)' },
  { value: 'ACT/ACT', label: 'ACT/ACT — ปีอธิกสุรทินหาร 366' },
  { value: 'ACT/365_SKIP', label: 'ACT/365_SKIP — ข้าม 29 ก.พ.' },
]

export const ROUNDING_OPTIONS: readonly { value: RoundingMode; label: string }[] = [
  { value: 'round_satang', label: 'ปัดครึ่งขึ้นเป็นสตางค์' },
  { value: 'floor_satang', label: 'ตัดเศษเป็นสตางค์' },
  { value: 'floor_baht', label: 'ตัดเศษเป็นบาท' },
  { value: 'none', label: 'ไม่ปัด' },
]

export const DATE_ROLL_OPTIONS: readonly { value: DateRoll; label: string }[] = [
  { value: 'none', label: 'ตัดวันที่กำหนดเสมอ ไม่เลื่อน' },
  { value: 'preceding', label: 'ตรงวันหยุด ขยับมาเร็วขึ้น' },
  { value: 'following', label: 'ตรงวันหยุด เลื่อนออกไป' },
]

export const ROLL_CALENDAR_OPTIONS: readonly { value: RollCalendar; label: string }[] = [
  { value: 'weekend_only', label: 'เฉพาะเสาร์–อาทิตย์' },
  { value: 'weekend_and_bank_holidays', label: 'เสาร์–อาทิตย์ และวันหยุดธนาคาร' },
]

export function todayISO(): ISODate {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return isoDate(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)
}
