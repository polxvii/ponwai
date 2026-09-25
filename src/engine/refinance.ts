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
import { buildSchedule, pmt } from './schedule.js'
import { findRateStep, resolveRate } from './rates.js'
import type {
  LoanTerms, RateStep, ReferenceRate, LoanConvention, ScheduleRow, InstallmentStep,
} from './types.js'

export type RefinanceOptionKind = 'stay' | 'retention' | 'refinance'

export type RefinanceScenario = {
  kind: RefinanceOptionKind
  label: string
  /** อัตราหลังจากจุดนี้ */
  rateSteps: readonly RateStep[]
  /** ค่างวดที่จะใช้ต่อจากนี้ */
  installmentSatang: Satang
  /**
   * ค่างวดที่ต่างกันตามช่วงของใบเสนอ ว่าง = ใช้ installmentSatang ตลอด
   * ⛔ ต้องถูกตัดทิ้งทุกครั้งที่เราไปกำหนดค่างวดเอง (ดู isFeasibleAt)
   *    ไม่งั้นค่างวดที่เพิ่งคำนวณมาจะถูกแถวของช่วงทับ แล้วคำตอบไม่ตรงกับที่ถาม
   */
  installmentSteps?: readonly InstallmentStep[]
  /** จำนวนงวดที่เหลือตามสัญญาใหม่ — refinance มักยืดกลับเป็น 360 */
  termMonths: number
  /** ต้นทุนการย้าย รวมทุกอย่างแล้วสุทธิ (ดู movingCost) */
  movingCostSatang: Satang
  /** lock-in ของข้อเสนอนี้ ใช้ตรวจว่าคืนทุนทันไหม */
  lockinMonths: number
  /**
   * true = แอพเติมแถวนี้ให้เอง ผู้ใช้ไม่ได้กรอก
   * ต้องบอกใน UI ไม่งั้นผู้ใช้กรอก 2 ทาง แล้วเห็น 4 แถว โดยไม่รู้ว่าอีก 2 มาจากไหน
   */
  autoAdded?: boolean
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
  /**
   * false = ธนาคารไม่มีวันอนุมัติค่างวดนี้ ต้องตีตกให้ชัด ไม่ใช่โชว์เป็นทางเลือกหนึ่ง
   * เกิดได้ 2 แบบ ค่างวดต่ำกว่าดอกเบี้ย (หนี้โตขึ้น) หรือผ่อนไม่จบในเทอมที่ขอ
   */
  feasible: boolean
  infeasibleReason?: string
  /** แอพเติมแถวนี้ให้เอง ไม่ได้มาจากที่ผู้ใช้กรอก */
  autoAdded: boolean
  /**
   * ค่างวดขั้นต่ำที่ปิดหนี้ได้ภายในเทอมที่ขอ
   * feasible = true จะเท่ากับค่างวดที่กรอกมา เพราะพอจ่ายอยู่แล้ว
   */
  minInstallmentSatang: Satang
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
    ...(sc.installmentSteps && sc.installmentSteps.length > 0
      ? { installmentSteps: sc.installmentSteps }
      : {}),
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

    // ---- ตรวจว่าเป็นทางเลือกจริงไหม ----
    // ⛔ ห้ามปล่อยให้เคส negative amortization โผล่เป็นตัวเลขปกติ
    //    ตอนชนเพดานงวดมันจะได้ดอกเบี้ยหลักสิบล้านและกินสเกลกราฟทั้งใบ
    const negAmRow = r.rows.find((row) => row.flags.includes('negative_amortization'))
    const overrunsTerm = r.rows.length > sc.termMonths || !r.paidOff
    const infeasibleReason = negAmRow
      ? `ค่างวดต่ำกว่าดอกเบี้ยตั้งแต่งวดที่ ${negAmRow.index} — หนี้จะโตขึ้นแทนที่จะลด`
      : overrunsTerm
        ? `ผ่อน ${r.rows.length} งวด เกินสัญญา ${sc.termMonths} งวดที่ขอไว้`
        : undefined

    // หาค่าเฉพาะตอนจ่ายไม่ไหว — ต้องวน buildSchedule หลายรอบ ไม่ควรจ่ายราคานี้ทุกครั้ง
    const minInstallment =
      infeasibleReason === undefined
        ? sc.installmentSatang
        : minFeasibleInstallment(ctx, sc)

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
      costsMoreThanStaying: sc.kind !== 'stay' && saved < 0n && infeasibleReason === undefined,
      feasible: infeasibleReason === undefined,
      autoAdded: sc.autoAdded ?? false,
      ...(infeasibleReason ? { infeasibleReason } : {}),
      minInstallmentSatang: minInstallment,
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
  // จ่ายไม่ไหว = ไม่ใช่ทางเลือก ต้องตัดออกก่อนเลือก best เสมอ ไม่ใช่แค่จัดอันดับท้าย ๆ
  const possible = outcomes.filter((o) => o.feasible)
  const viable = possible.filter((o) => o.kind === 'stay' || !o.breakevenBeyondLockin)
  const pool = viable.length > 0 ? viable : possible.length > 0 ? possible : outcomes

  const best = pool.reduce((a, b) =>
    (b.futureInterestFixed + (b.movingCostSatang * 1_000_000_000_000n)) <
    (a.futureInterestFixed + (a.movingCostSatang * 1_000_000_000_000n)) ? b : a)

  const warnings: string[] = []
  for (const o of outcomes) {
    if (!o.feasible) {
      warnings.push(
        `"${o.label}" ${o.infeasibleReason} — ต้องจ่ายอย่างน้อย ${formatBaht(o.minInstallmentSatang)} บาทต่อเดือน`,
      )
      continue
    }
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

/** ตารางที่ได้เป็นทางเลือกจริงไหม — ไม่มีงวดที่ดอกกินค่างวดหมด และปิดหนี้ทันเทอม */
function isFeasibleAt(ctx: RefinanceContext, sc: RefinanceScenario, installment: Satang): boolean {
  // ⛔ ตัด installmentSteps ทิ้ง — คำถามคือ "จ่ายเท่านี้คงที่แล้วไหวไหม"
  //    ถ้าปล่อยแถวของช่วงไว้ ค่างวดที่ส่งเข้ามาจะถูกทับ แล้วได้คำตอบของโจทย์อื่น
  const { installmentSteps: _ignored, ...flat } = sc
  const r = buildSchedule(termsFor(ctx, { ...flat, installmentSatang: installment }))
  return (
    r.paidOff &&
    r.rows.length <= sc.termMonths &&
    !r.rows.some((row) => row.flags.includes('negative_amortization'))
  )
}

/**
 * ค่างวดขั้นต่ำที่ทำให้แผนนี้เป็นไปได้จริง
 *
 * ⛔ ห้ามใช้ PMT ที่อัตราของงวดแรก — ข้อเสนอรีไฟแนนซ์มีโปร 3 ปีเกือบทุกอัน
 *    ค่าที่ได้จะต่ำกว่าความจริงมาก แล้วพอพ้นโปรก็พังอยู่ดี
 *    ต้องหาด้วยการลองจริงบนตารางเต็ม เพราะดอกคิดรายวันและอัตราเปลี่ยนกลางทาง
 */
function minFeasibleInstallment(ctx: RefinanceContext, sc: RefinanceScenario): Satang {
  // ขอบบน = PMT ที่อัตราสูงสุดของสัญญา ซึ่งพอจ่ายแน่นอนเพราะอัตราจริงไม่เกินนี้
  let hi = pmt(ctx.balanceSatang, maxRateOf(ctx, sc), sc.termMonths)
  for (let guard = 0; guard < 8 && !isFeasibleAt(ctx, sc, hi); guard++) {
    hi = ((hi * 3n) / 2n) as Satang
  }
  if (!isFeasibleAt(ctx, sc, hi)) return hi

  let lo = 0n as Satang
  // หยุดที่ความละเอียด 1 บาท ละเอียดกว่านี้ไม่มีประโยชน์กับคนอ่าน
  while (hi - lo > 100n) {
    const mid = ((lo + hi) / 2n) as Satang
    if (isFeasibleAt(ctx, sc, mid)) hi = mid
    else lo = mid
  }
  // ปัดขึ้นเป็นบาทเต็ม จ่ายขาดไปหนึ่งสตางค์ก็ไม่ผ่าน
  return (((hi + 99n) / 100n) * 100n) as Satang
}

function maxRateOf(ctx: RefinanceContext, sc: RefinanceScenario): Bps {
  let max = 0
  for (let m = 1; m <= sc.termMonths; m += 12) {
    const rate = resolveRate(findRateStep(sc.rateSteps, m), ctx.referenceRates, ctx.asOf)
    if (rate > max) max = rate
  }
  return max as Bps
}

function formatBaht(v: Satang): string {
  return (Number(v) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
