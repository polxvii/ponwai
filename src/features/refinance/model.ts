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
import { NO_BANK, OTHER_BANK, bankName } from '../compare/model'

/** ชื่อที่จะโชว์ในตาราง — ผู้ให้กู้ที่ไม่อยู่ในรายการให้พิมพ์เอง */
export function refiBankName(r: RefiDraft): string {
  if (r.bankCode === OTHER_BANK) return r.customName.trim() || 'ธนาคารอื่น'
  if (r.bankCode === NO_BANK) return 'ธนาคารใหม่'
  return bankName(r.bankCode)
}

/** สภาพหนี้ปัจจุบัน — ตัวเลขทั้งหมดเป็นบาท */
export type CurrentLoan = {
  balance: number | ''
  /** วันที่ใช้เป็นจุดตั้งต้นในการเทียบ — ค่าตั้งต้นคือวันนี้ ไม่ใช่ข้อมูลที่ต้องไปหามาจากไหน */
  asOf: ISODate
  dueDayOfMonth: number | ''
  installment: number | ''
  /** เรตที่จ่ายอยู่ตอนนี้ (หลังพ้นโปรแล้ว) เป็น % */
  currentRate: number | ''
  /** งวดที่เหลือตามสัญญาเดิม */
  remainingMonths: number | ''
  /** lock-in เดิมเหลืออีกกี่เดือน — ว่างหรือ 0 = พ้นแล้ว ไถ่ถอนได้ฟรี */
  lockinLeftMonths: number | ''
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
  termYears: number | ''
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

/**
 * ⛔ ห้ามใส่ตัวเลขตัวอย่างไว้ในค่าตั้งต้น
 *    ผู้ใช้แยกไม่ออกว่าเลขไหนของตัวเอง เลขไหนแอพใส่ให้
 *    แล้วเผลออ่านผลลัพธ์ของสัญญาที่ไม่มีอยู่จริงว่าเป็นของตัวเอง
 *
 * ที่ยังเหลือค่าไว้มีแค่ตัวที่เป็น "ข้อเท็จจริงตามกฎหมาย/ตลาด" ไม่ใช่ข้อเสนอของใคร
 *   mortgageFeePct 1   ค่าจดจำนองตามอัตรากรมที่ดิน
 *   stampDuty true     อากรแสตมป์ 0.05% เพดาน 10,000
 *   lockinMonths 36    lock-in มาตรฐานของสินเชื่อรีไฟแนนซ์ไทย
 * ถ้าลบสามตัวนี้ออก ต้นทุนการย้ายจะต่ำกว่าความจริงทุกครั้งโดยที่ผู้ใช้ไม่รู้ตัว
 */
export const emptyCurrent = (today: ISODate): CurrentLoan => ({
  balance: '',
  asOf: today,
  dueDayOfMonth: '',
  installment: '',
  currentRate: '',
  remainingMonths: '',
  lockinLeftMonths: '',
  penaltyPct: '',
})

export const EMPTY_RETENTION: RetentionDraft = {
  enabled: true,
  promoRates: ['', '', ''],
  floatingRate: '',
  fee: '',
}

export const EMPTY_REFI: RefiDraft = {
  bankCode: NO_BANK,
  customName: '',
  promoRates: ['', '', ''],
  floatingRate: '',
  installment: '',
  termYears: '',
  lockinMonths: 36,
  mortgageFeePct: 1,
  stampDuty: true,
  appraisalFee: '',
  otherFee: '',
  newMrtaPremium: '',
  newFirePremium: '',
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
    dueDayOfMonth: num(c.dueDayOfMonth),
    referenceRates: [],
    conventions: [defaultImportConvention(c.asOf)],
  }
}

/** ค่าปรับไถ่ถอน — เก็บเฉพาะตอนยังไม่พ้น lock-in เดิม ไม่ใช่ตอนโปะบางส่วน (ข้อ 1.6) */
export function penaltyOf(c: CurrentLoan): Satang {
  return prepayPenalty(sat(c.balance), rate(c.penaltyPct), 0, num(c.lockinLeftMonths))
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
      termMonths: num(c.remainingMonths),
      movingCostSatang: 0n as Satang,
      lockinMonths: 0,
      autoAdded: true,
    },
  ]

  // ⛔ ต้องมีเรตจริงก่อนถึงจะใส่ทางนี้ได้
  //    stepsOf ของว่างให้ 0% ซึ่งทำให้ retention ดูดีที่สุดเสมอแบบผิด ๆ
  //    และผู้ใช้จะเห็น "ขอลดดอกกับธนาคารเดิม" ชนะขาดทั้งที่ยังไม่ได้กรอกอะไรเลย
  if (ret.enabled && retentionUsable(ret)) {
    out.push({
      kind: 'retention',
      // retention ไม่ยืดเทอม ไม่จดจำนองใหม่ ค่าใช้จ่ายมีแค่ค่าดำเนินการ
      label: 'ขอลดดอกกับธนาคารเดิม (retention)',
      rateSteps: stepsOf(ret.promoRates, ret.floatingRate),
      installmentSatang: sat(c.installment),
      termMonths: num(c.remainingMonths),
      movingCostSatang: sat(ret.fee),
      lockinMonths: 36,
    })
  }

  const cost = refiMovingCost(c, r)
  const refiSteps = stepsOf(r.promoRates, r.floatingRate)

  out.push({
    kind: 'refinance',
    label: `ย้ายไป${refiBankName(r)} ค่างวด ${num(r.installment).toLocaleString('en-US')} / ${num(r.termYears)} ปี`,
    rateSteps: refiSteps,
    installmentSatang: sat(r.installment),
    termMonths: num(r.termYears) * 12,
    movingCostSatang: cost,
    lockinMonths: r.lockinMonths,
  })

  if (num(r.installment) < num(c.installment)) {
    out.push({
      kind: 'refinance',
      label: `ย้ายไป${refiBankName(r)} แต่คงค่างวดเดิม ${num(c.installment).toLocaleString('en-US')}`,
      rateSteps: refiSteps,
      installmentSatang: sat(c.installment),
      termMonths: num(r.termYears) * 12,
      movingCostSatang: cost,
      lockinMonths: r.lockinMonths,
      autoAdded: true,
    })
  }

  return out
}

/** มีเรตครบพอจะสร้าง rateSteps ที่มีความหมาย — ขาดเรตลอยตัวคือได้ 0% หลังพ้นโปร */
function hasRates(promo: (number | '')[], floating: number | ''): boolean {
  return promo.some((x) => typeof x === 'number') && typeof floating === 'number' && floating > 0
}

/** ทาง retention จะถูกนำไปเทียบจริงไหม — UI ใช้บอกผู้ใช้ว่าทำไมยังไม่ขึ้นในตาราง */
export function retentionUsable(ret: RetentionDraft): boolean {
  return hasRates(ret.promoRates, ret.floatingRate)
}

/**
 * ช่องที่ยังขาดจนคำนวณไม่ได้ เรียงตามลำดับในฟอร์ม
 *
 * ⚠️ ต้องครอบคลุมทุกช่องที่ engine ใช้จริง ไม่ใช่แค่ช่องเด่น ๆ
 *    ช่องไหนหลุดไป num() จะแปลงค่าว่างเป็น 0 เงียบ ๆ แล้วผลลัพธ์จะผิดแบบดูสมเหตุสมผล
 *    ซึ่งอันตรายกว่าการไม่แสดงผลเลย
 *
 * ⛔ อย่าแยกเงื่อนไข "พร้อมหรือยัง" ไปเขียนซ้ำที่อื่น ให้ refiReady อ่านจากที่นี่ที่เดียว
 *    ไม่งั้นสองที่จะเพี้ยนจากกันแล้วผู้ใช้เห็นหน้าว่างโดยไม่รู้ว่าขาดอะไร
 */
export function refiMissing(c: CurrentLoan, r: RefiDraft): string[] {
  const out: string[] = []
  const pos = (v: number | '' | undefined) => num(v) > 0

  // ⚠️ ข้อความต้องตรงกับ label ในฟอร์มเป๊ะ ๆ ไม่งั้นผู้ใช้อ่านแล้วหาช่องไม่เจอ
  if (!pos(c.balance)) out.push('ยอดคงเหลือวันนี้')
  if (!pos(c.installment)) out.push('ค่างวดที่จ่ายอยู่')
  if (!pos(c.currentRate)) out.push('เรตที่จ่ายอยู่')
  if (!pos(c.remainingMonths)) out.push('งวดที่เหลือตามสัญญา')
  if (!pos(c.dueDayOfMonth)) out.push('วันตัดรอบของเดือน')
  if (!r.promoRates.some((x) => typeof x === 'number')) {
    out.push('เรตปีที่ 1–3 ของธนาคารใหม่')
  }
  if (!pos(r.floatingRate)) out.push('หลังพ้นโปร ของธนาคารใหม่')
  if (!pos(r.installment)) out.push('ค่างวดตามใบเสนอ')
  if (!pos(r.termYears)) out.push('เทอมใหม่')

  return out
}

export function refiReady(c: CurrentLoan, r: RefiDraft): boolean {
  return refiMissing(c, r).length === 0
}

// ---------- อ่านของที่เก็บไว้ในเครื่อง ----------

export const reviveCurrent = (today: ISODate) => (raw: unknown) =>
  mergeShape(raw, emptyCurrent(today))
export const reviveRetention = (raw: unknown) => {
  const merged = mergeShape(raw, EMPTY_RETENTION)
  if (merged && !Array.isArray(merged.promoRates)) merged.promoRates = EMPTY_RETENTION.promoRates
  return merged
}
export const reviveRefi = (raw: unknown) => {
  const merged = mergeShape(raw, EMPTY_REFI)
  if (merged && !Array.isArray(merged.promoRates)) merged.promoRates = EMPTY_REFI.promoRates
  return merged
}
