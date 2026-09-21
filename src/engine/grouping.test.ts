import { describe, it, expect } from 'vitest'
import { buildSchedule } from './schedule.js'
import { makeTerms, fixedStep } from './test-helpers.js'
import { baht, formatFixedBaht, type Satang, type Fixed } from './money.js'
import { isoDate } from './date.js'
import {
  groupSchedule, effectiveRateOf, arithmeticMeanRateBps,
  summariseTaxYears, TAX_DEDUCTION_CAP_SATANG,
} from './grouping.js'
import type { PrepayPlan } from './prepay.js'

const f = (v: Fixed) => formatFixedBaht(v)
const f0 = (v: Fixed) => formatFixedBaht(v, 0)
const s = (n: number): Satang => baht(n)

/** ตารางของ TV-21 ใช้เป็นฐานของ TV-24..27 ทั้งหมด */
const plan: PrepayPlan = {
  baseYear: 2027,
  repeatMode: 'repeat_forever',
  repeatUntilYear: null,
  months: {
    1: s(5_000), 2: s(5_500), 3: s(5_000),
    4: s(4_000), 5: s(4_000), 6: s(4_000), 7: s(4_000),
    8: s(4_000), 9: s(4_000), 10: s(4_000), 11: s(4_000), 12: s(0),
  },
  overrides: {},
  lumps: [],
}

const terms = makeTerms({
  principalBaht: 3_000_000,
  startDate: isoDate('2025-04-01'),
  dueDayOfMonth: 1,
  installmentBaht: 20_000,
  rateSteps: [
    fixedStep(2.50, 1, 12),
    fixedStep(3.25, 13, 24),
    fixedStep(3.75, 25, 36),
    fixedStep(4.83, 37, null),
  ],
})

const { rows } = buildSchedule(terms, [], plan)

describe('TV-24 ปีสัญญา: เรตที่จ่ายจริงต้องตรงกับที่ตกลง', () => {
  const groups = groupSchedule(rows, 'contract_year')

  it('เรตถ่วงน้ำหนัก 4 ปีแรก = 2.50 / 3.25 / 3.75 / 4.83', () => {
    const got = groups.slice(0, 4).map((g) => (g.effectiveRateBps / 100).toFixed(2))
    expect(got).toEqual(['2.50', '3.25', '3.75', '4.83'])
  })

  it('ดอกเบี้ยรายปีสัญญา = 73,104 / 89,779 / 96,910 / 115,708', () => {
    const got = groups.slice(0, 4).map((g) => f0(g.interestFixed))
    expect(got).toEqual(['73,104', '89,779', '96,910', '115,708'])
  })

  it('4 ปีแรกครบ 12 งวด ไม่ใช่ปีไม่เต็ม', () => {
    for (const g of groups.slice(0, 4)) {
      expect(g.periodCount).toBe(12)
      expect(g.isPartialYear).toBe(false)
    }
  })

  it('ปีสุดท้ายไม่ครบ 12 งวด ต้องติดป้าย', () => {
    const last = groups[groups.length - 1]!
    expect(last.periodCount).toBeLessThan(12)
    expect(last.isPartialYear).toBe(true)
  })
})

describe('TV-25 สองแกนต้องรวมได้เท่ากันทุกสตางค์', () => {
  const byContract = groupSchedule(rows, 'contract_year')
  const byCalendar = groupSchedule(rows, 'calendar_year')

  const total = (gs: ReturnType<typeof groupSchedule>, pick: (g: (typeof gs)[number]) => Fixed) =>
    gs.reduce((a, g) => (a + pick(g)) as Fixed, 0n as Fixed)

  it('ดอกเบี้ยรวมเท่ากัน', () => {
    expect(total(byContract, (g) => g.interestFixed))
      .toBe(total(byCalendar, (g) => g.interestFixed))
  })

  it('เงินต้นรวมเท่ากัน', () => {
    expect(total(byContract, (g) => g.principalFixed))
      .toBe(total(byCalendar, (g) => g.principalFixed))
  })

  it('ยอดจ่ายรวมเท่ากัน', () => {
    expect(total(byContract, (g) => g.paymentFixed))
      .toBe(total(byCalendar, (g) => g.paymentFixed))
  })

  it('จำนวนงวดรวมเท่ากันและเท่ากับตารางต้นทาง', () => {
    const a = byContract.reduce((n, g) => n + g.periodCount, 0)
    const b = byCalendar.reduce((n, g) => n + g.periodCount, 0)
    expect(a).toBe(b)
    expect(a).toBe(rows.length)
  })

  it('ทั้งสองแกนมาจากตารางชุดเดียวกัน — ทุกงวดต้องถูกนับพอดีครั้งเดียว', () => {
    const idsA = byContract.flatMap((g) => g.rows.map((r) => r.index)).sort((x, y) => x - y)
    const idsB = byCalendar.flatMap((g) => g.rows.map((r) => r.index)).sort((x, y) => x - y)
    const expected = rows.map((r) => r.index)
    expect(idsA).toEqual(expected)
    expect(idsB).toEqual(expected)
  })
})

describe('TV-26 ปีปฏิทิน: เพดานลดหย่อน', () => {
  const groups = groupSchedule(rows, 'calendar_year')
  const byYear = new Map(groups.map((g) => [g.key, g]))

  it('2025 มี 8 งวด ดอก 49,330 และต้องติดป้ายว่าเป็นปีไม่เต็ม', () => {
    const g = byYear.get(2025)!
    expect(g.periodCount).toBe(8)
    expect(f0(g.interestFixed)).toBe('49,330')
    expect(g.isPartialYear).toBe(true)
  })

  it('2028 / 2029 / 2030 เกินเพดาน 100,000', () => {
    expect(f0(byYear.get(2028)!.interestFixed)).toBe('109,770')
    expect(f0(byYear.get(2029)!.interestFixed)).toBe('110,082')
    expect(f0(byYear.get(2030)!.interestFixed)).toBe('101,321')
  })

  it('รวมส่วนที่ใช้สิทธิไม่ได้ = 21,172.42', () => {
    const summaries = summariseTaxYears([{ loanId: 'A', rows }])
    const excess = summaries.reduce((a, x) => (a + x.excessFixed) as Fixed, 0n as Fixed)
    expect(f(excess)).toBe('21,172.42')
  })

  it('ป้ายปีใช้ พ.ศ. ตามที่ตัดสินใจในข้อ 5.3', () => {
    expect(byYear.get(2028)!.label).toBe('ปี 2571')
  })
})

describe('TV-27 ห้ามเฉลี่ยอัตราแบบเลขคณิต', () => {
  it('โครงสร้าง 2.50 / 3.25 / 3.75 -> ธนาคารโฆษณา 3.17% แต่จ่ายจริง 3.14%', () => {
    const first36 = rows.slice(0, 36)

    const arithmetic = arithmeticMeanRateBps([250, 325, 375])
    expect((arithmetic / 100).toFixed(2)).toBe('3.17')

    const weighted = effectiveRateOf(first36)
    expect((weighted / 100).toFixed(2)).toBe('3.14')

    expect(weighted).not.toBeCloseTo(arithmetic, 0)
  })

  it('ดอกเบี้ยรวม 36 งวดแรก = 259,793', () => {
    expect(f0(rows.slice(0, 36).reduce((a, r) => (a + r.interestFixed) as Fixed, 0n as Fixed)))
      .toBe('259,793')
  })
})

describe('TV-30 เพดานลดหย่อนต้องรวมข้ามสัญญา', () => {
  /** สร้างตารางปลอมที่มีดอกเบี้ยตามต้องการในปีเดียว เพื่อทดสอบการรวมเพดาน */
  const fakeRows = (interestBaht: number) => [{
    index: 1,
    date: isoDate('2028-06-01'),
    nominalDate: isoDate('2028-06-01'),
    accrualFrom: isoDate('2028-05-01'),
    accrualDays: 31,
    effectiveRateBps: 0,
    paymentFixed: 0n as Fixed,
    prepayFixed: 0n as Fixed,
    interestFixed: (BigInt(interestBaht) * 100n * 1_000_000_000_000n) as Fixed,
    interestPaidFixed: 0n as Fixed,
    principalFixed: 0n as Fixed,
    accruedCarriedFixed: 0n as Fixed,
    balanceAfterFixed: 0n as Fixed,
    flags: [],
  }]

  it('บ้าน A 85,000 + บ้าน B 60,000 -> ใช้สิทธิได้ 100,000 ไม่ใช่ 145,000', () => {
    const [y] = summariseTaxYears([
      { loanId: 'A', rows: fakeRows(85_000) },
      { loanId: 'B', rows: fakeRows(60_000) },
    ])
    expect(f0(y!.totalInterestFixed)).toBe('145,000')
    expect(f0(y!.deductibleFixed)).toBe('100,000')
    expect(f0(y!.excessFixed)).toBe('45,000')
  })

  it('รายงานส่วนร่วมของแต่ละสัญญาได้ เพื่อให้หน้าสัญญาเดี่ยวไม่แสดงมิเตอร์เต็ม 100,000 ของตัวเอง', () => {
    const [y] = summariseTaxYears([
      { loanId: 'A', rows: fakeRows(85_000) },
      { loanId: 'B', rows: fakeRows(60_000) },
    ])
    const a = y!.byLoan.find((x) => x.loanId === 'A')!
    expect(f0(a.interestFixed)).toBe('85,000')
    // A มีส่วนร่วม 85,000 จากเพดานรวม 100,000 — ไม่ใช่ 85,000/100,000 ของตัวเอง
    expect(a.interestFixed < y!.deductibleFixed).toBe(true)
  })

  it('สัญญาเดียวที่ยังไม่ถึงเพดาน ใช้สิทธิได้เต็มจำนวนที่จ่าย', () => {
    const [y] = summariseTaxYears([{ loanId: 'A', rows: fakeRows(70_000) }])
    expect(f0(y!.deductibleFixed)).toBe('70,000')
    expect(y!.excessFixed).toBe(0n)
  })

  it('เพดานคือ 100,000 บาท', () => {
    expect(TAX_DEDUCTION_CAP_SATANG).toBe(10_000_000n)
  })
})
