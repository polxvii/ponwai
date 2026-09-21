/**
 * Refinance Mode — เทียบ 3 ทางเสมอ (spec ข้อ 2A)
 *
 * ไม่ใช่ feature ย่อย แต่เป็นโหมดหลักเท่ากับ Compare
 * เพราะผู้ใช้จะกลับมาใช้ทุก 3 ปีตลอดอายุสัญญา
 *
 * กับดักที่ต้องเตือน: ธนาคารขายว่า "ค่างวดลดลง 2,500 บาท/เดือน"
 * แต่การยืดเทอมกลับไป 30 ปีอาจทำให้จ่ายดอกเบี้ยรวม "มากกว่า" การไม่ทำอะไรเลย
 */

import type { ISODate } from './date.js'
import { type Satang, type Bps, type Fixed, ZERO_FIXED } from './money.js'
import { buildSchedule } from './schedule.js'
import type { LoanTerms, RateStep, ReferenceRate, LoanConvention, ScheduleRow } from './types.js'

export type RefinanceOptionKind = 'stay' | 'retention' | 'refinance'

export type RefinanceScenario = {
  kind: RefinanceOptionKind
  label: string
  /** อัตราหลังจากจุดนี้ */
  rateSteps: readonly RateStep[]
  /** ค่างวดที่จะใช้ต่อจากนี้ */
  installmentSatang: Satang
  /** จำนวนงวดที่เหลือตามสัญญาใหม่ — refinance มักยืดกลับเป็น 360 */
  termMonths: number
  /** ต้นทุนการย้าย รวมทุกอย่างแล้วสุทธิ (ดู movingCost) */
  movingCostSatang: Satang
  /** lock-in ของข้อเสนอนี้ ใช้ตรวจว่าคืนทุนทันไหม */
  lockinMonths: number
}

export type MovingCostInput = {
  /** ค่าปรับไถ่ถอน ถ้ายังไม่พ้น lock-in เดิม */
  prepayPenaltySatang: Satang
  /** ค่าจดจำนอง + อากรแสตมป์ + ประเมิน + ค่าธรรมเนียมอื่น ที่จ่ายสด */
  newFeesCashSatang: Satang
  /** เบี้ย MRTA ใหม่ ถ้าทำและจ่ายสด */
  newCreditLifeSatang: Satang
  /** เบี้ยประกันอัคคีภัยใหม่ ถ้าไม่ฟรี */
  newFireInsuranceSatang: Satang
  /** ของแถมที่ต้องคืนให้ธนาคารเดิม เพราะปิดก่อนกำหนด */
  clawbackSatang: Satang
  /** เงินเวนคืน MRTA เดิม — เป็น cash inflow ลดต้นทุนการย้ายลงตรง ๆ (ข้อ 1.8) */
  surrenderRefundSatang: Satang
  /** ของแถมเงินสดจากธนาคารใหม่ */
  newIncentiveSatang: Satang
}

/** ต้นทุนการย้ายสุทธิ (ข้อ 2A.3) — ติดลบได้ถ้าของแถมกับเงินเวนคืนมากกว่าค่าใช้จ่าย */
export function movingCost(x: MovingCostInput): Satang {
  return (
    x.prepayPenaltySatang +
    x.newFeesCashSatang +
    x.newCreditLifeSatang +
    x.newFireInsuranceSatang +
    x.clawbackSatang -
    x.surrenderRefundSatang -
    x.newIncentiveSatang
  ) as Satang
}

export type RefinanceContext = {
  /** ยอดหนี้คงเหลือ ณ วันที่พิจารณา */
  balanceSatang: Satang
  asOf: ISODate
  dueDayOfMonth: number
  referenceRates: readonly ReferenceRate[]
  conventions: readonly LoanConvention[]
}

export type RefinanceOutcome = {
  kind: RefinanceOptionKind
  label: string
  installmentSatang: Satang
  movingCostSatang: Satang
  /** ดอกเบี้ยที่จะจ่ายต่อจากนี้จนปิดหนี้ */
  futureInterestFixed: Fixed
  remainingPeriods: number
  payoffDate: ISODate
  /** ดอกเบี้ยที่ประหยัดได้เทียบกับ baseline (อยู่เฉย ๆ) — ติดลบ = แพงกว่า */
  interestSavedVsStayFixed: Fixed
  /** เดือนที่คืนทุน นับจาก asOf — null = ไม่มีวันคืนทุน */
  breakevenMonth: number | null
  /** คืนทุนช้ากว่า lock-in ของข้อเสนอนี้ = พอถึงจุดคุ้มก็ต้องรีไฟแนนซ์รอบใหม่อยู่ดี */
  breakevenBeyondLockin: boolean
  /** ⚠️ ถูกกว่าต่อเดือน แต่จ่ายดอกเบี้ยรวมมากกว่าการไม่ทำอะไรเลย */
  costsMoreThanStaying: boolean
  rows: ScheduleRow[]
}

function termsFor(ctx: RefinanceContext, sc: RefinanceScenario): LoanTerms {
  return {
    principalSatang: ctx.balanceSatang,
    startDate: ctx.asOf,
    termMonths: sc.termMonths,
    dueDayOfMonth: ctx.dueDayOfMonth,
    dateRoll: 'none',
    rollCalendar: 'weekend_only',
    bankHolidays: [],
    scheduleOverrides: {},
    rateSteps: sc.rateSteps,
    referenceRates: ctx.referenceRates,
    conventions: ctx.conventions,
    installmentSatang: sc.installmentSatang,
    prepayMode: 'shorten_term',
  }
}

/**
 * เทียบทุกทางเลือกพร้อมกัน — "อยู่เฉย ๆ" ต้องมีเสมอ ห้ามตัดออก (ข้อ 2A.1)
 * เพราะเป็น baseline เดียวที่บอกได้ว่าการย้ายคุ้มจริงไหม
 */
export function compareRefinanceOptions(
  ctx: RefinanceContext,
  scenarios: readonly RefinanceScenario[],
): RefinanceOutcome[] {
  const stay = scenarios.find((s) => s.kind === 'stay')
  if (!stay) throw new Error('ต้องมี scenario kind="stay" เป็น baseline เสมอ (ข้อ 2A.1)')

  const stayResult = buildSchedule(termsFor(ctx, stay))
  const stayCumulative = cumulativeInterest(stayResult.rows)

  return scenarios.map((sc) => {
    const r = buildSchedule(termsFor(ctx, sc))
    const saved = (stayResult.totalInterestFixed - r.totalInterestFixed) as Fixed
    const cumulative = cumulativeInterest(r.rows)

    // เดือนคืนทุน = เดือนแรกที่ดอกเบี้ยที่ประหยัดสะสม > ต้นทุนการย้าย
    // ต้องเทียบบนค่างวดเท่ากันเท่านั้น ไม่งั้นได้เลขหลอก (ข้อ 2A.3)
    let breakevenMonth: number | null = null
    const costFixed = (sc.movingCostSatang * 1_000_000_000_000n) as Fixed
    if (sc.kind === 'stay') {
      breakevenMonth = 0
    } else if (costFixed <= 0n) {
      breakevenMonth = 1
    } else {
      const n = Math.min(cumulative.length, stayCumulative.length)
      for (let i = 0; i < n; i++) {
        if ((stayCumulative[i]! - cumulative[i]!) > costFixed) { breakevenMonth = i + 1; break }
      }
    }

    const last = r.rows[r.rows.length - 1]
    return {
      kind: sc.kind,
      label: sc.label,
      installmentSatang: sc.installmentSatang,
      movingCostSatang: sc.movingCostSatang,
      futureInterestFixed: r.totalInterestFixed,
      remainingPeriods: r.rows.length,
      payoffDate: last?.date ?? ctx.asOf,
      interestSavedVsStayFixed: saved,
      breakevenMonth,
      breakevenBeyondLockin: breakevenMonth === null || breakevenMonth > sc.lockinMonths,
      // ⚠️ กับดักยืดเทอม: ค่างวดถูกลงแต่จ่ายดอกรวมมากกว่าไม่ทำอะไร (ข้อ 2A.2)
      costsMoreThanStaying: sc.kind !== 'stay' && saved < 0n,
      rows: r.rows,
    }
  })
}

function cumulativeInterest(rows: readonly ScheduleRow[]): Fixed[] {
  const out: Fixed[] = []
  let acc = ZERO_FIXED
  for (const r of rows) {
    acc = (acc + r.interestFixed) as Fixed
    out.push(acc)
  }
  return out
}

/**
 * คำตอบตรง ๆ ว่าควรทำอะไร (ข้อ 2A.3)
 *
 * Rule: ถ้าเดือนคืนทุน > lock-in ของข้อเสนอใหม่ ให้ตอบว่า "ไม่คุ้ม" ตรง ๆ
 * เพราะพอถึงจุดคุ้มทุนก็ต้องรีไฟแนนซ์รอบใหม่อยู่ดี
 */
export function recommend(outcomes: readonly RefinanceOutcome[]): {
  best: RefinanceOutcome
  warnings: string[]
} {
  const viable = outcomes.filter((o) => o.kind === 'stay' || !o.breakevenBeyondLockin)
  const pool = viable.length > 0 ? viable : outcomes

  const best = pool.reduce((a, b) =>
    (b.futureInterestFixed + (b.movingCostSatang * 1_000_000_000_000n)) <
    (a.futureInterestFixed + (a.movingCostSatang * 1_000_000_000_000n)) ? b : a)

  const warnings: string[] = []
  for (const o of outcomes) {
    if (o.costsMoreThanStaying) {
      warnings.push(
        `"${o.label}" ค่างวดถูกลงก็จริง แต่จ่ายดอกเบี้ยรวมมากกว่าการไม่ทำอะไรเลย`,
      )
    }
    if (o.kind !== 'stay' && o.breakevenBeyondLockin) {
      warnings.push(
        o.breakevenMonth === null
          ? `"${o.label}" ไม่มีวันคืนทุน`
          : `"${o.label}" คืนทุนเดือนที่ ${o.breakevenMonth} ซึ่งเลย lock-in ไปแล้ว — พอถึงจุดคุ้มก็ต้องรีไฟแนนซ์รอบใหม่อยู่ดี`,
      )
    }
  }
  return { best, warnings }
}

/** ค่าปรับไถ่ถอนก่อนกำหนด — เก็บตอนไถ่ถอน/ย้ายธนาคารเท่านั้น ไม่ใช่ตอนโปะบางส่วน (ข้อ 1.6) */
export function prepayPenalty(
  balanceSatang: Satang,
  penaltyBps: Bps,
  monthsElapsed: number,
  lockinMonths: number,
): Satang {
  if (monthsElapsed >= lockinMonths) return 0n as Satang
  return ((balanceSatang * BigInt(penaltyBps)) / 10_000n) as Satang
}
