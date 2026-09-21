/**
 * ตารางผ่อน — daily event loop (spec ข้อ 1.1)
 *
 * ไม่ใช่ monthly amortization แบบ closed-form เพราะ
 *   - จำนวนวันแต่ละงวดไม่เท่ากัน
 *   - อัตราเปลี่ยนกลางงวดได้
 *   - วิธีนับวันเปลี่ยนกลางสัญญาได้
 *   - โปะกลางงวดประหยัดดอกเบี้ยจริงตามจำนวนวันที่โปะเร็วขึ้น
 *
 * ลำดับการตัดชำระ (ข้อ 1.2): ดอกเบี้ยค้างรับสะสม -> ที่เหลือตัดเงินต้น
 * การโปะเข้าตัดเงินต้นโดยตรง ณ วันที่จ่ายจริง (ข้อ 1.5)
 */

import { type ISODate, daysBetween } from './date.js'
import {
  type Fixed, type Satang, toFixed, roundFixed, ZERO_FIXED,
} from './money.js'
import { accrueInterest } from './accrual.js'
import {
  findRateStep, resolveRate, resolveConvention, changePointsWithin,
} from './rates.js'
import { actualDueDate, nominalDueDate, type DateRuleConfig } from './schedule-dates.js'
import { resolvePrepayOn, type PrepayPlan } from './prepay.js'
import type {
  LoanTerms, PaymentEvent, ScheduleRow, ScheduleResult, RowFlag,
} from './types.js'

/** เพดานกันลูปไม่รู้จบ ไม่ใช่ข้อจำกัดของสัญญา — TV-17 (MRTA financed) ยืดไปถึง 385 งวด */
const MAX_PERIODS = 1200

export function buildSchedule(
  terms: LoanTerms,
  events: readonly PaymentEvent[] = [],
  prepayPlan?: PrepayPlan,
): ScheduleResult {
  const cfg: DateRuleConfig = {
    startDate: terms.startDate,
    dueDayOfMonth: terms.dueDayOfMonth,
    dateRoll: terms.dateRoll,
    rollCalendar: terms.rollCalendar,
    bankHolidays: new Set(terms.bankHolidays),
    overrides: terms.scheduleOverrides,
  }

  const prepays = [...events]
    .filter((e) => e.kind === 'partial_prepay')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  let prepayCursor = 0

  const rows: ScheduleRow[] = []
  let balance = toFixed(terms.principalSatang)
  let accruedCarried = ZERO_FIXED
  let from = terms.startDate
  let prevRateBps: number | null = null
  let prevBasis: string | null = null
  let paidOff = false
  let totalCapitalised = ZERO_FIXED

  for (let period = 1; period <= MAX_PERIODS; period++) {
    const nominal = nominalDueDate(cfg, period)
    const due = actualDueDate(cfg, period)
    if (due <= from) throw new Error(`งวด ${period}: วันตัด ${due} ไม่ได้อยู่หลัง ${from}`)

    const step = findRateStep(terms.rateSteps, period)
    const flags: RowFlag[] = []
    if (terms.scheduleOverrides[period] !== undefined) flags.push('date_overridden')

    // ---- accrue ตั้งแต่งวดก่อนถึงวันตัด โดยตัดช่วงที่การโปะกลางงวด ----
    let periodInterest = ZERO_FIXED
    let prepayThisPeriod = ZERO_FIXED
    let segFrom = from

    // งวดนี้ครอบคลุมการโปะในช่วง (from, due] — โปะที่ตรงวันตัดพอดีก็นับเป็นของงวดนี้
    // ดอกเบี้ยของงวดคิดจากเงินต้นก่อนโปะไปแล้ว การโปะจึงตัดต้นได้เต็มจำนวน
    while (prepayCursor < prepays.length) {
      const ev = prepays[prepayCursor]!
      if (ev.date > due) break
      if (ev.date <= segFrom) { prepayCursor++; continue }

      periodInterest = add(periodInterest, accrueSpan(terms, balance, segFrom, ev.date, step))
      // การโปะตัดเงินต้นโดยตรง ณ วันที่จ่ายจริง — นี่คือจุดที่ daily engine ให้ค่ามากกว่า monthly
      const amt = toFixed(ev.amountSatang)
      const applied = amt > balance ? balance : amt   // ห้ามตัดเกินหนี้ ห้ามคืนเงินทอน (TV-23)
      balance = sub(balance, applied)
      prepayThisPeriod = add(prepayThisPeriod, applied)
      flags.push('prepay')
      segFrom = ev.date
      prepayCursor++
    }

    periodInterest = add(periodInterest, accrueSpan(terms, balance, segFrom, due, step))

    // ---- ยอดโปะจากแผน (ข้อ 3.4) ตกที่วันตัดยอดเสมอ ----
    // ดอกเบี้ยของงวดคิดเสร็จแล้วจากเงินต้นก่อนโปะ การโปะจึงตัดต้นได้เต็ม
    if (prepayPlan) {
      const planned = toFixed(resolvePrepayOn(prepayPlan, due))
      if (planned > 0n) {
        const applied = planned > balance ? balance : planned
        if (applied > 0n) {
          balance = sub(balance, applied)
          prepayThisPeriod = add(prepayThisPeriod, applied)
          if (!flags.includes('prepay')) flags.push('prepay')
        }
      }
    }

    // ---- ปัดเศษครั้งเดียว ณ จุดตัดชำระ (spec ข้อ 3.3) ----
    const conv = resolveConvention(terms.conventions, due)
    periodInterest = roundFixed(periodInterest, conv.rounding)

    const rateNow = resolveRate(step, terms.referenceRates, due)
    if (prevRateBps !== null && rateNow !== prevRateBps) flags.push('rate_changed')
    if (prevBasis !== null && conv.dayCountBasis !== prevBasis) flags.push('convention_changed')
    prevRateBps = rateNow
    prevBasis = conv.dayCountBasis

    // ---- ตัดชำระ ----
    const accruedTotal = add(accruedCarried, periodInterest)
    let payment = toFixed(terms.installmentSatang)

    const payoff = add(balance, accruedTotal)
    if (payment >= payoff) {
      payment = payoff
      flags.push('final_payment')
      paidOff = true
    }

    const interestPaid = payment < accruedTotal ? payment : accruedTotal
    const shortfall = sub(accruedTotal, interestPaid)
    const principalPaid = sub(payment, interestPaid)

    balance = sub(balance, principalPaid)

    if (shortfall > 0n) {
      flags.push('negative_amortization')
      if (conv.capitaliseUnpaidInterest) {
        balance = add(balance, shortfall)
        totalCapitalised = add(totalCapitalised, shortfall)
        accruedCarried = ZERO_FIXED
      } else {
        accruedCarried = shortfall
      }
    } else {
      accruedCarried = ZERO_FIXED
    }

    const days = daysBetween(from, due)
    rows.push({
      index: period,
      date: due,
      nominalDate: nominal,
      accrualFrom: from,
      accrualDays: days,
      effectiveRateBps: effectiveRate(periodInterest, balance, principalPaid, prepayThisPeriod, days),
      paymentFixed: add(payment, prepayThisPeriod),
      prepayFixed: prepayThisPeriod,
      interestFixed: periodInterest,
      interestPaidFixed: interestPaid,
      principalFixed: add(principalPaid, prepayThisPeriod),
      accruedCarriedFixed: accruedCarried,
      balanceAfterFixed: balance,
      flags,
    })

    from = due
    if (balance <= 0n && accruedCarried <= 0n) { paidOff = true; break }
  }

  return {
    rows,
    totalInterestFixed: rows.reduce((a, r) => add(a, r.interestFixed), ZERO_FIXED),
    totalPrincipalFixed: rows.reduce((a, r) => add(a, r.principalFixed), ZERO_FIXED),
    totalPaymentFixed: rows.reduce((a, r) => add(a, r.paymentFixed), ZERO_FIXED),
    totalCapitalisedFixed: totalCapitalised,
    paidOff,
  }
}

/**
 * accrue ช่วง [a, b) โดยตัดช่วงทุกครั้งที่อัตราอ้างอิงหรือ convention เปลี่ยน
 * ส่วนการตัดที่ขอบปีปฏิทินของโหมด ACT/ACT อยู่ใน accrueInterest แล้ว
 */
function accrueSpan(
  terms: LoanTerms,
  balance: Fixed,
  a: ISODate,
  b: ISODate,
  step: ReturnType<typeof findRateStep>,
): Fixed {
  if (a >= b || balance <= 0n) return ZERO_FIXED
  const points = changePointsWithin(a, b, terms.referenceRates, terms.conventions, step)
  const bounds: ISODate[] = [a, ...points, b]
  let total = ZERO_FIXED
  for (let i = 0; i < bounds.length - 1; i++) {
    const s = bounds[i]!
    const e = bounds[i + 1]!
    if (s >= e) continue
    const rate = resolveRate(step, terms.referenceRates, s)
    const basis = resolveConvention(terms.conventions, s).dayCountBasis
    total = add(total, accrueInterest(balance, rate, s, e, basis))
  }
  return total
}

/**
 * อัตราที่จ่ายจริงของงวด ถ่วงน้ำหนักด้วยเงินต้นและจำนวนวัน (spec ข้อ 3.5)
 *   rate = ดอกเบี้ย ÷ (เงินต้นก่อนจ่าย × วัน ÷ 365)
 * ห้ามใช้ค่าเฉลี่ยเลขคณิตของอัตราเด็ดขาด
 */
function effectiveRate(
  interest: Fixed,
  balanceAfter: Fixed,
  principalPaid: Fixed,
  prepay: Fixed,
  days: number,
): number {
  const balanceBefore = balanceAfter + principalPaid + prepay
  if (balanceBefore <= 0n || days <= 0) return 0
  // คูณ 1e6 ก่อนหารเพื่อเก็บทศนิยมของ bps ไว้
  const scaled = (interest * 10_000n * 365n * 1_000_000n) / (balanceBefore * BigInt(days))
  return Number(scaled) / 1_000_000
}

function add(a: Fixed, b: Fixed): Fixed { return (a + b) as Fixed }
function sub(a: Fixed, b: Fixed): Fixed { return (a - b) as Fixed }

// ---------- PMT (spec ข้อ 1.4) ----------

/**
 * ค่างวดแบบ annuity — ใช้ "ประมาณค่างวดตั้งต้น" เท่านั้น
 * ⛔ ห้ามใช้สร้างตารางผ่อน ตารางจริงต้องมาจาก daily engine และจะไม่ตรงกับ PMT เป๊ะ
 * ใช้ float ได้เพราะเป็นค่าประมาณ ไม่ได้เข้าสมการเงินจริง
 */
export function pmt(principalSatang: Satang, annualRateBps: number, months: number): Satang {
  if (months <= 0) throw new Error('months ต้องมากกว่า 0')
  const p = Number(principalSatang)
  const i = annualRateBps / 10_000 / 12
  if (i === 0) return BigInt(Math.ceil(p / months)) as Satang
  const value = (p * i) / (1 - Math.pow(1 + i, -months))
  return BigInt(Math.round(value)) as Satang
}
