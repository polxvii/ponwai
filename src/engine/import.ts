/**
 * Import สัญญาที่ผ่อนไปแล้ว (spec ข้อ 2A.5)
 *
 * จำเป็นสำหรับโหมดรีไฟแนนซ์ — คนที่จะมาใช้แอพส่วนใหญ่ผ่อนมาหลายปีแล้ว
 * ไม่ใช่คนที่เพิ่งเซ็นสัญญาวันนี้
 *
 *   Quick  ยอดคงเหลือ + วันที่ของยอดนั้น + ค่างวด + เรต + วันครบสัญญา
 *          ใช้เป็นจุดตั้งต้น ไม่มีประวัติย้อนหลัง
 *   Full   วันทำสัญญา + วงเงินเดิม + rate steps + รายการจ่ายย้อนหลัง
 *          ได้ประวัติครบ ใช้กระทบยอดได้
 */

import { type ISODate, addMonthsClamped, daysBetween, year as getYear } from './date.js'
import type { Satang, Bps } from './money.js'
import { buildSchedule } from './schedule.js'
import type {
  LoanTerms, RateStep, ReferenceRate, LoanConvention, PaymentEvent,
  DateRoll, RollCalendar, ScheduleRow, InstallmentStep,
} from './types.js'

export type ImportMode = 'quick' | 'full'

// ---------- Quick ----------

export type QuickImport = {
  mode: 'quick'
  /** ยอดหนี้คงเหลือตามใบแจ้งยอดล่าสุด */
  balanceSatang: Satang
  /** วันที่ของยอดนั้น — จะกลายเป็นจุดตั้งต้นของการคำนวณ */
  asOfDate: ISODate
  installmentSatang: Satang
  dueDayOfMonth: number
  /** เรตปัจจุบันและเรตในอนาคตตามสัญญา ถ้ารู้ */
  rateSteps: readonly RateStep[]
  /** วันครบสัญญาเดิม ใช้คำนวณจำนวนงวดที่เหลือ */
  originalMaturityDate: ISODate
}

// ---------- Full ----------

export type FullImport = {
  mode: 'full'
  contractDate: ISODate
  firstAccrualDate: ISODate
  originalAmountSatang: Satang
  termMonths: number
  dueDayOfMonth: number
  installmentSatang: Satang
  rateSteps: readonly RateStep[]
  /** รายการจ่ายย้อนหลังทั้งหมด */
  payments: readonly PaymentEvent[]
}

export type ImportInput = QuickImport | FullImport

export type ImportContext = {
  referenceRates: readonly ReferenceRate[]
  conventions: readonly LoanConvention[]
  dateRoll?: DateRoll
  rollCalendar?: RollCalendar
  bankHolidays?: readonly ISODate[]
}

// ---------- ข้อจำกัดที่ต้องบอกผู้ใช้ ----------

export type ImportLimitation = {
  code:
    | 'no_payment_history'
    | 'no_past_interest_total'
    | 'no_tax_deduction_history'
    | 'cannot_reconcile_past'
    | 'rate_history_assumed'
  message: string
}

/**
 * ข้อจำกัดของโหมด Quick — ต้องขึ้นใน UI ตั้งแต่ตอนเลือกโหมด ไม่ใช่ซ่อนไว้
 * spec ระบุชัดว่า Quick ต้อง flag ว่าดอกเบี้ยสะสมและสิทธิลดหย่อนย้อนหลังจะไม่มี
 */
export const QUICK_LIMITATIONS: readonly ImportLimitation[] = [
  {
    code: 'no_payment_history',
    message: 'ไม่มีประวัติการจ่ายก่อนวันที่ตั้งต้น ตารางผ่อนจะเริ่มนับจากยอดที่กรอกเท่านั้น',
  },
  {
    code: 'no_past_interest_total',
    message: 'ดอกเบี้ยที่จ่ายไปแล้วก่อนหน้านี้จะไม่ถูกนับรวมในยอดสะสม',
  },
  {
    code: 'no_tax_deduction_history',
    message: 'สิทธิลดหย่อนภาษีของปีที่ผ่านมาจะไม่แสดง เพราะไม่มีข้อมูลดอกเบี้ยรายปี',
  },
  {
    code: 'cannot_reconcile_past',
    message: 'กระทบยอดกับใบแจ้งยอดของงวดก่อนวันตั้งต้นไม่ได้',
  },
] as const

// ---------- ตรวจความถูกต้องก่อน import ----------

export type ImportProblem = { field: string; message: string }

export function validateImport(input: ImportInput): ImportProblem[] {
  const p: ImportProblem[] = []

  if (input.mode === 'quick') {
    if (input.balanceSatang <= 0n) {
      p.push({ field: 'balanceSatang', message: 'ยอดคงเหลือต้องมากกว่า 0' })
    }
    if (input.installmentSatang <= 0n) {
      p.push({ field: 'installmentSatang', message: 'ค่างวดต้องมากกว่า 0' })
    }
    if (input.originalMaturityDate <= input.asOfDate) {
      p.push({
        field: 'originalMaturityDate',
        message: 'วันครบสัญญาต้องอยู่หลังวันที่ของยอดคงเหลือ',
      })
    }
    if (input.rateSteps.length === 0) {
      p.push({ field: 'rateSteps', message: 'ต้องระบุอัตราดอกเบี้ยอย่างน้อย 1 ช่วง' })
    }
    if (input.dueDayOfMonth < 1 || input.dueDayOfMonth > 31) {
      p.push({ field: 'dueDayOfMonth', message: 'วันครบกำหนดต้องอยู่ระหว่าง 1-31' })
    }
  } else {
    if (input.originalAmountSatang <= 0n) {
      p.push({ field: 'originalAmountSatang', message: 'วงเงินกู้ต้องมากกว่า 0' })
    }
    if (input.firstAccrualDate < input.contractDate) {
      p.push({
        field: 'firstAccrualDate',
        message: 'วันเริ่มคิดดอกเบี้ยต้องไม่อยู่ก่อนวันทำสัญญา',
      })
    }
    if (input.termMonths <= 0) {
      p.push({ field: 'termMonths', message: 'จำนวนงวดต้องมากกว่า 0' })
    }
    const outOfOrder = input.payments.some(
      (x, i) => i > 0 && x.date < input.payments[i - 1]!.date,
    )
    if (outOfOrder) {
      p.push({ field: 'payments', message: 'รายการจ่ายต้องเรียงตามวันที่' })
    }
    const beforeStart = input.payments.filter((x) => x.date < input.firstAccrualDate)
    if (beforeStart.length > 0) {
      p.push({
        field: 'payments',
        message: `มีรายการจ่าย ${beforeStart.length} รายการที่อยู่ก่อนวันเริ่มคิดดอกเบี้ย`,
      })
    }
  }

  return p
}

// ---------- แปลงเป็น LoanTerms ----------

export type ImportResult = {
  mode: ImportMode
  terms: LoanTerms
  events: PaymentEvent[]
  limitations: readonly ImportLimitation[]
  /** จำนวนงวดที่เหลือตามที่คำนวณได้ */
  remainingMonths: number
  /** เฉพาะโหมด Full — ตารางย้อนหลังที่สร้างได้ */
  historicalRows: ScheduleRow[]
}

/** วันเริ่มคิดดอกเบี้ยของ import ชุดนี้ */
export function importStartDate(input: ImportInput): ISODate {
  return input.mode === 'quick' ? input.asOfDate : input.firstAccrualDate
}

/**
 * ตรวจว่า context เข้ากับ input ได้
 * แยกจาก validateImport เพราะต้องใช้ ctx ด้วย
 */
export function validateContext(input: ImportInput, ctx: ImportContext): ImportProblem[] {
  const p: ImportProblem[] = []
  const start = importStartDate(input)

  if (ctx.conventions.length === 0) {
    p.push({ field: 'conventions', message: 'ต้องมี LoanConvention อย่างน้อย 1 แถว' })
  } else if (!ctx.conventions.some((c) => c.effectiveFrom <= start)) {
    const earliest = [...ctx.conventions].sort((a, b) =>
      a.effectiveFrom < b.effectiveFrom ? -1 : 1)[0]!
    p.push({
      field: 'conventions',
      message:
        `แถวแรกของ LoanConvention ต้องมีผลไม่ช้ากว่าวันเริ่มคิดดอกเบี้ย (${start}) ` +
        `แต่แถวที่เร็วที่สุดคือ ${earliest.effectiveFrom}`,
    })
  }

  if (ctx.rollCalendar === 'weekend_and_bank_holidays' && (ctx.bankHolidays ?? []).length === 0) {
    p.push({
      field: 'bankHolidays',
      message: 'เลือกปฏิทินแบบรวมวันหยุดธนาคาร แต่ยังไม่ได้ส่งรายการวันหยุดมา',
    })
  }

  return p
}

export function buildFromImport(input: ImportInput, ctx: ImportContext): ImportResult {
  const problems = [...validateImport(input), ...validateContext(input, ctx)]
  if (problems.length > 0) {
    throw new Error(
      `import ไม่ผ่านการตรวจ:\n${problems.map((x) => `  - ${x.field}: ${x.message}`).join('\n')}`,
    )
  }

  const shared = {
    dateRoll: ctx.dateRoll ?? 'none',
    rollCalendar: ctx.rollCalendar ?? 'weekend_only',
    bankHolidays: ctx.bankHolidays ?? [],
    scheduleOverrides: {},
    referenceRates: ctx.referenceRates,
    conventions: ctx.conventions,
    prepayMode: 'shorten_term' as const,
  }

  if (input.mode === 'quick') {
    const remainingMonths = monthsBetween(input.asOfDate, input.originalMaturityDate)
    return {
      mode: 'quick',
      terms: {
        ...shared,
        principalSatang: input.balanceSatang,
        startDate: input.asOfDate,
        termMonths: remainingMonths,
        dueDayOfMonth: input.dueDayOfMonth,
        rateSteps: input.rateSteps,
        installmentSatang: input.installmentSatang,
      },
      events: [],
      limitations: QUICK_LIMITATIONS,
      remainingMonths,
      historicalRows: [],
    }
  }

  const terms: LoanTerms = {
    ...shared,
    principalSatang: input.originalAmountSatang,
    startDate: input.firstAccrualDate,
    termMonths: input.termMonths,
    dueDayOfMonth: input.dueDayOfMonth,
    rateSteps: input.rateSteps,
    installmentSatang: input.installmentSatang,
  }

  const { rows } = buildSchedule(terms, input.payments)
  const lastPaid = input.payments[input.payments.length - 1]
  const historicalRows = lastPaid ? rows.filter((r) => r.date <= lastPaid.date) : []

  return {
    mode: 'full',
    terms,
    events: [...input.payments],
    limitations: [],
    remainingMonths: input.termMonths - historicalRows.length,
    historicalRows,
  }
}

function monthsBetween(a: ISODate, b: ISODate): number {
  let n = 0
  const anchor = Number(a.slice(8, 10))
  while (addMonthsClamped(a, n + 1, anchor) <= b) n++
  // ถ้าเหลือเศษวันเกินครึ่งเดือน ให้ปัดขึ้นเป็นอีกหนึ่งงวด
  const covered = addMonthsClamped(a, n, anchor)
  if (daysBetween(covered, b) > 15) n++
  return Math.max(n, 1)
}

// ---------- สรุปให้ผู้ใช้ยืนยันก่อนบันทึก ----------

export type ImportPreview = {
  startDate: ISODate
  startBalanceSatang: Satang
  remainingMonths: number
  projectedPayoffDate: ISODate | null
  projectedTotalInterestSatang: Satang
  /** ปีภาษีที่มีข้อมูลครบ — โหมด Quick จะว่าง */
  taxYearsCovered: number[]
  limitations: readonly ImportLimitation[]
}

/** สร้างหน้าสรุปก่อนบันทึก ให้ผู้ใช้เห็นว่าจะได้อะไรและจะขาดอะไร */
export function previewImport(input: ImportInput, ctx: ImportContext): ImportPreview {
  const r = buildFromImport(input, ctx)
  const { rows, totalInterestFixed } = buildSchedule(r.terms, r.events)
  const last = rows[rows.length - 1]

  const years = new Set<number>()
  for (const row of r.mode === 'full' ? r.historicalRows : []) years.add(getYear(row.date))

  return {
    startDate: r.terms.startDate,
    startBalanceSatang: r.terms.principalSatang,
    remainingMonths: r.remainingMonths,
    projectedPayoffDate: last?.date ?? null,
    projectedTotalInterestSatang: (totalInterestFixed / 1_000_000_000_000n) as Satang,
    taxYearsCovered: [...years].sort((a, b) => a - b),
    limitations: r.limitations,
  }
}

/** ค่าตั้งต้นของ convention สำหรับสัญญาที่ import เข้ามา (ข้อ 1.1.1) */
export function defaultImportConvention(effectiveFrom: ISODate): LoanConvention {
  return {
    effectiveFrom,
    dayCountBasis: 'ACT/365F',
    rounding: 'round_satang',
    capitaliseUnpaidInterest: false,
  }
}

/** แปลง "ปีที่ N ดอกเบี้ย X%" ที่ผู้ใช้กรอกบนมือถือ เป็น RateStep (ข้อ 5A.3 วิธีที่ 2) */
export function rateStepsFromYearlyRates(
  yearlyRatesBps: readonly Bps[],
  floatingRateBps: Bps,
): RateStep[] {
  const steps: RateStep[] = yearlyRatesBps.map((rate, i) => ({
    fromMonth: i * 12 + 1,
    toMonth: (i + 1) * 12,
    kind: 'fixed' as const,
    fixedRateBps: rate,
  }))
  steps.push({
    fromMonth: yearlyRatesBps.length * 12 + 1,
    toMonth: null,
    kind: 'fixed',
    fixedRateBps: floatingRateBps,
  })
  return steps
}

/**
 * แปลง "ค่างวดปีที่ N" ที่ผู้ใช้กรอก เป็น InstallmentStep
 *
 * ⚠️ ขอบเขตเดือนต้องตรงกับ rateStepsFromYearlyRates เป๊ะ
 *    ใบเสนอของธนาคารเขียนเรตกับค่างวดคู่กันเป็นช่วงเดียวกันเสมอ
 *    ถ้าสองชุดนี้เหลื่อมกัน จะมีงวดที่ใช้เรตของปีใหม่แต่ค่างวดของปีเก่า
 *
 * null ในอาร์เรย์ = ช่วงนั้นใช้ค่างวดตั้งต้น ไม่ต้องสร้างแถว
 * คืน [] เมื่อไม่มีช่วงไหนกรอกเลย ซึ่งเป็นเคสปกติของสัญญาที่ค่างวดเท่ากันตลอด
 */
export function installmentStepsFromYearly(
  yearlyPaySatang: readonly (Satang | null)[],
  floatingPaySatang: Satang | null,
): InstallmentStep[] {
  const steps: InstallmentStep[] = []
  for (const [i, pay] of yearlyPaySatang.entries()) {
    if (pay === null) continue
    steps.push({ fromMonth: i * 12 + 1, toMonth: (i + 1) * 12, amountSatang: pay })
  }
  if (floatingPaySatang !== null) {
    steps.push({
      fromMonth: yearlyPaySatang.length * 12 + 1,
      toMonth: null,
      amountSatang: floatingPaySatang,
    })
  }
  return steps
}
