import { describe, it, expect } from 'vitest'
import { baht, bps, formatSatangBaht, type Satang } from './money.js'
import { isoDate } from './date.js'
import {
  computeFee, computeFees, fireInsuranceSchedule, surrenderValueRange,
  buildCostCashflows, totalNonInterestCost,
  type OfferFee, type RecurringInsurance, type CreditLifeInsurance,
} from './fees.js'

const f = (v: Satang) => formatSatangBaht(v)
const s = (n: number): Satang => baht(n)

const stampDuty = (loanBaht: number): OfferFee => ({
  feeType: 'อากรแสตมป์',
  basis: 'pct_of_loan',
  pctBps: bps(5),              // 0.05%
  capSatang: s(10_000),        // ไม่เกิน 10,000
  isWaived: false,
  isFinanced: false,
})

describe('TV-19 ค่าธรรมเนียมแบบมีเพดาน', () => {
  it('อากรแสตมป์ วงเงิน 15,000,000 -> 7,500 ยังไม่ชนเพดาน', () => {
    const r = computeFee(stampDuty(15_000_000), s(15_000_000))
    expect(f(r.grossSatang)).toBe('7,500.00')
    expect(f(r.payableSatang)).toBe('7,500.00')
  })

  it('อากรแสตมป์ วงเงิน 25,000,000 -> 12,500 ต้องถูก cap เหลือ 10,000', () => {
    const r = computeFee(stampDuty(25_000_000), s(25_000_000))
    expect(f(r.grossSatang)).toBe('10,000.00')
    expect(f(r.payableSatang)).toBe('10,000.00')
  })

  it('ค่าจดจำนอง 1% ของ 15,000,000 = 150,000 ฟรีสูงสุด 100,000 -> ผู้กู้จ่าย 50,000', () => {
    const mortgageFee: OfferFee = {
      feeType: 'ค่าจดจำนอง',
      basis: 'pct_of_loan',
      pctBps: bps(100),               // 1.00%
      isWaived: true,
      waiverCapSatang: s(100_000),    // ฟรีแบบมีเพดาน
      isFinanced: false,
    }
    const r = computeFee(mortgageFee, s(15_000_000))
    expect(f(r.grossSatang)).toBe('150,000.00')
    expect(f(r.waivedSatang)).toBe('100,000.00')
    expect(f(r.payableSatang)).toBe('50,000.00')
  })

  it('ถ้าวงเงินเล็กจนต่ำกว่าเพดานของแถม ต้องฟรีทั้งหมด ไม่ใช่ฟรีแค่เพดาน', () => {
    const mortgageFee: OfferFee = {
      feeType: 'ค่าจดจำนอง',
      basis: 'pct_of_loan',
      pctBps: bps(100),
      isWaived: true,
      waiverCapSatang: s(100_000),
      isFinanced: false,
    }
    const r = computeFee(mortgageFee, s(3_000_000))  // 1% = 30,000
    expect(f(r.grossSatang)).toBe('30,000.00')
    expect(f(r.waivedSatang)).toBe('30,000.00')
    expect(r.payableSatang).toBe(0n)
  })

  it('เพดานของค่าธรรมเนียม กับ เพดานของ "ฟรี" เป็นคนละตัว ต้องทำงานร่วมกันได้', () => {
    // อากรแสตมป์ 25 ล้าน: gross ถูก cap เหลือ 10,000 แล้วฟรีสูงสุด 6,000
    const fee: OfferFee = {
      ...stampDuty(25_000_000),
      isWaived: true,
      waiverCapSatang: s(6_000),
    }
    const r = computeFee(fee, s(25_000_000))
    expect(f(r.grossSatang)).toBe('10,000.00')
    expect(f(r.waivedSatang)).toBe('6,000.00')
    expect(f(r.payableSatang)).toBe('4,000.00')
  })
})

describe('computeFees: แยกเงินสด กับ ที่รวมในวงเงิน', () => {
  it('ที่ financed ต้องไม่ถูกนับเป็นเงินสด ไม่งั้น Net Position จะนับซ้ำ (ข้อ 2.2)', () => {
    const fees: OfferFee[] = [
      { feeType: 'ประเมิน', basis: 'flat', amountSatang: s(3_000), isWaived: false, isFinanced: false },
      { feeType: 'จัดการสินเชื่อ', basis: 'flat', amountSatang: s(20_000), isWaived: false, isFinanced: true },
      stampDuty(3_000_000),
    ]
    const t = computeFees(fees, s(3_000_000))
    expect(f(t.grossSatang)).toBe('24,500.00')        // 3,000 + 20,000 + 1,500
    expect(f(t.payableCashSatang)).toBe('4,500.00')   // 3,000 + 1,500
    expect(f(t.financedSatang)).toBe('20,000.00')
    expect(t.payableCashSatang + t.financedSatang).toBe(t.grossSatang - t.waivedSatang)
  })
})

describe('TV-20 ประกันอัคคีภัยแบบเกิดซ้ำ', () => {
  const ins: RecurringInsurance = {
    kind: 'fire',
    premiumSatang: s(3_000),
    termYears: 3,
    waivedFirstNYears: 3,
    escalationBpsPerRenewal: bps(0),
  }

  it('เบี้ย 3,000/3 ปี อายุ 30 ปี ฟรี 3 ปีแรก -> จ่าย 9 ครั้ง ไม่ใช่ 10', () => {
    const sched = fireInsuranceSchedule(ins, isoDate('2026-10-01'), 360)
    expect(sched).toHaveLength(9)
  })

  it('จ่ายที่ปีสัญญาที่ 4, 7, 10, ..., 28', () => {
    const sched = fireInsuranceSchedule(ins, isoDate('2026-10-01'), 360)
    expect(sched.map((x) => x.contractYear)).toEqual([4, 7, 10, 13, 16, 19, 22, 25, 28])
  })

  it('วันจ่ายต้องเป็นเวลาจริง ไม่ใช่กองรวมที่ t0', () => {
    const sched = fireInsuranceSchedule(ins, isoDate('2026-10-01'), 360)
    expect(sched[0]!.date).toBe(isoDate('2029-10-01'))
    expect(sched[8]!.date).toBe(isoDate('2053-10-01'))
    expect(new Set(sched.map((x) => x.date)).size).toBe(9)  // ไม่ซ้ำวันกัน
  })

  it('ต้นทุนรวมของประกัน = 27,000 ไม่ใช่ 30,000', () => {
    const sched = fireInsuranceSchedule(ins, isoDate('2026-10-01'), 360)
    expect(f(totalNonInterestCost(sched))).toBe('27,000.00')
  })

  it('ไม่มีโปรฟรี -> จ่าย 10 ครั้ง เริ่มปีที่ 1', () => {
    const sched = fireInsuranceSchedule({ ...ins, waivedFirstNYears: 0 }, isoDate('2026-10-01'), 360)
    expect(sched).toHaveLength(10)
    expect(sched[0]!.contractYear).toBe(1)
    expect(f(totalNonInterestCost(sched))).toBe('30,000.00')
  })

  it('เบี้ยรายปี ฟรี 3 ปีแรก -> จ่าย 27 ครั้ง', () => {
    const sched = fireInsuranceSchedule(
      { ...ins, termYears: 1, waivedFirstNYears: 3 }, isoDate('2026-10-01'), 360,
    )
    expect(sched).toHaveLength(27)
    expect(sched[0]!.contractYear).toBe(4)
  })

  it('escalation นับตามจำนวนครั้งที่ต่ออายุ ไม่ใช่จำนวนครั้งที่จ่าย', () => {
    // ฟรี 3 ปีแรก = ข้ามงวดแรกไป 1 ครั้ง งวดที่จ่ายครั้งแรกจึงเป็นการต่ออายุครั้งที่ 1
    const sched = fireInsuranceSchedule(
      { ...ins, escalationBpsPerRenewal: bps(1_000) }, isoDate('2026-10-01'), 360,
    )
    expect(f(sched[0]!.amountSatang)).toBe('3,300.00')  // 3,000 x 1.10
    expect(f(sched[1]!.amountSatang)).toBe('3,630.00')  // x 1.10 อีกครั้ง
  })
})

describe('มูลค่าเวนคืน MRTA (ข้อ 1.8)', () => {
  const mrta: CreditLifeInsurance = {
    kind: 'MRTA',
    premiumSatang: s(100_000),
    coverageYears: 15,
    financed: true,
    rateDiscountBps: bps(25),
    isRequired: false,
  }

  it('ยังไม่กรอก -> คืนเป็นช่วง 30-50% พร้อมธง unconfirmed ห้ามใช้ค่ากลางเงียบ ๆ', () => {
    const r = surrenderValueRange(mrta)
    expect(f(r.lowSatang)).toBe('30,000.00')
    expect(f(r.highSatang)).toBe('50,000.00')
    expect(r.confirmed).toBe(false)
  })

  it('กรอกแล้ว -> ใช้ค่าจริง ช่วงยุบเป็นจุดเดียว', () => {
    const r = surrenderValueRange({ ...mrta, surrenderValueBps: bps(4_200) })
    expect(f(r.lowSatang)).toBe('42,000.00')
    expect(r.lowSatang).toBe(r.highSatang)
    expect(r.confirmed).toBe(true)
  })
})

describe('buildCostCashflows: เรียงตามเวลาจริง', () => {
  it('ค่าธรรมเนียมเงินสดอยู่ t0 ประกันกระจายตามปี MRTA ที่ financed ต้องไม่โผล่เป็นเงินสด', () => {
    const start = isoDate('2026-10-01')
    const flows = buildCostCashflows({
      fees: computeFees([
        { feeType: 'ประเมิน', basis: 'flat', amountSatang: s(3_000), isWaived: false, isFinanced: false },
      ], s(3_000_000)),
      fireSchedule: fireInsuranceSchedule({
        kind: 'fire', premiumSatang: s(3_000), termYears: 3,
        waivedFirstNYears: 3, escalationBpsPerRenewal: bps(0),
      }, start, 360),
      creditLife: {
        kind: 'MRTA', premiumSatang: s(100_000), coverageYears: 15,
        financed: true, rateDiscountBps: bps(25), isRequired: false,
      },
    }, start)

    expect(flows[0]!.date).toBe(start)
    expect(f(flows[0]!.amountSatang)).toBe('3,000.00')
    expect(flows).toHaveLength(10)                      // 1 ค่าธรรมเนียม + 9 ประกัน
    expect(f(totalNonInterestCost(flows))).toBe('30,000.00')
    // MRTA financed ต้องไม่อยู่ในกระแสเงินสด เพราะอยู่ในเงินต้นไปแล้ว
    expect(flows.some((x) => x.label.includes('MRTA'))).toBe(false)
  })

  it('MRTA จ่ายสด ต้องโผล่ที่ t0', () => {
    const start = isoDate('2026-10-01')
    const flows = buildCostCashflows({
      fees: computeFees([], s(3_000_000)),
      fireSchedule: [],
      creditLife: {
        kind: 'MRTA', premiumSatang: s(100_000), coverageYears: 15,
        financed: false, rateDiscountBps: bps(25), isRequired: false,
      },
    }, start)
    expect(flows).toHaveLength(1)
    expect(f(flows[0]!.amountSatang)).toBe('100,000.00')
  })
})
