/**
 * ค่าธรรมเนียมและประกัน (spec ข้อ 1.7)
 *
 * ค่าใช้จ่ายมี 3 ประเภทที่คำนวณคนละแบบ อย่าเก็บรวมเป็น list เดียว
 *   A  ครั้งเดียวตอนทำสัญญา — จดจำนอง อากรแสตมป์ ประเมิน จัดการสินเชื่อ
 *   B  เกิดซ้ำตลอดอายุสัญญา — ประกันอัคคีภัย ต่อทุก 1-3 ปี ตลอด 30 ปี
 *   C  MRTA / MLTA — ก้อนเดียว คุ้มครองหลายปี มักถูกรวมเข้าวงเงินกู้
 *
 * ประเภท B คือส่วนที่เครื่องคิดเลขทั่วไปไม่มี และเป็นเหตุผลที่ต้องเก็บเป็น
 * cash flow ตามเวลาจริง ไม่ใช่รวมเป็นก้อนที่ t0 (TV-20)
 */

import { type ISODate, addMonthsClamped, year as getYear } from './date.js'
import { type Satang, type Bps, ZERO_SATANG } from './money.js'

// ---------- ประเภท A: ค่าธรรมเนียมครั้งเดียว ----------

export type FeeBasis = 'flat' | 'pct_of_loan'

export type OfferFee = {
  feeType: string
  basis: FeeBasis
  /** ใช้เมื่อ basis = 'flat' */
  amountSatang?: Satang
  /** ใช้เมื่อ basis = 'pct_of_loan' เช่น 100 = 1.00% */
  pctBps?: Bps
  /** เพดานของตัวค่าธรรมเนียมเอง เช่น อากรแสตมป์ไม่เกิน 10,000 */
  capSatang?: Satang
  isWaived: boolean
  /** เพดานของ "ฟรี" เช่น ฟรีค่าจดจำนองสูงสุด 100,000 — ต่างจาก capSatang คนละตัว */
  waiverCapSatang?: Satang
  /** รวมในวงเงินกู้ หรือจ่ายสด — กระทบ Net Position โดยตรง (ข้อ 2.2) */
  isFinanced: boolean
  /** ถ้าปิดบัญชีก่อน N เดือน ต้องคืนของแถม */
  clawbackMonths?: number
  note?: string
}

export type FeeBreakdown = {
  feeType: string
  /** ยอดเต็มหลังใช้เพดานของค่าธรรมเนียมเอง */
  grossSatang: Satang
  /** ส่วนที่ธนาคารออกให้ */
  waivedSatang: Satang
  /** ส่วนที่ผู้กู้จ่ายจริง */
  payableSatang: Satang
  isFinanced: boolean
}

export function computeFee(fee: OfferFee, loanAmountSatang: Satang): FeeBreakdown {
  let gross: bigint
  if (fee.basis === 'flat') {
    gross = fee.amountSatang ?? 0n
  } else {
    if (fee.pctBps === undefined) throw new Error(`${fee.feeType}: basis เป็น pct_of_loan แต่ไม่มี pctBps`)
    gross = (loanAmountSatang * BigInt(fee.pctBps)) / 10_000n
  }

  // เพดานของตัวค่าธรรมเนียมเอง เช่น อากรแสตมป์ 0.05% แต่ไม่เกิน 10,000
  if (fee.capSatang !== undefined && gross > fee.capSatang) gross = fee.capSatang

  let waived = 0n
  if (fee.isWaived) {
    // "ฟรีแบบมีเพดาน" — ถ้ากู้เยอะจนเกินเพดานของแถม ส่วนเกินผู้กู้จ่ายเอง
    waived = fee.waiverCapSatang !== undefined && fee.waiverCapSatang < gross
      ? fee.waiverCapSatang
      : gross
  }

  return {
    feeType: fee.feeType,
    grossSatang: gross as Satang,
    waivedSatang: waived as Satang,
    payableSatang: (gross - waived) as Satang,
    isFinanced: fee.isFinanced,
  }
}

export type FeeTotals = {
  lines: FeeBreakdown[]
  grossSatang: Satang
  waivedSatang: Satang
  /** จ่ายสด ณ วันทำสัญญา — ตัวนี้เท่านั้นที่เข้า Net Position (ข้อ 2.2) */
  payableCashSatang: Satang
  /** รวมในวงเงินกู้ — อยู่ในเงินต้นแล้ว ห้ามบวกซ้ำ */
  financedSatang: Satang
}

export function computeFees(fees: readonly OfferFee[], loanAmountSatang: Satang): FeeTotals {
  const lines = fees.map((x) => computeFee(x, loanAmountSatang))
  const sum = (pick: (l: FeeBreakdown) => Satang, filter?: (l: FeeBreakdown) => boolean) =>
    lines.filter(filter ?? (() => true)).reduce((a, l) => a + pick(l), 0n) as Satang

  return {
    lines,
    grossSatang: sum((l) => l.grossSatang),
    waivedSatang: sum((l) => l.waivedSatang),
    payableCashSatang: sum((l) => l.payableSatang, (l) => !l.isFinanced),
    financedSatang: sum((l) => l.payableSatang, (l) => l.isFinanced),
  }
}

// ---------- ประเภท B: ประกันที่เกิดซ้ำ ----------

export type RecurringInsurance = {
  kind: 'fire'
  premiumSatang: Satang
  /** ต่ออายุทุกกี่ปี โดยทั่วไป 1 หรือ 3 */
  termYears: number
  /** โปรโมชั่นฟรีกี่ปีแรก */
  waivedFirstNYears: number
  /** เบี้ยขึ้นกี่ % ต่อการต่ออายุหนึ่งครั้ง — default 0 ถ้าไม่รู้ อย่าเดา */
  escalationBpsPerRenewal: Bps
}

export type CashOutflow = {
  date: ISODate
  amountSatang: Satang
  label: string
  /** ปีที่เท่าไหร่ของสัญญา 1-indexed */
  contractYear: number
}

/**
 * ตารางจ่ายเบี้ยประกันอัคคีภัยตลอดอายุสัญญา
 *
 * จ่ายที่ต้นงวดความคุ้มครอง: ปีที่ 1, 1+termYears, 1+2×termYears, ...
 * ข้ามงวดที่อยู่ในช่วงฟรี — ฟรี 3 ปีแรกกับเบี้ยราย 3 ปี จะได้ 9 ครั้ง ไม่ใช่ 10 (TV-20)
 */
export function fireInsuranceSchedule(
  ins: RecurringInsurance,
  startDate: ISODate,
  loanTermMonths: number,
): CashOutflow[] {
  if (ins.termYears <= 0) throw new Error('termYears ต้องมากกว่า 0')
  const loanYears = loanTermMonths / 12
  const out: CashOutflow[] = []

  let renewalIndex = 0
  for (let t = 0; t < loanYears; t += ins.termYears) {
    const contractYear = t + 1
    if (t < ins.waivedFirstNYears) { renewalIndex++; continue }

    // เบี้ยขึ้นตามจำนวนครั้งที่ต่ออายุมาแล้ว ไม่ใช่ตามจำนวนครั้งที่จ่าย
    let premium = ins.premiumSatang as bigint
    for (let k = 0; k < renewalIndex; k++) {
      premium = (premium * (10_000n + BigInt(ins.escalationBpsPerRenewal))) / 10_000n
    }

    out.push({
      date: addMonthsClamped(startDate, t * 12, Number(startDate.slice(8, 10))),
      amountSatang: premium as Satang,
      label: `ประกันอัคคีภัย ปีที่ ${contractYear}`,
      contractYear,
    })
    renewalIndex++
  }
  return out
}

// ---------- ประเภท C: MRTA / MLTA ----------

export type CreditLifeInsurance = {
  kind: 'MRTA' | 'MLTA'
  premiumSatang: Satang
  /** มักสั้นกว่าอายุสัญญา เช่น 15 ปีจาก 30 */
  coverageYears: number
  /** รวมในวงเงินกู้หรือจ่ายสด — ถ้า financed ต้นทุนจริงสูงกว่าเบี้ยที่เห็นมาก (ดู TV-17) */
  financed: boolean
  /** ส่วนลดดอกเบี้ยที่ได้จากการทำ */
  rateDiscountBps: Bps
  isRequired: boolean
  /** มูลค่าเวนคืนเมื่อรีไฟแนนซ์ — ⚠️ อย่าใส่ default ให้ผู้ใช้กรอกจากบริษัทประกันจริง (ข้อ 1.8) */
  surrenderValueBps?: Bps
}

/**
 * มูลค่าเวนคืน MRTA เมื่อรีไฟแนนซ์
 * ถ้าผู้ใช้ยังไม่กรอก ให้คืนเป็น "ช่วง" 30-50% ของเบี้ยที่จ่ายไป พร้อมธง unconfirmed
 * ห้ามเอาค่ากลางของช่วงไปใช้คำนวณเงียบ ๆ เพราะช่วงนี้กว้างพอจะพลิกข้อสรุปได้ (ข้อ 1.8)
 */
export function surrenderValueRange(
  ins: CreditLifeInsurance,
): { lowSatang: Satang; highSatang: Satang; confirmed: boolean } {
  if (ins.surrenderValueBps !== undefined) {
    const v = (ins.premiumSatang * BigInt(ins.surrenderValueBps)) / 10_000n
    return { lowSatang: v as Satang, highSatang: v as Satang, confirmed: true }
  }
  return {
    lowSatang: ((ins.premiumSatang * 3_000n) / 10_000n) as Satang,
    highSatang: ((ins.premiumSatang * 5_000n) / 10_000n) as Satang,
    confirmed: false,
  }
}

// ---------- รวมเป็น cash flow สำหรับ TCO และ XIRR ----------

export type CostModel = {
  fees: FeeTotals
  fireSchedule: CashOutflow[]
  creditLife?: CreditLifeInsurance
}

/**
 * กระแสเงินสดจ่ายทั้งหมดที่ไม่ใช่ค่างวด เรียงตามเวลาจริง
 * ต้องเข้า XIRR ที่เวลาของมันเอง ห้ามยุบมาเป็นก้อนเดียวที่ t0 (TV-20)
 */
export function buildCostCashflows(model: CostModel, startDate: ISODate): CashOutflow[] {
  const out: CashOutflow[] = []

  if (model.fees.payableCashSatang > 0n) {
    out.push({
      date: startDate,
      amountSatang: model.fees.payableCashSatang,
      label: 'ค่าธรรมเนียมจ่ายสดตอนทำสัญญา',
      contractYear: 1,
    })
  }

  if (model.creditLife && !model.creditLife.financed && model.creditLife.premiumSatang > 0n) {
    out.push({
      date: startDate,
      amountSatang: model.creditLife.premiumSatang,
      label: `เบี้ย ${model.creditLife.kind}`,
      contractYear: 1,
    })
  }

  out.push(...model.fireSchedule)
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** ต้นทุนรวมที่ไม่ใช่ดอกเบี้ย ตลอดอายุสัญญา — ไม่คิดมูลค่าเงินตามเวลา ใช้คู่กับ XIRR เสมอ */
export function totalNonInterestCost(flows: readonly CashOutflow[]): Satang {
  return flows.reduce((a, x) => a + x.amountSatang, ZERO_SATANG) as Satang
}

/** จัดกลุ่มกระแสเงินสดตามปีปฏิทิน ใช้กับกราฟรายปี */
export function cashflowsByCalendarYear(flows: readonly CashOutflow[]): Map<number, Satang> {
  const m = new Map<number, Satang>()
  for (const x of flows) {
    const y = getYear(x.date)
    m.set(y, ((m.get(y) ?? 0n) + x.amountSatang) as Satang)
  }
  return m
}
