import { describe, it, expect } from 'vitest'
import { buildSchedule } from './schedule.js'
import { makeTerms, fixedStep } from './test-helpers.js'
import { baht, formatFixedBaht, toFixed, type Satang, type Fixed } from './money.js'
import { isoDate } from './date.js'
import {
  resolveMonthlyPrepay, resolvePrepayOn, resolveLumpsOn,
  planCoversYear, copyYearToOverrides, emptyPlan, type PrepayPlan,
} from './prepay.js'

const f = (v: Fixed) => formatFixedBaht(v)
const s = (n: number): Satang => baht(n)

/** แผนของ TV-21: ม.ค. 5,000 / ก.พ. 5,500 / มี.ค. 5,000 / เม.ย.-พ.ย. 4,000 / ธ.ค. 0 */
const tv21Months: Record<number, Satang> = {
  1: s(5_000), 2: s(5_500), 3: s(5_000),
  4: s(4_000), 5: s(4_000), 6: s(4_000), 7: s(4_000),
  8: s(4_000), 9: s(4_000), 10: s(4_000), 11: s(4_000),
  12: s(0),
}

describe('TV-21 แผนโปะไม่เท่ากันรายเดือน', () => {
  // เริ่ม 2025-04-01 ตัดวันที่ 1 -> งวด 21 ครบกำหนด 2027-01-01 = ม.ค. ปีฐาน 2027 พอดี
  const plan: PrepayPlan = {
    baseYear: 2027,
    repeatMode: 'repeat_forever',
    repeatUntilYear: null,
    months: tv21Months,
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

  it('รวม 170 งวด ปิด 2039-06-01 ดอกเบี้ยรวม 990,216.93', () => {
    const r = buildSchedule(terms, [], plan)
    expect(r.rows).toHaveLength(170)
    expect(r.rows[r.rows.length - 1]!.date).toBe(isoDate('2039-06-01'))
    expect(f(r.totalInterestFixed)).toBe('990,216.93')
    expect(r.paidOff).toBe(true)
  })

  it('งวด 1-20 ยังไม่โปะ งวด 21 เริ่มโปะ 5,000 (ม.ค. 2027)', () => {
    const { rows } = buildSchedule(terms, [], plan)
    expect(rows.slice(0, 20).every((x) => x.prepayFixed === 0n)).toBe(true)
    expect(rows[20]!.date).toBe(isoDate('2027-01-01'))
    expect(f(rows[20]!.prepayFixed)).toBe('5,000.00')
    expect(rows[20]!.flags).toContain('prepay')
  })

  it('เดือน ธ.ค. ไม่โปะ ตามแผน', () => {
    const { rows } = buildSchedule(terms, [], plan)
    const dec2027 = rows.find((x) => x.date === isoDate('2027-12-01'))!
    expect(dec2027.prepayFixed).toBe(0n)
    expect(dec2027.flags).not.toContain('prepay')
  })

  it('ก.พ. โปะ 5,500 ต่างจากเดือนอื่น', () => {
    const { rows } = buildSchedule(terms, [], plan)
    const feb = rows.find((x) => x.date === isoDate('2028-02-01'))!
    expect(f(feb.prepayFixed)).toBe('5,500.00')
  })

  it('การโปะช่วยได้จริง — เทียบกับไม่โปะเลย', () => {
    const withPlan = buildSchedule(terms, [], plan)
    const without = buildSchedule(terms)
    expect(withPlan.rows.length).toBeLessThan(without.rows.length)
    expect(withPlan.totalInterestFixed).toBeLessThan(without.totalInterestFixed)
  })

  it('invariant: เงินต้นรวม = วงเงินตั้งต้น และยอดจ่าย = ดอก + ต้น', () => {
    const r = buildSchedule(terms, [], plan)
    expect(r.totalPrincipalFixed).toBe(toFixed(baht(3_000_000)))
    expect(r.totalPaymentFixed).toBe(r.totalInterestFixed + r.totalPrincipalFixed)
    expect(r.rows[r.rows.length - 1]!.balanceAfterFixed).toBe(0n)
  })
})

describe('TV-22 การ resolve ยอดโปะ', () => {
  const base: PrepayPlan = {
    baseYear: 2027,
    repeatMode: 'repeat_forever',
    repeatUntilYear: null,
    months: tv21Months,
    overrides: {},
    lumps: [],
  }

  it('override ต้องชนะ prepay_months', () => {
    const plan: PrepayPlan = { ...base, overrides: { 2029: { 1: s(9_999) } } }
    expect(resolveMonthlyPrepay(plan, 2028, 1)).toBe(s(5_000)) // ปีอื่นใช้แผนฐาน
    expect(resolveMonthlyPrepay(plan, 2029, 1)).toBe(s(9_999)) // ปีที่ override ชนะ
    expect(resolveMonthlyPrepay(plan, 2029, 2)).toBe(s(5_500)) // เดือนที่ไม่ override ใช้แผนฐาน
  })

  it('override เป็น 0 ได้ ต้องไม่ตกกลับไปใช้แผนฐาน', () => {
    const plan: PrepayPlan = { ...base, overrides: { 2029: { 1: s(0) } } }
    expect(resolveMonthlyPrepay(plan, 2029, 1)).toBe(s(0))
  })

  it('lumps ต้อง "บวกเพิ่ม" ไม่ใช่ "แทนที่"', () => {
    const plan: PrepayPlan = {
      ...base,
      lumps: [{ payDate: isoDate('2028-01-01'), amountSatang: s(50_000), label: 'โบนัส' }],
    }
    expect(resolveMonthlyPrepay(plan, 2028, 1)).toBe(s(5_000))
    expect(resolveLumpsOn(plan, isoDate('2028-01-01'))).toBe(s(50_000))
    expect(resolvePrepayOn(plan, isoDate('2028-01-01'))).toBe(s(55_000)) // 5,000 + 50,000
  })

  it('หลายก้อนในวันเดียว ต้องบวกรวมทั้งหมด', () => {
    const plan: PrepayPlan = {
      ...base,
      lumps: [
        { payDate: isoDate('2028-03-01'), amountSatang: s(10_000) },
        { payDate: isoDate('2028-03-01'), amountSatang: s(20_000) },
        { payDate: isoDate('2028-04-01'), amountSatang: s(7_000) },
      ],
    }
    expect(resolvePrepayOn(plan, isoDate('2028-03-01'))).toBe(s(35_000)) // 5,000 + 10,000 + 20,000
    expect(resolvePrepayOn(plan, isoDate('2028-04-01'))).toBe(s(11_000)) // 4,000 + 7,000
  })

  it('override + lump ซ้อนกัน ต้องเป็น override แล้วบวก lump', () => {
    const plan: PrepayPlan = {
      ...base,
      overrides: { 2029: { 5: s(1_000) } },
      lumps: [{ payDate: isoDate('2029-05-01'), amountSatang: s(30_000) }],
    }
    expect(resolvePrepayOn(plan, isoDate('2029-05-01'))).toBe(s(31_000))
  })

  it('lump ที่ไม่ตรงวันตัด ต้องไม่ถูกดึงมา', () => {
    const plan: PrepayPlan = {
      ...base,
      lumps: [{ payDate: isoDate('2028-01-15'), amountSatang: s(50_000) }],
    }
    expect(resolvePrepayOn(plan, isoDate('2028-01-01'))).toBe(s(5_000))
    expect(resolveLumpsOn(plan, isoDate('2028-01-15'))).toBe(s(50_000))
  })
})

describe('repeatMode', () => {
  const mk = (mode: PrepayPlan['repeatMode'], until: number | null = null): PrepayPlan => ({
    baseYear: 2027, repeatMode: mode, repeatUntilYear: until,
    months: tv21Months, overrides: {}, lumps: [],
  })

  it('single_year ใช้เฉพาะปีฐาน', () => {
    const p = mk('single_year')
    expect(planCoversYear(p, 2026)).toBe(false)
    expect(planCoversYear(p, 2027)).toBe(true)
    expect(planCoversYear(p, 2028)).toBe(false)
  })

  it('repeat_forever ใช้ตั้งแต่ปีฐานเป็นต้นไป', () => {
    const p = mk('repeat_forever')
    expect(planCoversYear(p, 2026)).toBe(false)
    expect(planCoversYear(p, 2050)).toBe(true)
  })

  it('repeat_until หยุดตามปีที่กำหนด', () => {
    const p = mk('repeat_until', 2030)
    expect(planCoversYear(p, 2030)).toBe(true)
    expect(planCoversYear(p, 2031)).toBe(false)
  })

  it('ปีก่อนปีฐานไม่โปะ ไม่ว่าโหมดไหน', () => {
    for (const m of ['single_year', 'repeat_forever', 'repeat_until'] as const) {
      expect(resolveMonthlyPrepay(mk(m, 2050), 2026, 1)).toBe(s(0))
    }
  })
})

describe('คัดลอกไปปีถัดไป', () => {
  it('สร้าง override ชุดใหม่จากยอดที่ resolve ได้ของปีต้นทาง', () => {
    const plan: PrepayPlan = {
      baseYear: 2027, repeatMode: 'repeat_forever', repeatUntilYear: null,
      months: tv21Months, overrides: { 2028: { 1: s(8_000) } }, lumps: [],
    }
    const copied = copyYearToOverrides(plan, 2028, 2029)
    expect(resolveMonthlyPrepay(copied, 2029, 1)).toBe(s(8_000))  // มาจาก override ของ 2028
    expect(resolveMonthlyPrepay(copied, 2029, 2)).toBe(s(5_500))  // มาจากแผนฐาน
    expect(resolveMonthlyPrepay(plan, 2029, 1)).toBe(s(5_000))    // ของเดิมไม่ถูกแก้
  })
})

describe('guard: แผนโปะเกินหนี้', () => {
  it('ยอดโปะมหาศาลต้องตัดพอดีที่ 0 ไม่ติดลบ', () => {
    const plan = {
      ...emptyPlan(2027),
      months: { 1: s(5_000_000) } as Record<number, Satang>,
    }
    const r = buildSchedule(makeTerms({ startDate: isoDate('2026-10-01') }), [], plan)
    for (const row of r.rows) {
      expect(row.balanceAfterFixed >= 0n, `งวด ${row.index}`).toBe(true)
    }
    expect(r.rows[r.rows.length - 1]!.balanceAfterFixed).toBe(0n)
    expect(r.totalPrincipalFixed).toBe(toFixed(baht(3_000_000)))
  })
})
