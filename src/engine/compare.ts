/**
 * Compare Mode — จัดอันดับข้อเสนอให้ถูก (spec ข้อ 2)
 *
 * เว็บเปรียบเทียบสินเชื่อไทยเกือบทั้งหมดจัดอันดับด้วย "ดอกเบี้ยเฉลี่ย 3 ปี" ซึ่งผิดเพราะ
 *   1. ไม่รวมค่าธรรมเนียมและ MRTA
 *   2. ไม่สนใจ spread หลังพ้นโปร ซึ่งกินเวลา 27 ปีจาก 30
 *   3. ค่างวดแต่ละธนาคารไม่เท่ากัน = เทียบ cash flow คนละชุด
 *
 * Equal-Payment Mode แก้ข้อ 3 โดยล็อกค่างวดให้เท่ากันทุกธนาคาร
 * แล้วถามว่า "จ่ายเท่ากันแล้ว ใครทำให้หนี้เหลือน้อยกว่า"
 */

import type { ISODate } from './date.js'
import {
  type Satang, type Bps, type Fixed, toFixed, ZERO_FIXED,
} from './money.js'
import { buildSchedule, pmt } from './schedule.js'
import { findRateStep, resolveRate } from './rates.js'
import {
  computeFees, fireInsuranceSchedule, buildCostCashflows, totalNonInterestCost,
  type OfferFee, type RecurringInsurance, type CreditLifeInsurance, type FeeTotals,
  type CashOutflow,
} from './fees.js'
import { xirrBps, type DatedFlow } from './xirr.js'
import type {
  LoanTerms, RateStep, ReferenceRate, LoanConvention, DateRoll, RollCalendar, ScheduleRow,
} from './types.js'

export type LoanOffer = {
  bankCode: string
  productName?: string
  /** วงเงินฐาน ยังไม่รวมของที่ financed */
  loanAmountSatang: Satang
  termMonths: number
  startDate: ISODate
  dueDayOfMonth: number

  rateSteps: readonly RateStep[]
  referenceRates: readonly ReferenceRate[]
  conventions: readonly LoanConvention[]

  /** ค่างวดจากใบเสนอ */
  installmentQuotedSatang: Satang

  fees: readonly OfferFee[]
  fireInsurance?: RecurringInsurance
  creditLife?: CreditLifeInsurance

  lockinMonths: number
  prepayPenaltyBps: Bps

  dateRoll?: DateRoll
  rollCalendar?: RollCalendar
  bankHolidays?: readonly ISODate[]
}

export type OfferMetrics = {
  bankCode: string
  feasible: boolean
  infeasibleReason?: string

  /** ค่างวดที่ใช้จริงในการจำลอง — เท่ากับค่างวดที่ล็อก ถ้าอยู่ในโหมด equal-payment */
  installmentUsedSatang: Satang
  /** วงเงินจริงหลังรวมของที่ financed */
  effectivePrincipalSatang: Satang

  /** metric จัดอันดับหลัก (ข้อ 2.2) */
  netPositionFixed: Fixed
  /** เดือนที่ใช้วัด Net Position */
  horizonMonths: number

  interestPaidToHorizonFixed: Fixed
  balanceAtHorizonFixed: Fixed

  /** ทดสอบว่าจ่ายไหวไหม */
  minInstallmentMonth1Satang: Satang
  /** shock test — ตัวเลขที่คนมักไม่ดู (ข้อ 2.3) */
  minInstallmentAfterPromoSatang: Satang
  /** งวดแรกที่พ้นช่วงโปร */
  firstPostPromoMonth: number

  eirBps: number | null

  totalInterestFixed: Fixed
  totalPeriods: number
  /** ต้นทุนที่ไม่ใช่ดอกเบี้ย ตลอดอายุสัญญา */
  nonInterestCostSatang: Satang

  fees: FeeTotals
  fireSchedule: CashOutflow[]
  rows: ScheduleRow[]
}

export type EvaluateOptions = {
  /** ล็อกค่างวดให้เท่ากันทุกธนาคาร (ข้อ 2.2) */
  equalPaymentSatang?: Satang
  /** เดือนที่ใช้วัด Net Position — default 36 ตามอายุโปรทั่วไป */
  horizonMonths?: number
}

function toTerms(offer: LoanOffer, principal: Satang, installment: Satang): LoanTerms {
  return {
    principalSatang: principal,
    startDate: offer.startDate,
    termMonths: offer.termMonths,
    dueDayOfMonth: offer.dueDayOfMonth,
    dateRoll: offer.dateRoll ?? 'none',
    rollCalendar: offer.rollCalendar ?? 'weekend_only',
    bankHolidays: offer.bankHolidays ?? [],
    scheduleOverrides: {},
    rateSteps: offer.rateSteps,
    referenceRates: offer.referenceRates,
    conventions: offer.conventions,
    installmentSatang: installment,
    prepayMode: 'shorten_term',
  }
}

/** งวดแรกที่พ้นช่วงโปร = งวดถัดจาก toMonth ของ step แรกที่ไม่ใช่ null */
export function firstPostPromoMonth(steps: readonly RateStep[]): number {
  let last = 1
  for (const s of steps) {
    if (s.toMonth === null) return last
    last = s.toMonth + 1
  }
  return last
}

export function evaluateOffer(offer: LoanOffer, opts: EvaluateOptions = {}): OfferMetrics {
  const horizon = opts.horizonMonths ?? 36
  const feeTotals = computeFees(offer.fees, offer.loanAmountSatang)

  // ของที่ financed ถูกรวมเข้าวงเงิน จึงอยู่ในเงินต้นตั้งแต่ต้น
  const financedCreditLife = offer.creditLife?.financed ? offer.creditLife.premiumSatang : 0n
  const effectivePrincipal = (offer.loanAmountSatang + feeTotals.financedSatang + financedCreditLife) as Satang

  const installment = opts.equalPaymentSatang ?? offer.installmentQuotedSatang
  const terms = toTerms(offer, effectivePrincipal, installment)

  const fireSchedule = offer.fireInsurance
    ? fireInsuranceSchedule(offer.fireInsurance, offer.startDate, offer.termMonths)
    : []

  const result = buildSchedule(terms)
  const rows = result.rows
  const toHorizon = rows.slice(0, horizon)
  const atHorizon = toHorizon[toHorizon.length - 1]

  const interestToHorizon = toHorizon.reduce((a, r) => (a + r.interestFixed) as Fixed, ZERO_FIXED)
  const balanceAtHorizon = atHorizon?.balanceAfterFixed ?? toFixed(effectivePrincipal)

  // ---- feasibility: ค่างวดที่ล็อกต่ำกว่าดอกเบี้ยงวดไหน = จ่ายไม่ไหว ต้อง mark ไม่ใช่ซ่อน ----
  const negAmRow = rows.find((r) => r.flags.includes('negative_amortization'))
  const feasible = negAmRow === undefined
  const infeasibleReason = negAmRow
    ? `ค่างวดต่ำกว่าดอกเบี้ยตั้งแต่งวดที่ ${negAmRow.index} — หนี้จะโตขึ้นแทนที่จะลด`
    : undefined

  // ---- Net Position @ horizon (ข้อ 2.2) ----
  // ⛔ บวกเฉพาะเงินสดที่จ่ายจริง ห้ามบวกของที่ is_financed = true ซ้ำ เพราะอยู่ในเงินต้นแล้ว
  const cashOutToHorizon = [
    ...(feeTotals.payableCashSatang > 0n ? [feeTotals.payableCashSatang] : []),
    ...(offer.creditLife && !offer.creditLife.financed ? [offer.creditLife.premiumSatang] : []),
    ...fireSchedule.filter((x) => x.contractYear <= Math.ceil(horizon / 12)).map((x) => x.amountSatang),
  ].reduce((a, b) => a + b, 0n)

  const netPosition = (balanceAtHorizon + toFixed(cashOutToHorizon as Satang)) as Fixed

  // ---- ค่างวดขั้นต่ำ ณ งวดที่กำหนด = PMT ที่อัตราของงวดนั้น บนเงินต้นคงเหลือและงวดที่เหลือ ----
  const postPromo = firstPostPromoMonth(offer.rateSteps)
  const minMonth1 = minInstallmentAt(offer, effectivePrincipal, 1, rows)
  const minPostPromo = minInstallmentAt(offer, effectivePrincipal, postPromo, rows)

  // ---- EIR: XIRR บนกระแสเงินสดจริง (ข้อ 2.3) ----
  const costFlows = buildCostCashflows(
    { fees: feeTotals, fireSchedule, ...(offer.creditLife ? { creditLife: offer.creditLife } : {}) },
    offer.startDate,
  )
  const eirBps = computeEir(offer, rows, costFlows, horizon)

  return {
    bankCode: offer.bankCode,
    feasible,
    ...(infeasibleReason ? { infeasibleReason } : {}),
    installmentUsedSatang: installment,
    effectivePrincipalSatang: effectivePrincipal,
    netPositionFixed: netPosition,
    horizonMonths: horizon,
    interestPaidToHorizonFixed: interestToHorizon,
    balanceAtHorizonFixed: balanceAtHorizon,
    minInstallmentMonth1Satang: minMonth1,
    minInstallmentAfterPromoSatang: minPostPromo,
    firstPostPromoMonth: postPromo,
    eirBps,
    totalInterestFixed: result.totalInterestFixed,
    totalPeriods: rows.length,
    nonInterestCostSatang: totalNonInterestCost(costFlows),
    fees: feeTotals,
    fireSchedule,
    rows,
  }
}

/**
 * ค่างวดขั้นต่ำที่ควรจ่าย ณ งวดที่ N
 * = PMT บนเงินต้นคงเหลือก่อนงวดนั้น ที่อัตราของงวดนั้น ตามจำนวนงวดที่เหลือ
 * ใช้เป็น shock test เท่านั้น ตารางจริงยังต้องมาจาก daily engine
 */
function minInstallmentAt(
  offer: LoanOffer,
  principal: Satang,
  month: number,
  rows: readonly ScheduleRow[],
): Satang {
  const prev = rows[month - 2]
  const balance = prev ? (prev.balanceAfterFixed / 1_000_000_000_000n) as Satang : principal
  const step = findRateStep(offer.rateSteps, month)
  const anchor = rows[month - 1]?.date ?? offer.startDate
  const rate = resolveRate(step, offer.referenceRates, anchor)
  const remaining = offer.termMonths - month + 1
  if (remaining <= 0 || balance <= 0n) return 0n as Satang
  return pmt(balance, rate, remaining)
}

function computeEir(
  offer: LoanOffer,
  rows: readonly ScheduleRow[],
  costFlows: readonly CashOutflow[],
  horizon: number,
): number | null {
  const window = rows.slice(0, horizon)
  if (window.length === 0) return null

  const flows: DatedFlow[] = [
    // t0: ได้เงินกู้มา (วงเงินฐาน ไม่รวมของ financed เพราะนั่นคือของที่ซื้อ ไม่ใช่เงินที่ได้ใช้)
    { date: offer.startDate, amount: Number(offer.loanAmountSatang) / 100 },
  ]
  for (const r of window) {
    flows.push({ date: r.date, amount: -Number(r.paymentFixed / 1_000_000_000_000n) / 100 })
  }
  // จ่ายคืนเงินต้นคงเหลือ ณ สิ้นช่วงที่เทียบ
  const last = window[window.length - 1]!
  flows.push({ date: last.date, amount: -Number(last.balanceAfterFixed / 1_000_000_000_000n) / 100 })
  // ค่าธรรมเนียมและเบี้ยประกัน เข้าที่เวลาจริงของมันเอง
  for (const c of costFlows) {
    if (c.date <= last.date) flows.push({ date: c.date, amount: -Number(c.amountSatang) / 100 })
  }

  return xirrBps(flows)
}

// ---------- จัดอันดับ ----------

export type RankedOffer = OfferMetrics & { rank: number }

/**
 * เรียงตาม Net Position จากน้อยไปมาก — ต่ำสุดชนะ
 * ข้อเสนอที่ infeasible ไปอยู่ท้ายเสมอ แต่ต้อง "แสดง" ไม่ใช่ซ่อน (ข้อ 2.2)
 */
export function rankOffers(offers: readonly LoanOffer[], opts: EvaluateOptions = {}): RankedOffer[] {
  const evaluated = offers.map((o) => evaluateOffer(o, opts))
  return evaluated
    .sort((a, b) => {
      if (a.feasible !== b.feasible) return a.feasible ? -1 : 1
      return a.netPositionFixed < b.netPositionFixed ? -1 : a.netPositionFixed > b.netPositionFixed ? 1 : 0
    })
    .map((m, i) => ({ ...m, rank: i + 1 }))
}

/**
 * Sensitivity ต่อ MRR (ข้อ 2.4) — รัน scenario แล้วดูว่าอันดับพลิกที่ไหน
 * ถ้าอันดับ 1-2 สลับกันเมื่อ MRR ขยับ ต้องบอกผู้ใช้ตรง ๆ ห้ามซ่อนใต้ตัวเลขเดียว
 */
export function sensitivityBand(
  offers: readonly LoanOffer[],
  deltasBps: readonly number[],
  opts: EvaluateOptions = {},
): { deltaBps: number; ranked: RankedOffer[] }[] {
  return deltasBps.map((deltaBps) => ({
    deltaBps,
    ranked: rankOffers(
      offers.map((o) => ({
        ...o,
        referenceRates: o.referenceRates.map((r) => ({ ...r, rateBps: (r.rateBps + deltaBps) as Bps })),
      })),
      opts,
    ),
  }))
}

/** อันดับพลิกไหมเมื่อ MRR ขยับ — คืนรายการ delta ที่ผู้ชนะเปลี่ยน */
export function findRankFlips(
  bands: readonly { deltaBps: number; ranked: RankedOffer[] }[],
): { deltaBps: number; from: string; to: string }[] {
  const flips: { deltaBps: number; from: string; to: string }[] = []
  for (let i = 1; i < bands.length; i++) {
    const prev = bands[i - 1]!.ranked[0]
    const cur = bands[i]!.ranked[0]
    if (prev && cur && prev.bankCode !== cur.bankCode) {
      flips.push({ deltaBps: bands[i]!.deltaBps, from: prev.bankCode, to: cur.bankCode })
    }
  }
  return flips
}
