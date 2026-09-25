/**
 * State ของหน้า Refinance — แปลงสิ่งที่ผู้ใช้กรอก เป็น scenario ที่ engine รับได้
 *
 * กฎเหล็กของโหมดนี้ (ข้อ 2A.1): ต้องมี "อยู่เฉย ๆ" เป็น baseline เสมอ
 * ถ้าไม่มี จะไม่มีทางรู้ว่าการย้ายคุ้มจริงไหม
 */

import { baht, bps, type Satang } from '@engine/money.js'
import { isoDate, type ISODate } from '@engine/date.js'
import {
  installmentStepsFromYearly, rateStepsFromYearlyRates, defaultImportConvention,
} from '@engine/import.js'
import {
  movingCost, prepayPenalty,
  type RefinanceContext, type RefinanceScenario,
} from '@engine/refinance.js'
import type { InstallmentStep, RateStep } from '@engine/types.js'
import { buildSchedule } from '@engine/schedule.js'
import { findInstallment, findRateStep, resolveRate } from '@engine/rates.js'
import { FIXED_SCALE } from '@engine/money.js'
import { balanceOn, settledPeriods } from '@/lib/progress'
import { toLoanTerms, toPaymentEvents, type LoanFull } from '@/lib/db'
import { mergeShape } from '@/lib/persist'
import { NO_BANK, OTHER_BANK, bankName, promoGap, type OfferDraft } from '../compare/model'

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
  /** ค่างวดของแต่ละช่วง เว้นว่าง = จ่ายเท่าเดิมกับที่ผ่อนอยู่ */
  promoInstallments: (number | '')[]
  floatingInstallment: number | ''
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
  /** ค่างวดของแต่ละช่วง เว้นว่าง = ใช้ค่างวดตามใบเสนอด้านบน */
  promoInstallments: (number | '')[]
  floatingInstallment: number | ''
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
  promoInstallments: ['', '', ''],
  floatingInstallment: '',
}

export const EMPTY_REFI: RefiDraft = {
  bankCode: NO_BANK,
  customName: '',
  promoRates: ['', '', ''],
  floatingRate: '',
  installment: '',
  promoInstallments: ['', '', ''],
  floatingInstallment: '',
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
/** เว้นว่าง = ไม่กำหนดค่างวดเฉพาะช่วง ให้ตกไปใช้ค่างวดหลัก */
const payOf = (v: number | '' | undefined): Satang | null =>
  typeof v === 'number' && v > 0 ? toSatang(v) : null

/**
 * ช่วงค่างวดที่ยาวตรงกับช่วงเรตเสมอ
 * ⚠️ ต้อง filter ด้วยเงื่อนไขเดียวกับ stepsOf ไม่งั้นขอบเขตเดือนของสองชุดเหลื่อมกัน
 */
function paySteps(
  rates: readonly (number | '')[],
  pays: readonly (number | '')[] | undefined,
  floatingPay: number | '' | undefined,
): InstallmentStep[] {
  const list = pays ?? []
  return installmentStepsFromYearly(
    rates
      .map((r, i) => (typeof r === 'number' ? payOf(list[i]) : null))
      .filter((_, i) => typeof rates[i] === 'number'),
    payOf(floatingPay),
  )
}
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
      installmentSteps: paySteps(ret.promoRates, ret.promoInstallments, ret.floatingInstallment),
      termMonths: num(c.remainingMonths),
      movingCostSatang: sat(ret.fee),
      lockinMonths: 36,
    })
  }

  const cost = refiMovingCost(c, r)
  const refiSteps = stepsOf(r.promoRates, r.floatingRate)
  const refiPaySteps = paySteps(r.promoRates, r.promoInstallments, r.floatingInstallment)

  out.push({
    kind: 'refinance',
    label: `ย้ายไป${refiBankName(r)} ค่างวด ${num(r.installment).toLocaleString('en-US')} / ${num(r.termYears)} ปี`,
    rateSteps: refiSteps,
    installmentSatang: sat(r.installment),
    installmentSteps: refiPaySteps,
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
  return hasRates(ret.promoRates, ret.floatingRate) && promoGap(ret.promoRates) === null
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
  // ⚠️ ยังไม่พ้น lock-in แล้วไม่กรอก % ค่าปรับ = ค่าปรับกลายเป็น 0 เงียบ ๆ
  //    ซึ่งเป็นต้นทุนก้อนใหญ่ที่สุดของการย้ายก่อนกำหนด ขาดไปแล้วผลพลิกได้เลย
  if (num(c.lockinLeftMonths) > 0 && !pos(c.penaltyPct)) out.push('ค่าปรับไถ่ถอน')

  const gap = promoGap(r.promoRates)
  if (gap !== null) out.push(`เรตปีที่ ${gap} ของธนาคารใหม่ (เว้นว่างตรงกลางไม่ได้)`)
  else if (!r.promoRates.some((x) => typeof x === 'number')) {
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

/**
 * ช่องที่ขาดได้ ผลยังขึ้น แต่ต้นทุนการย้ายจะต่ำกว่าความจริง (ข้อ 5A.3 วิธีที่ 4)
 *
 * ⚠️ ต่างจาก refiMissing ตรงที่อันนี้ "ไม่บล็อก" แต่ต้องโชว์คู่กับผลลัพธ์เสมอ
 *    ไม่งั้นผู้ใช้อ่าน "ต้นทุนการย้าย รวมแล้ว X บาท" เป็นตัวเลขที่ครบแล้ว
 *    ทั้งที่ค่าประเมินกับเบี้ยอัคคีภัยเป็น 0 เพราะยังไม่ได้กรอก
 */
export function refiWarnings(
  c: CurrentLoan,
  ret: RetentionDraft,
  r: RefiDraft,
): { label: string; impact: string }[] {
  const out: { label: string; impact: string }[] = []

  if (r.appraisalFee === '') {
    out.push({ label: 'ค่าประเมินใหม่', impact: 'ปกติ 3,000–10,000 บาท' })
  }
  if (r.newFirePremium === '') {
    out.push({ label: 'เบี้ยอัคคีภัยใหม่', impact: 'ราว 2,000–4,000 บาทต่อ 3 ปี' })
  }
  if (r.newMrtaPremium === '') {
    out.push({ label: 'เบี้ย MRTA ใหม่', impact: 'ถ้าธนาคารใหม่บังคับซื้อ ต้นทุนย้ายสูงขึ้นมาก' })
  }
  if (num(c.lockinLeftMonths) > 0 && r.clawback === '') {
    out.push({ label: 'ของแถมที่ต้องคืนแบงก์เดิม', impact: 'ยังไม่พ้น lock-in มักต้องคืน' })
  }
  if (ret.enabled && ret.fee === '') {
    out.push({ label: 'ค่าดำเนินการ retention', impact: 'ปกติหลักพัน บางแห่งฟรี' })
  }

  return out
}

// ---------- อ่านของที่เก็บไว้ในเครื่อง ----------

/**
 * ⚠️ วันที่พิจารณาที่ค้างอยู่ในอดีตอันตรายเงียบ ๆ
 *    useLocalState เขียนค่าตั้งต้นลง storage ตั้งแต่ mount แรกแม้ผู้ใช้ยังไม่พิมพ์อะไร
 *    เปิดหน้านี้ทิ้งไว้เดือนตุลา กลับมากรอกยอดคงเหลือเดือนมีนา
 *    asOf ยังเป็นตุลา แล้ว engine จะ amortise ยอดที่เพิ่งกรอกย้อนหลัง 5 เดือน
 *    ดอกเบี้ยที่เหลือจึงเกินจริง และวันปิดหนี้กับเดือนคืนทุนมาเร็วกว่าความจริง
 *    วันในอนาคตปล่อยไว้ได้ เพราะเป็นการวางแผนล่วงหน้าที่ผู้ใช้ตั้งใจ
 */
export const reviveCurrent = (today: ISODate) => (raw: unknown) => {
  const merged = mergeShape(raw, emptyCurrent(today))
  if (merged && merged.asOf < today) merged.asOf = today
  return merged
}
export const reviveRetention = (raw: unknown) => {
  const merged = mergeShape(raw, EMPTY_RETENTION)
  if (merged && !Array.isArray(merged.promoRates)) merged.promoRates = EMPTY_RETENTION.promoRates
  if (merged && !Array.isArray(merged.promoInstallments)) {
    merged.promoInstallments = [...EMPTY_RETENTION.promoInstallments]
  }
  return merged
}
export const reviveRefi = (raw: unknown) => {
  const merged = mergeShape(raw, EMPTY_REFI)
  if (merged && !Array.isArray(merged.promoRates)) merged.promoRates = EMPTY_REFI.promoRates
  if (merged && !Array.isArray(merged.promoInstallments)) {
    merged.promoInstallments = [...EMPTY_REFI.promoInstallments]
  }
  return merged
}

// ---------- ดึงจากสัญญาที่ติดตามอยู่ ----------

/**
 * ช่องที่ดึงจากสัญญาที่บันทึกไว้ได้
 *
 * ⛔ ไม่มี lockinLeftMonths กับ penaltyPct โดยตั้งใจ
 *    สองค่านี้อยู่ในสัญญากระดาษ ไม่ได้อยู่ในระบบ เดาแทนไม่ได้
 *    และมันคือตัวชี้ขาดว่าย้ายคุ้มไหม การเติม 0 ให้เงียบ ๆ
 *    เท่ากับบอกว่า "ไถ่ถอนฟรี" ทั้งที่ยังไม่มีใครตรวจ
 */
export type CurrentPrefill = Pick<
  CurrentLoan,
  'balance' | 'asOf' | 'dueDayOfMonth' | 'installment' | 'currentRate' | 'remainingMonths'
>

/**
 * แปลงสัญญาที่ติดตามอยู่ เป็นค่าตั้งต้นของ "หนี้ที่ผ่อนอยู่"
 *
 * ⚠️ ต้องคิดจากตารางที่รวมการจ่ายจริงแล้ว ไม่ใช่ตัวเลขดิบในตาราง active_loans
 *    ยอดคงเหลือกับงวดที่เหลือของคนที่โปะมาแล้ว ต่างจากสัญญาตั้งต้นคนละเรื่อง
 *    ใช้ settledPeriods ตัวเดียวกับหน้าสัญญา จะได้ไม่ขัดกันเองสองหน้า
 */
export function currentFromLoan(full: LoanFull, today: ISODate): CurrentPrefill {
  const terms = toLoanTerms(full)
  const events = toPaymentEvents(full)
  const { rows } = buildSchedule(terms, events)

  const settled = settledPeriods(rows, events, today)
  // ค่างวดกับเรตของ "งวดถัดไป" ไม่ใช่ของงวดแรกของสัญญา — สัญญาแบ่งช่วงไว้
  const next = Math.min(settled + 1, Math.max(1, rows.length))
  const step = findRateStep(terms.rateSteps, next)

  return {
    balance: Number(balanceOn(rows, events, today, terms.principalSatang) / FIXED_SCALE) / 100,
    asOf: today,
    dueDayOfMonth: full.loan.due_day_of_month,
    installment:
      Number(findInstallment(terms.installmentSteps, next, terms.installmentSatang)) / 100,
    currentRate: Number(resolveRate(step, terms.referenceRates, today)) / 100,
    remainingMonths: Math.max(0, rows.length - settled),
  }
}

/**
 * แปลงใบเสนอจากหน้าเปรียบเทียบ มาเป็นข้อเสนอของธนาคารใหม่
 *
 * ⛔ ไม่แตะ termYears กับ lockinMonths ที่ผู้ใช้ตั้งไว้แล้ว
 *    เทอมอยู่ใน "เงื่อนไขร่วม" ของหน้าเปรียบเทียบ ไม่ใช่ของใบเสนอ
 *    การเดาแทนจะเปลี่ยนคำตอบเรื่องกับดักยืดเทอม ซึ่งเป็นหัวใจของหน้านี้ (ข้อ 2A.2)
 *
 * ⚠️ ค่าธรรมเนียมบางตัวของหน้าเปรียบเทียบไม่มีที่ลงในหน้านี้
 *    (เพดานยกเว้นค่าจดจำนอง, ส่วนลดเรตจาก MRTA, ปีที่ยกเว้นประกันอัคคีภัย)
 *    ตกไปเงียบ ๆ ดีกว่ายัดลงช่องที่ความหมายไม่ตรงกัน
 */
export function refiFromOffer(d: OfferDraft): Partial<RefiDraft> {
  return {
    bankCode: d.bankCode,
    customName: d.customName,
    promoRates: [...d.promoRates],
    floatingRate: d.floatingRate,
    installment: d.installment,
    promoInstallments: [...d.promoInstallments],
    floatingInstallment: d.floatingInstallment,
    mortgageFeePct: d.mortgageFeePct,
    stampDuty: d.stampDuty,
    appraisalFee: d.appraisalFee,
    otherFee: d.otherFee,
    newMrtaPremium: d.mrtaPremium,
    newFirePremium: d.firePremium,
  }
}
