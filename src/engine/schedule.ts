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
  findInstallment, findRateStep, resolveRate, resolveConvention, changePointsWithin,
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
    ...(terms.firstDueDate !== undefined ? { firstDueDate: terms.firstDueDate } : {}),
    dueDayOfMonth: terms.dueDayOfMonth,
    dateRoll: terms.dateRoll,
    rollCalendar: terms.rollCalendar,
    bankHolidays: new Set(terms.bankHolidays),
    overrides: terms.scheduleOverrides,
  }

  const byDate = (a: PaymentEvent, b: PaymentEvent): number =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0

  const prepays = [...events].filter((e) => e.kind === 'partial_prepay').sort(byDate)
  let prepayCursor = 0

  /**
   * ยอดที่จ่ายจริงของงวด — แทนค่างวดตามสัญญาเฉพาะงวดที่บันทึกไว้
   *
   * ⚠️ จำเป็น ไม่ใช่ของแถม จุดเริ่มต้นของการติดตามสินเชื่อคือ "จ่ายจริงงวดละเท่าไหร่"
   *    ซึ่งไม่เท่าค่างวดตามสัญญาเสมอไป เช่น งวดแรกที่โปะก้อนใหญ่พร้อมกัน
   *    หรือเดือนที่จ่ายเกินไปนิดหน่อย
   * งวดที่ไม่ได้บันทึกยังใช้ค่างวดตามสัญญา เพื่อให้ประมาณการอนาคตทำงานต่อได้
   */
  const actuals = [...events].filter((e) => e.kind !== 'partial_prepay').sort(byDate)
  let actualCursor = 0

  /**
   * วันที่ของยอดจ่ายจริงรายการสุดท้าย — เส้นแบ่งระหว่าง "อดีตที่รู้แล้ว" กับ "อนาคตที่ต้องเดา"
   *
   * ⚠️ งวดที่อยู่ก่อนเส้นนี้แต่ไม่มีรายการ แปลว่าไม่ได้จ่ายจริง ไม่ใช่ยังไม่ได้บันทึก
   *    เคสจริง: งวดแรกกินเวลา 5 วัน ธนาคารไม่เรียกเก็บแยก ไปรวมกับงวดถัดไป
   *    ถ้าเติมค่างวดเต็มให้งวดนั้น ตารางจะตัดเงินต้นที่ไม่เคยถูกจ่าย ยอดคงเหลือเพี้ยนทั้งเส้น
   *
   * ⛔ ห้ามใช้ "วันนี้" เป็นเส้นแบ่ง — คนที่หยุดบันทึกไปครึ่งปี
   *    จะกลายเป็นค้างชำระ 6 งวดทันทีทั้งที่แค่ไม่ได้กรอก
   *    เส้นต้องเป็นสิ่งที่ผู้ใช้ยืนยันเอง คือรายการล่าสุดที่บันทึกไว้
   */
  const lastActualDate = actuals[actuals.length - 1]?.date ?? null

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
    // ---- accrue ตั้งแต่งวดก่อนถึงวันตัด โดยตัดช่วงทุกครั้งที่มีเงินเข้ากลางงวด ----
    const conv = resolveConvention(terms.conventions, due)

    let periodInterest = ZERO_FIXED   // ดอกทั้งงวด รวมส่วนที่ถูกตัดไปแล้วกลางงวด
    let unrounded = ZERO_FIXED        // ดอกที่ยังไม่ถูกปัด นับตั้งแต่จุดตัดชำระล่าสุด
    let prepayThisPeriod = ZERO_FIXED
    let earlyInterest = ZERO_FIXED    // ดอกที่ยอดจ่ายก่อนวันตัดชำระไปแล้ว
    let earlyPrincipal = ZERO_FIXED
    let earlyPayment = ZERO_FIXED
    let segFrom = from

    // ---- ยอดจ่ายจริงของงวดนี้ ถ้ามีบันทึกไว้ ----
    let recorded: Fixed | null = null
    let redeemed = false

    /**
     * เหตุการณ์กลางงวดเรียงตามวัน — โปะกับยอดจ่ายจริงต้องปนกันให้ถูกลำดับ
     * ไม่งั้นเงินต้นลดผิดจังหวะ แล้วดอกช่วงที่เหลือของงวดคลาดไปทั้งเส้น
     *
     * ⚠️ ยอดจ่ายจริงที่ลงก่อนวันตัดต้องตัดดอก ณ วันนั้นเลย ห้ามยกไปรวมที่วันตัด
     *    สลิปธนาคารยืนยัน: จ่ายค่างวด 37,000 วันที่ 3 แล้วโอนอีก 43,000 วันที่ 5
     *    ธนาคารคิด 29 วันบนยอดเต็ม + 2 วันบนยอดที่ลดแล้ว ไม่ใช่ 31 วันบนยอดเต็ม
     *    ต่างกัน 3.13 บาท = ดอก 2 วันของเงินต้นที่จ่ายไปตั้งแต่วันที่ 3 (TV-51)
     */
    const mid: Array<{ date: ISODate; amount: Fixed; prepay: boolean }> = []

    while (prepayCursor < prepays.length) {
      const ev = prepays[prepayCursor]!
      if (ev.date > due) break
      prepayCursor++
      // ⛔ เทียบกับ from ไม่ใช่ segFrom — โปะสองก้อนวันเดียวกันต้องนับครบทั้งคู่
      if (ev.date <= from) continue
      mid.push({ date: ev.date, amount: toFixed(ev.amountSatang), prepay: true })
    }

    while (actualCursor < actuals.length) {
      const ev = actuals[actualCursor]!
      if (ev.date > due) break
      actualCursor++
      if (ev.date <= from) continue
      // หลายรายการในงวดเดียวกันให้บวกรวม เช่น จ่ายค่างวดแล้วโอนเพิ่มทีหลัง
      recorded = add(recorded ?? ZERO_FIXED, toFixed(ev.amountSatang))
      // ⛔ ปิดบัญชีต้องตัดที่วันตัดตามเดิม ยอดปิดคิดจากดอกที่ครบงวดแล้วเท่านั้น
      if (ev.kind === 'full_redemption') redeemed = true
      else if (ev.date < due) {
        mid.push({ date: ev.date, amount: toFixed(ev.amountSatang), prepay: false })
      }
    }

    mid.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

    for (const ev of mid) {
      unrounded = add(unrounded, accrueSpan(terms, balance, segFrom, ev.date, step))
      segFrom = ev.date

      if (ev.prepay) {
        // การโปะตัดเงินต้นโดยตรงเต็มจำนวน ไม่หักดอกก่อน
        // นี่คือจุดที่ daily engine ให้ค่ามากกว่า monthly
        const applied = ev.amount > balance ? balance : ev.amount  // ห้ามตัดเกินหนี้ (TV-23)
        balance = sub(balance, applied)
        prepayThisPeriod = add(prepayThisPeriod, applied)
        if (!flags.includes('prepay')) flags.push('prepay')
        continue
      }

      // ยอดจ่ายจริงตัดดอกที่ค้างอยู่ ณ วันนั้นก่อน ที่เหลือจึงเข้าเงินต้น (ข้อ 1.2)
      const chunk = roundFixed(unrounded, conv.rounding)
      periodInterest = add(periodInterest, chunk)
      unrounded = ZERO_FIXED

      const owed = add(accruedCarried, chunk)
      const toInterest = ev.amount < owed ? ev.amount : owed
      const toPrincipal = sub(ev.amount, toInterest)
      const applied = toPrincipal > balance ? balance : toPrincipal
      balance = sub(balance, applied)
      accruedCarried = sub(owed, toInterest)
      earlyInterest = add(earlyInterest, toInterest)
      earlyPrincipal = add(earlyPrincipal, applied)
      earlyPayment = add(earlyPayment, ev.amount)
      if (!flags.includes('early_payment')) flags.push('early_payment')
    }

    unrounded = add(unrounded, accrueSpan(terms, balance, segFrom, due, step))

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

    // ---- ปัดเศษครั้งเดียวต่อหนึ่งจุดตัดชำระ (spec ข้อ 3.3) ----
    // งวดที่จ่ายก้อนเดียวตรงวันตัดจึงปัดครั้งเดียวเท่าเดิม ผลไม่เปลี่ยน
    const tail = roundFixed(unrounded, conv.rounding)
    periodInterest = add(periodInterest, tail)

    const rateNow = resolveRate(step, terms.referenceRates, due)
    if (prevRateBps !== null && rateNow !== prevRateBps) flags.push('rate_changed')
    if (prevBasis !== null && conv.dayCountBasis !== prevBasis) flags.push('convention_changed')
    prevRateBps = rateNow
    prevBasis = conv.dayCountBasis

    // ---- ตัดชำระ ณ วันตัด ----
    // ดอกที่ยังค้างจริง = ที่ยกมา + ช่วงท้ายงวด ส่วนที่ถูกตัดไปแล้วกลางงวดไม่นับซ้ำ
    const accruedTotal = add(accruedCarried, tail)

    const scheduled = findInstallment(terms.installmentSteps, period, terms.installmentSatang)
    const insideRecorded = lastActualDate !== null && due <= lastActualDate
    const payment = recorded ?? (insideRecorded ? ZERO_FIXED : toFixed(scheduled))
    if (recorded !== null) flags.push('actual_payment')
    else if (insideRecorded) flags.push('no_payment_recorded')

    // เงินที่เหลือให้ตัด ณ วันตัด — ส่วนที่จ่ายไปก่อนหน้าถูกใช้ไปแล้ว ห้ามนับซ้ำ
    let atDue = sub(payment, earlyPayment)
    if (atDue < 0n) atDue = ZERO_FIXED

    const payoff = add(balance, accruedTotal)
    if (redeemed) atDue = payoff
    if (atDue >= payoff) {
      atDue = payoff
      flags.push('final_payment')
      paidOff = true
    }

    const interestAtDue = atDue < accruedTotal ? atDue : accruedTotal
    const shortfall = sub(accruedTotal, interestAtDue)
    const principalAtDue = sub(atDue, interestAtDue)

    balance = sub(balance, principalAtDue)

    const paymentTotal = add(earlyPayment, atDue)
    const interestPaid = add(earlyInterest, interestAtDue)
    const principalPaid = add(earlyPrincipal, principalAtDue)

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
      paymentFixed: add(paymentTotal, prepayThisPeriod),
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
