import type { ISODate } from './date.js'
import type { Satang, Fixed, Bps, RoundingMode } from './money.js'
import type { DayCountBasis } from './accrual.js'

// ---------- อัตราดอกเบี้ย 2 ชั้น (spec ข้อ 1.3) ----------

/** ชั้นที่ 1 — สัญญา คงที่ตลอดอายุสัญญา */
export type RateStep = {
  /** งวดที่เริ่มใช้ 1-indexed */
  fromMonth: number
  /** งวดสุดท้ายที่ใช้ null = จนจบสัญญา */
  toMonth: number | null
} & (
  | { kind: 'fixed'; fixedRateBps: Bps }
  | { kind: 'index_minus' | 'index_plus'; indexCode: IndexCode; spreadBps: Bps }
)

export type IndexCode = 'MRR' | 'MLR' | 'MOR'

/** ชั้นที่ 2 — อัตราอ้างอิง เปลี่ยนตามประกาศธนาคาร เก็บเป็น time series */
export type ReferenceRate = {
  indexCode: IndexCode
  rateBps: Bps
  effectiveDate: ISODate
}

// ---------- วิธีนับวัน/ปัดเศษ — effective-dated เสมอ (spec ข้อ 1.1.1) ----------

export type LoanConvention = {
  effectiveFrom: ISODate
  dayCountBasis: DayCountBasis
  rounding: RoundingMode
  /** false = ดอกค้างแยกบัญชี ไม่ทบต้น (default) | true = ทบเข้าเงินต้น  ดูข้อ 1.2 */
  capitaliseUnpaidInterest: boolean
}

// ---------- วันครบกำหนด (spec ข้อ 1.4.1 / 1.4.3) ----------

export type DateRoll = 'none' | 'preceding' | 'following'
export type RollCalendar = 'weekend_only' | 'weekend_and_bank_holidays'

// ---------- สัญญา ----------

export type LoanTerms = {
  principalSatang: Satang
  /** วันเริ่มคิดดอกเบี้ยงวดแรก = first_accrual_date ผู้ใช้แก้ได้ (ข้อ 1.4.2) */
  startDate: ISODate
  termMonths: number
  dueDayOfMonth: number

  dateRoll: DateRoll
  rollCalendar: RollCalendar
  /** ฉีดเข้ามา engine ห้ามไปโหลดเอง */
  bankHolidays: readonly ISODate[]
  /** period index (1-indexed) -> วันตัดที่ผู้ใช้กำหนดเอง ชนะกฎอัตโนมัติเสมอ */
  scheduleOverrides: Readonly<Record<number, ISODate>>

  rateSteps: readonly RateStep[]
  referenceRates: readonly ReferenceRate[]
  /** เรียงตาม effectiveFrom แถวแรกต้องครอบ startDate */
  conventions: readonly LoanConvention[]

  /** ค่างวดตั้งต้น ใช้เมื่อไม่มี installmentSteps ครอบงวดนั้น */
  installmentSatang: Satang
  /**
   * ค่างวดที่ต่างกันตามช่วง เช่น โปรปี 1-3 ค่างวดหนึ่ง พ้นโปรอีกค่างวดหนึ่ง
   * ⚠️ ธนาคารไทยมักคิดค่างวดช่วงโปรต่ำกว่าช่วงลอยตัว ถ้าใช้ค่าเดียวทั้งสัญญา
   *    ตารางจะเพี้ยนตั้งแต่งวดที่พ้นโปรเป็นต้นไป
   * ว่างไว้ = ใช้ installmentSatang ตลอดสัญญา (สัญญาเก่าที่บันทึกไว้ก่อนมีฟีเจอร์นี้)
   */
  installmentSteps?: readonly InstallmentStep[]
  prepayMode: 'shorten_term' | 'reduce_installment'
}

/** ช่วงค่างวด ใช้โครงเดียวกับ RateStep เพื่อให้จับคู่กับช่วงอัตราได้ตรง ๆ */
export type InstallmentStep = {
  fromMonth: number
  /** null = จนจบสัญญา */
  toMonth: number | null
  amountSatang: Satang
}

// ---------- เหตุการณ์การจ่าย ----------

export type PaymentKind = 'installment' | 'partial_prepay' | 'full_redemption'

export type PaymentEvent = {
  date: ISODate
  amountSatang: Satang
  kind: PaymentKind
}

// ---------- ผลลัพธ์ ----------

export type RowFlag =
  /** งวดนี้ใช้ยอดที่บันทึกว่าจ่ายจริง ไม่ใช่ค่างวดตามสัญญา */
  | 'actual_payment'
  | 'negative_amortization'
  | 'below_minimum'
  | 'rate_changed'
  | 'prepay'
  | 'final_payment'
  | 'date_overridden'
  | 'convention_changed'

export type ScheduleRow = {
  index: number
  /** วันตัดยอดจริงของงวดนี้ = ปลายช่วง accrual แบบปลายเปิด */
  date: ISODate
  /** วันตัดตามกฎก่อนถูก override — ไว้แสดงใน UI ว่าอะไรถูกแก้ */
  nominalDate: ISODate
  accrualFrom: ISODate
  accrualDays: number
  /** อัตราถ่วงน้ำหนักของงวดนี้ ไม่ใช่ค่าเฉลี่ยเลขคณิต (ข้อ 3.5) */
  effectiveRateBps: number

  /** ยอดจ่ายรวมของงวดนี้ = ค่างวด + โปะ */
  paymentFixed: Fixed
  /** ส่วนที่เป็นการโปะ นับแยกเพื่อให้ UI แสดง "ค่างวด + โปะ = ยอดจ่าย" ได้ */
  prepayFixed: Fixed
  /** ดอกเบี้ยที่เกิดขึ้นจริงในงวดนี้ (accrued) — อาจมากกว่าที่จ่ายได้ถ้าติด negative am */
  interestFixed: Fixed
  /** ดอกเบี้ยส่วนที่จ่ายไปจริงในงวดนี้ ปกติเท่ากับ interestFixed */
  interestPaidFixed: Fixed
  principalFixed: Fixed
  /** ดอกค้างยกไปงวดหน้า — 0 เสมอถ้า capitaliseUnpaidInterest = true */
  accruedCarriedFixed: Fixed
  balanceAfterFixed: Fixed

  flags: RowFlag[]
}

export type ScheduleResult = {
  rows: ScheduleRow[]
  totalInterestFixed: Fixed
  totalPrincipalFixed: Fixed
  totalPaymentFixed: Fixed
  /**
   * ดอกเบี้ยที่ถูกทบเข้าเงินต้น — มากกว่า 0 เมื่อ capitaliseUnpaidInterest = true
   * และเคยมีงวดที่จ่ายไม่พอดอก UI ต้องแสดงเป็นคำเตือน ไม่ใช่ซ่อนไว้
   *
   * เป็นตัวที่ทำให้ Σ เงินต้น มากกว่าวงเงินตั้งต้น:
   *   Σ เงินต้น  = วงเงินตั้งต้น + totalCapitalisedFixed
   *   Σ ยอดจ่าย  = Σ ดอกเบี้ย + วงเงินตั้งต้น   (จริงเสมอทุกโหมด)
   */
  totalCapitalisedFixed: Fixed
  /** true = ปิดหนี้ครบ  false = ชนเพดานจำนวนงวดแล้วยังมีหนี้เหลือ */
  paidOff: boolean
}
