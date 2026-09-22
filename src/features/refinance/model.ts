/**
 * State ของหน้า Refinance — แปลงสิ่งที่ผู้ใช้กรอก เป็น scenario ที่ engine รับได้
 *
 * กฎเหล็กของโหมดนี้ (ข้อ 2A.1): ต้องมี "อยู่เฉย ๆ" เป็น baseline เสมอ
 * ถ้าไม่มี จะไม่มีทางรู้ว่าการย้ายคุ้มจริงไหม
 */

import { baht, bps, type Satang } from '@engine/money.js'
import { isoDate, type ISODate } from '@engine/date.js'
import { rateStepsFromYearlyRates, defaultImportConvention } from '@engine/import.js'
import {
  movingCost, prepayPenalty,
  type RefinanceContext, type RefinanceScenario,
} from '@engine/refinance.js'
import type { RateStep } from '@engine/types.js'
import { mergeShape } from '@/lib/persist'
import { OTHER_BANK, bankName } from '../compare/model'

/** ชื่อที่จะโชว์ในตาราง — ผู้ให้กู้ที่ไม่อยู่ในรายการให้พิมพ์เอง */
export function refiBankName(r: RefiDraft): string {
  if (r.bankCode === OTHER_BANK) return r.customName.trim() || 'ธนาคารอื่น'
  return bankName(r.bankCode)
}

/** สภาพหนี้ปัจจุบัน — ตัวเลขทั้งหมดเป็นบาท */
export type CurrentLoan = {
  balance: number | ''
  asOf: ISODate
  dueDayOfMonth: number
  installment: number | ''
  /** เรตที่จ่ายอยู่ตอนนี้ (หลังพ้นโปรแล้ว) เป็น % */
  currentRate: number | ''
  /** งวดที่เหลือตามสัญญาเดิม */
  remainingMonths: number
  /** lock-in เดิมเหลืออีกกี่เดือน — 0 = พ้นแล้ว ไถ่ถอนได้ฟรี */
  lockinLeftMonths: number
  /** ค่าปรับไถ่ถอนก่อนกำหนด เป็น % ของยอดคงเหลือ */
  penaltyPct: number | ''
}

/** ข้อเสนอ retention จากธนาคารเดิม — ไม่ต้องย้าย ไม่ต้องจดจำนองใหม่ */
export type RetentionDraft = {
  enabled: boolean
  promoRates: (number | '')[]
  floatingRate: number | ''
  /** ค่าดำเนินการ retention ปกติหลักพัน บางแห่งฟรี */
  fee: number | ''
}

/** ข้อเสนอจากธนาคารใหม่ */
export type RefiDraft = {
  bankCode: string
  /** ใช้เมื่อ bankCode = OTHER_BANK เท่านั้น */
  customName: string
  promoRates: (number | '')[]
  floatingRate: number | ''
  /** ค่างวดตามใบเสนอของธนาคารใหม่ */
  installment: number | ''
  /** เทอมใหม่ เป็นปี — มักถูกยืดกลับไป 30 ปี ซึ่งเป็นกับดัก (ข้อ 2A.2) */
  termYears: number
  lockinMonths: number

  /* ---- ต้นทุนการย้าย (ข้อ 2A.3) ---- */
  mortgageFeePct: number | ''
  stampDuty: boolean
  appraisalFee: number | ''
  otherFee: number | ''
  newMrtaPremium: number | ''
  newFirePremium: number | ''
  /** ของแถมที่ต้องคืนธนาคารเดิมเพราะปิดก่อนกำหนด */
  clawback: number | ''
  /** เงินเวนคืน MRTA เดิม — ลดต้นทุนการย้ายลงตรง ๆ (ข้อ 1.8) */
  surrenderRefund: number | ''
  /** ของแถมเงินสดจากธนาคารใหม่ */
  incentive: number | ''
}

export const DEFAULT_CURRENT: CurrentLoan = {
  balance: 2_624_037,
  asOf: isoDate('2029-10-01'),
  dueDayOfMonth: 1,
  installment: 17_500,
  currentRate: 5.5,
  remainingMonths: 324,
  lockinLeftMonths: 0,
  penaltyPct: 3,
}

export const DEFAULT_RETENTION: RetentionDraft = {
  enabled: true,
  promoRates: [4.0, 4.0, 4.0],
  floatingRate: 5.5,
  fee: 3_000,
}

export const DEFAULT_REFI: RefiDraft = {
  bankCode: 'SCB',
  customName: '',
  promoRates: [3.0, 3.0, 3.0],
  floatingRate: 5.5,
  installment: 15_000,
  termYears: 30,
  lockinMonths: 36,
  mortgageFeePct: 1,
  stampDuty: true,
  appraisalFee: 3_000,
  otherFee: '',
  newMrtaPremium: '',
  newFirePremium: 2_500,
  clawback: '',
  surrenderRefund: '',
  incentive: '',
}

const num = (v: number | '' | undefined): number => (typeof v === 'number' ? v : 0)
/** baht() รับทศนิยมไม่เกิน 2 ตำแหน่ง — ค่าที่มาจาก % หรือจากที่ผู้ใช้พิมพ์เองต้องปัดก่อน */
const toSatang = (n: number): Satang => baht(Math.round(n * 100) / 100)
const sat = (v: number | '' | undefined): Satang => toSatang(num(v))
const rate = (v: number | '' | undefined) => bps(Math.round(num(v) * 100))

function stepsOf(promo: (number | '')[], floating: number | ''): RateStep[] {
  const years = promo.filter((r): r is number => typeof r === 'number').map((r) => rate(r))
  return rateStepsFromYearlyRates(years, rate(floating))
}

export function contextOf(c: CurrentLoan): RefinanceContext {
  return {
    balanceSatang: sat(c.balance),
    asOf: c.asOf,
    dueDayOfMonth: c.dueDayOfMonth,
    referenceRates: [],
    conventions: [defaultImportConvention(c.asOf)],
  }
}

/** ค่าปรับไถ่ถอน — เก็บเฉพาะตอนยังไม่พ้น lock-in เดิม ไม่ใช่ตอนโปะบางส่วน (ข้อ 1.6) */
export function penaltyOf(c: CurrentLoan): Satang {
  return prepayPenalty(sat(c.balance), rate(c.penaltyPct), 0, c.lockinLeftMonths)
}

export function refiMovingCost(c: CurrentLoan, r: RefiDraft): Satang {
  const balance = num(c.balance)
  const mortgageFee = (balance * num(r.mortgageFeePct)) / 100
  const stamp = r.stampDuty ? Math.min(balance * 0.0005, 10_000) : 0

  return movingCost({
    prepayPenaltySatang: penaltyOf(c),
    newFeesCashSatang: toSatang(mortgageFee + stamp + num(r.appraisalFee) + num(r.otherFee)),
    newCreditLifeSatang: sat(r.newMrtaPremium),
    newFireInsuranceSatang: sat(r.newFirePremium),
    clawbackSatang: sat(r.clawback),
    surrenderRefundSatang: sat(r.surrenderRefund),
    newIncentiveSatang: sat(r.incentive),
  })
}

/**
 * สร้างทางเลือกทั้งหมด
 *
 * ตัวที่ 4 "รีไฟแนนซ์แต่คงค่างวดเดิม" ใส่ให้อัตโนมัติเมื่อค่างวดใหม่ต่ำกว่าเดิม
 * เพราะเป็นทางที่ธนาคารไม่เสนอ แต่มักประหยัดที่สุด และทำให้เห็นกับดักยืดเทอมชัด ๆ
 */
export function buildScenarios(
  c: CurrentLoan,
  ret: RetentionDraft,
  r: RefiDraft,
): RefinanceScenario[] {
  const out: RefinanceScenario[] = [
    {
      kind: 'stay',
      label: `ไม่ทำอะไร คงค่างวด ${num(c.installment).toLocaleString('en-US')}`,
      rateSteps: [{ fromMonth: 1, toMonth: null, kind: 'fixed', fixedRateBps: rate(c.currentRate) }],
      installmentSatang: sat(c.installment),
      termMonths: c.remainingMonths,
      movingCostSatang: 0n as Satang,
      lockinMonths: 0,
      autoAdded: true,
    },
  ]

  if (ret.enabled) {
    out.push({
      kind: 'retention',
      // retention ไม่ยืดเทอม ไม่จดจำนองใหม่ ค่าใช้จ่ายมีแค่ค่าดำเนินการ
      label: 'ขอลดดอกกับธนาคารเดิม (retention)',
      rateSteps: stepsOf(ret.promoRates, ret.floatingRate),
      installmentSatang: sat(c.installment),
      termMonths: c.remainingMonths,
      movingCostSatang: sat(ret.fee),
      lockinMonths: 36,
    })
  }

  const cost = refiMovingCost(c, r)
  const refiSteps = stepsOf(r.promoRates, r.floatingRate)

  out.push({
    kind: 'refinance',
    label: `ย้ายไป${refiBankName(r)} ค่างวด ${num(r.installment).toLocaleString('en-US')} / ${r.termYears} ปี`,
    rateSteps: refiSteps,
    installmentSatang: sat(r.installment),
    termMonths: r.termYears * 12,
    movingCostSatang: cost,
    lockinMonths: r.lockinMonths,
  })

  if (num(r.installment) < num(c.installment)) {
    out.push({
      kind: 'refinance',
      label: `ย้ายไป${refiBankName(r)} แต่คงค่างวดเดิม ${num(c.installment).toLocaleString('en-US')}`,
      rateSteps: refiSteps,
      installmentSatang: sat(c.installment),
      termMonths: r.termYears * 12,
      movingCostSatang: cost,
      lockinMonths: r.lockinMonths,
      autoAdded: true,
    })
  }

  return out
}

export function refiReady(c: CurrentLoan, r: RefiDraft): boolean {
  return (
    num(c.balance) > 0 &&
    num(c.installment) > 0 &&
    num(c.currentRate) > 0 &&
    c.remainingMonths > 0 &&
    num(r.installment) > 0 &&
    r.promoRates.some((x) => typeof x === 'number')
  )
}

// ---------- อ่านของที่เก็บไว้ในเครื่อง ----------

export const reviveCurrent = (raw: unknown) => mergeShape(raw, DEFAULT_CURRENT)
export const reviveRetention = (raw: unknown) => {
  const merged = mergeShape(raw, DEFAULT_RETENTION)
  if (merged && !Array.isArray(merged.promoRates)) merged.promoRates = DEFAULT_RETENTION.promoRates
  return merged
}
export const reviveRefi = (raw: unknown) => {
  const merged = mergeShape(raw, DEFAULT_REFI)
  if (merged && !Array.isArray(merged.promoRates)) merged.promoRates = DEFAULT_REFI.promoRates
  return merged
}
