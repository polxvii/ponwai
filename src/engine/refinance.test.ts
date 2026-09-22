import { describe, it, expect } from 'vitest'
import { baht, bps, formatFixedBaht, formatSatangBaht, type Satang, type Fixed } from './money.js'
import { isoDate } from './date.js'
import { buildSchedule } from './schedule.js'
import { makeTerms, fixedStep, defaultConventions } from './test-helpers.js'
import {
  compareRefinanceOptions, recommend, movingCost, prepayPenalty,
  type RefinanceContext, type RefinanceScenario,
} from './refinance.js'

const f = (v: Fixed) => formatFixedBaht(v)
const f0 = (v: Fixed) => formatFixedBaht(v, 0)
const fs = (v: Satang) => formatSatangBaht(v)
const s = (n: number): Satang => baht(n)

describe('2A.2 ยอดคงเหลือสิ้นปีที่ 3 ต้องตรงก่อน', () => {
  it('3,000,000 เริ่ม 2026-10-01 โปร 3 ปี 3.00% -> 5.50% ค่างวด 17,500 -> 2,624,036.54', () => {
    const { rows } = buildSchedule(makeTerms({
      startDate: isoDate('2026-10-01'),
      rateSteps: [fixedStep(3.0, 1, 36), fixedStep(5.5, 37, null)],
      installmentBaht: 17_500,
    }))
    expect(rows[35]!.date).toBe(isoDate('2029-10-01'))
    expect(f(rows[35]!.balanceAfterFixed)).toBe('2,624,036.54')
  })
})

describe('TV-18 กับดักยืดเทอมตอนรีไฟแนนซ์', () => {
  const ctx: RefinanceContext = {
    balanceSatang: s(2_624_036.54),
    asOf: isoDate('2029-10-01'),
    dueDayOfMonth: 1,
    referenceRates: [],
    conventions: defaultConventions('2029-10-01'),
  }

  const newPromo = [fixedStep(3.0, 1, 36), fixedStep(5.5, 37, null)]

  const scenarios: RefinanceScenario[] = [
    {
      kind: 'stay', label: 'ไม่รีไฟแนนซ์ คงค่างวด 17,500',
      rateSteps: [fixedStep(5.5, 1, null)],
      installmentSatang: s(17_500), termMonths: 324,
      movingCostSatang: 0n as Satang, lockinMonths: 0,
    },
    {
      kind: 'refinance', label: 'รีไฟแนนซ์ คงค่างวด 17,500',
      rateSteps: newPromo,
      installmentSatang: s(17_500), termMonths: 360,
      movingCostSatang: 0n as Satang, lockinMonths: 36,
    },
    {
      kind: 'refinance', label: 'รีไฟแนนซ์ ลดค่างวดเหลือ 15,000',
      rateSteps: newPromo,
      installmentSatang: s(15_000), termMonths: 360,
      movingCostSatang: 0n as Satang, lockinMonths: 36,
    },
  ]

  const out = compareRefinanceOptions(ctx, scenarios)
  const [stay, keep, drop] = out

  it('(ค) ไม่รีไฟแนนซ์ 17,500 -> ดอก 1,826,714 / 255 งวด', () => {
    expect(f0(stay!.futureInterestFixed)).toBe('1,826,714')
    expect(stay!.remainingPeriods).toBe(255)
  })

  it('(ข) รีไฟแนนซ์คงค่างวด 17,500 -> ดอก 1,322,382 / 226 งวด', () => {
    expect(f0(keep!.futureInterestFixed)).toBe('1,322,382')
    expect(keep!.remainingPeriods).toBe(226)
  })

  it('(ก) รีไฟแนนซ์ลดค่างวด 15,000 -> ดอก 1,920,701 / 303 งวด', () => {
    expect(f0(drop!.futureInterestFixed)).toBe('1,920,701')
    expect(drop!.remainingPeriods).toBe(303)
  })

  it('(ข) ประหยัดกว่า (ค) 504,333 บาท — รีไฟแนนซ์คุ้มมากถ้าคงค่างวด', () => {
    expect(f0(keep!.interestSavedVsStayFixed)).toBe('504,333')
    expect(keep!.costsMoreThanStaying).toBe(false)
  })

  it('⚠️ (ก) แพงกว่า (ค) 93,987 บาท — เรตถูกลงแต่จ่ายดอกรวมมากกว่าไม่ทำอะไร', () => {
    expect(f0(drop!.interestSavedVsStayFixed)).toBe('-93,987')
    expect(drop!.costsMoreThanStaying).toBe(true)
  })

  it('engine ต้อง flag เคสลดค่างวดออกมาเป็นคำเตือน ไม่ใช่ซ่อนใน tooltip', () => {
    const { warnings, best } = recommend(out)
    expect(warnings.some((w) => w.includes('ลดค่างวดเหลือ 15,000'))).toBe(true)
    expect(warnings.some((w) => w.includes('จ่ายดอกเบี้ยรวมมากกว่าการไม่ทำอะไรเลย'))).toBe(true)
    expect(best.label).toBe('รีไฟแนนซ์ คงค่างวด 17,500')
  })

  it('ต้องมี baseline "อยู่เฉย ๆ" เสมอ ห้ามตัดออก', () => {
    expect(() => compareRefinanceOptions(ctx, scenarios.filter((x) => x.kind !== 'stay')))
      .toThrow(/ต้องมี scenario kind="stay"/)
  })
})

describe('2A.3 break-even', () => {
  const ctx: RefinanceContext = {
    balanceSatang: s(2_624_036.54),
    asOf: isoDate('2029-10-01'),
    dueDayOfMonth: 1,
    referenceRates: [],
    conventions: defaultConventions('2029-10-01'),
  }

  const withCost = (cost: number, lockin = 36): RefinanceScenario[] => [
    {
      kind: 'stay', label: 'อยู่เฉย ๆ',
      rateSteps: [fixedStep(5.5, 1, null)],
      installmentSatang: s(17_500), termMonths: 324,
      movingCostSatang: 0n as Satang, lockinMonths: 0,
    },
    {
      kind: 'refinance', label: 'ย้ายธนาคาร',
      rateSteps: [fixedStep(3.0, 1, 36), fixedStep(5.5, 37, null)],
      installmentSatang: s(17_500), termMonths: 360,
      movingCostSatang: s(cost), lockinMonths: lockin,
    },
  ]

  it('ต้นทุนย้ายต่ำ -> คืนทุนเร็ว ภายใน lock-in', () => {
    const [, refi] = compareRefinanceOptions(ctx, withCost(50_000))
    expect(refi!.breakevenMonth).not.toBeNull()
    expect(refi!.breakevenMonth!).toBeLessThan(36)
    expect(refi!.breakevenBeyondLockin).toBe(false)
  })

  it('ต้นทุนย้ายสูงมาก -> คืนทุนเลย lock-in ต้องตอบว่าไม่คุ้มตรง ๆ', () => {
    const out = compareRefinanceOptions(ctx, withCost(300_000))
    const refi = out[1]!
    expect(refi.breakevenBeyondLockin).toBe(true)
    const { warnings } = recommend(out)
    expect(warnings.some((w) => w.includes('ต้องรีไฟแนนซ์รอบใหม่อยู่ดี'))).toBe(true)
  })

  it('ต้นทุนย้ายเป็นศูนย์หรือติดลบ -> คืนทุนทันทีตั้งแต่งวดแรก', () => {
    const [, refi] = compareRefinanceOptions(ctx, withCost(0))
    expect(refi!.breakevenMonth).toBe(1)
  })
})

describe('ต้นทุนการย้ายสุทธิ (ข้อ 2A.3)', () => {
  it('เงินเวนคืน MRTA และของแถม เป็นตัวลบ ไม่ใช่ตัวบวก', () => {
    const cost = movingCost({
      prepayPenaltySatang: s(78_721),
      newFeesCashSatang: s(40_000),
      newCreditLifeSatang: s(80_000),
      newFireInsuranceSatang: s(3_000),
      clawbackSatang: s(10_000),
      surrenderRefundSatang: s(35_000),
      newIncentiveSatang: s(20_000),
    })
    expect(fs(cost)).toBe('156,721.00')
  })

  it('ถ้าของแถมมากกว่าค่าใช้จ่าย ต้นทุนติดลบได้ ไม่ต้องปัดเป็น 0', () => {
    const cost = movingCost({
      prepayPenaltySatang: 0n as Satang,
      newFeesCashSatang: s(10_000),
      newCreditLifeSatang: 0n as Satang,
      newFireInsuranceSatang: 0n as Satang,
      clawbackSatang: 0n as Satang,
      surrenderRefundSatang: s(30_000),
      newIncentiveSatang: s(5_000),
    })
    expect(fs(cost)).toBe('-25,000.00')
  })
})

describe('ค่าปรับไถ่ถอน (ข้อ 1.6)', () => {
  it('ยังไม่พ้น lock-in -> คิด 3% ของยอดคงเหลือ', () => {
    expect(fs(prepayPenalty(s(2_624_036.54), bps(300), 24, 36))).toBe('78,721.09')
  })

  it('พ้น lock-in แล้ว -> ไม่มีค่าปรับ', () => {
    expect(prepayPenalty(s(2_624_036.54), bps(300), 36, 36)).toBe(0n)
    expect(prepayPenalty(s(2_624_036.54), bps(300), 48, 36)).toBe(0n)
  })
})

describe('TV-34 ค่างวดใหม่ต่ำกว่าดอกเบี้ย ต้องตีตกไม่ใช่โชว์เป็นทางเลือก', () => {
  // เจอจากการใช้งานจริง: ยอด 3,900,000 ค่างวด 15,000 ที่ 5.50% ดอกเดือนแรกราว 17,800
  // engine จะวนจนชนเพดาน 1,200 งวด แล้วได้ดอกหลักสิบล้าน ซึ่งไปกินสเกลกราฟทั้งใบ
  const ctx: RefinanceContext = {
    balanceSatang: s(3_900_000),
    asOf: isoDate('2029-10-01'),
    dueDayOfMonth: 1,
    referenceRates: [],
    conventions: defaultConventions('2029-10-01'),
  }

  const out = compareRefinanceOptions(ctx, [
    {
      kind: 'stay', label: 'ไม่ทำอะไร',
      rateSteps: [fixedStep(5.5, 1, null)],
      installmentSatang: s(30_000), termMonths: 324,
      movingCostSatang: 0n as Satang, lockinMonths: 0,
    },
    {
      kind: 'refinance', label: 'ลดค่างวดเหลือ 15,000',
      rateSteps: [fixedStep(5.5, 1, null)],
      installmentSatang: s(15_000), termMonths: 360,
      movingCostSatang: s(47_500), lockinMonths: 36,
    },
  ])
  const [stay, tooLow] = out

  it('"ไม่ทำอะไร" ยังเป็นทางเลือกที่จ่ายไหว', () => {
    expect(stay!.feasible).toBe(true)
  })

  it('ค่างวด 15,000 ถูก mark ว่าจ่ายไม่ไหว', () => {
    expect(tooLow!.feasible).toBe(false)
    expect(tooLow!.infeasibleReason).toBeTruthy()
  })

  it('บอกค่างวดขั้นต่ำที่ปิดหนี้ได้ใน 360 งวด', () => {
    // PMT(3,900,000, 5.50%, 360) ราว 22,140
    expect(Number(tooLow!.minInstallmentSatang) / 100).toBeGreaterThan(20_000)
    expect(Number(tooLow!.minInstallmentSatang) / 100).toBeLessThan(25_000)
  })

  it('⛔ ห้ามเลือกเป็นทางที่ดีที่สุด แม้ดูเหมือนจ่ายน้อยกว่าต่อเดือน', () => {
    const { best, warnings } = recommend(out)
    expect(best.feasible).toBe(true)
    expect(best.label).toBe('ไม่ทำอะไร')
    expect(warnings.some((w) => w.includes('จ่ายอย่างน้อย'))).toBe(true)
  })

  it('ไม่ถูกนับเป็น "ยืดเทอมแล้วแพงกว่า" ซ้ำ เพราะคนละปัญหากัน', () => {
    expect(tooLow!.costsMoreThanStaying).toBe(false)
  })
})
