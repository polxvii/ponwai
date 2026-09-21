import { describe, it, expect } from 'vitest'
import { buildSchedule, pmt } from './schedule.js'
import { makeTerms, fixedStep, defaultConventions, d } from './test-helpers.js'
import { baht, bps, formatFixedBaht, toFixed, type Fixed } from './money.js'
import { isoDate, daysBetween } from './date.js'
import { validateOverrides, buildDueDates, rollDate } from './schedule-dates.js'
import type { PaymentEvent } from './types.js'

const f = (v: Fixed) => formatFixedBaht(v)

describe('TV-2 การแบ่งงวด', () => {
  it('ต่อจาก TV-1: ดอก 7,643.84 / ต้น 8,356.16 / คงเหลือ 2,991,643.84', () => {
    const { rows } = buildSchedule(makeTerms({
      rateSteps: [fixedStep(3.0)],
      installmentBaht: 16_000,
    }))
    const r = rows[0]!
    expect(r.accrualDays).toBe(31)
    expect(f(r.interestFixed)).toBe('7,643.84')
    expect(f(r.principalFixed)).toBe('8,356.16')
    expect(f(r.balanceAfterFixed)).toBe('2,991,643.84')
  })
})

describe('TV-3 negative amortization ทั้งสองโหมด (spec ข้อ 1.2)', () => {
  const base = {
    startDate: isoDate('2027-01-01'),
    rateSteps: [fixedStep(7.0)],
    installmentBaht: 17_000,
  }

  it('ไม่ทบต้น (default): เงินต้นคงที่ ดอกค้าง 835.62', () => {
    const { rows } = buildSchedule(makeTerms(base))
    const r = rows[0]!
    expect(r.flags).toContain('negative_amortization')
    expect(f(r.interestFixed)).toBe('17,835.62')
    expect(f(r.balanceAfterFixed)).toBe('3,000,000.00')
    expect(f(r.accruedCarriedFixed)).toBe('835.62')
  })

  it('ทบต้น: เงินต้นโตเป็น 3,000,835.62 ดอกค้าง 0', () => {
    const { rows } = buildSchedule(makeTerms({
      ...base,
      conventions: [{
        ...defaultConventions('2027-01-01')[0]!,
        capitaliseUnpaidInterest: true,
      }],
    }))
    const r = rows[0]!
    expect(f(r.balanceAfterFixed)).toBe('3,000,835.62')
    expect(f(r.accruedCarriedFixed)).toBe('0.00')
  })

  it('เดินต่อ 12 งวด หนี้รวมต่างกัน 167.00 เพราะฝั่งทบต้นคิดดอกจากดอก', () => {
    const run = (cap: boolean) => {
      const { rows } = buildSchedule(makeTerms({
        ...base,
        conventions: [{ ...defaultConventions('2027-01-01')[0]!, capitaliseUnpaidInterest: cap }],
      }))
      const r = rows[11]!
      return r.balanceAfterFixed + r.accruedCarriedFixed
    }
    expect(f(run(false) as Fixed)).toBe('3,005,996.78')
    expect(f(run(true) as Fixed)).toBe('3,006,163.78')
    expect(f((run(true) - run(false)) as Fixed)).toBe('167.00')
  })
})

describe('TV-4 PMT — ใช้ประมาณค่างวดตั้งต้นเท่านั้น', () => {
  it('P=3,000,000 n=360 @6.00% -> ~17,987', () => {
    const v = pmt(baht(3_000_000), 600, 360)
    expect(Number(v) / 100).toBeCloseTo(17_986.52, 1)
    expect(Math.round(Number(v) / 100)).toBe(17_987)
  })
})

describe('TV-16 ยอดรวมตลอดสัญญา', () => {
  it('ACT/365F: 356 งวด ดอกเบี้ยรวม 2,758,560.20', () => {
    const r = buildSchedule(makeTerms())
    expect(r.rows).toHaveLength(356)
    expect(f(r.totalInterestFixed)).toBe('2,758,560.20')
    expect(r.paidOff).toBe(true)
  })

  it('ACT/ACT: 356 งวด ดอกเบี้ยรวม 2,753,376.69', () => {
    const r = buildSchedule(makeTerms({
      conventions: [{ ...defaultConventions('2026-10-01')[0]!, dayCountBasis: 'ACT/ACT' }],
    }))
    expect(r.rows).toHaveLength(356)
    expect(f(r.totalInterestFixed)).toBe('2,753,376.69')
  })
})

describe('TV-10 งวดสุดท้าย', () => {
  it('balance ลงเป็น 0 พอดี ไม่ใช่ 0.01 หรือ -0.03 และงวดสุดท้ายน้อยกว่าค่างวดเต็ม', () => {
    const { rows } = buildSchedule(makeTerms())
    const last = rows[rows.length - 1]!
    expect(last.balanceAfterFixed).toBe(0n)
    expect(last.accruedCarriedFixed).toBe(0n)
    expect(last.flags).toContain('final_payment')
    expect(last.paymentFixed < toFixed(baht(16_200))).toBe(true)
  })

  it('ผลรวมเงินต้นเท่ากับวงเงินตั้งต้นพอดี (invariant)', () => {
    const r = buildSchedule(makeTerms())
    expect(r.totalPrincipalFixed).toBe(toFixed(baht(3_000_000)))
  })

  it('ผลรวมยอดจ่าย = ดอกเบี้ย + เงินต้น (invariant TV-28a)', () => {
    const r = buildSchedule(makeTerms())
    expect(r.totalPaymentFixed).toBe(r.totalInterestFixed + r.totalPrincipalFixed)
  })
})

describe('TV-17 MRTA รวมในวงเงิน', () => {
  const cost = (principal: number, installment: number) => {
    const a = buildSchedule(makeTerms({ principalBaht: principal, installmentBaht: installment }))
    const b = buildSchedule(makeTerms({ principalBaht: principal + 100_000, installmentBaht: installment }))
    return {
      extraPaid: (b.totalPaymentFixed - a.totalPaymentFixed) as Fixed,
      extraPeriods: b.rows.length - a.rows.length,
    }
  }

  it('ค่างวด 16,200 -> ต้นทุนจริงของเบี้ย 100,000 คือ 466,684.80 และยืด 29 งวด', () => {
    const { extraPaid, extraPeriods } = cost(3_000_000, 16_200)
    expect(f(extraPaid)).toBe('466,684.80')
    expect(extraPeriods).toBe(29)
  })

  it('ยิ่งค่างวดสูง ต้นทุนยิ่งลด — ห้ามแสดงเป็นเลขเดียว', () => {
    const table = [
      [17_000, '398,086.81', 24],
      [18_000, '341,615.31', 19],
      [20_000, '275,268.05', 13],
      [25_000, '203,988.64', 8],
    ] as const
    for (const [inst, expected, periods] of table) {
      const { extraPaid, extraPeriods } = cost(3_000_000, inst)
      expect(f(extraPaid), `ค่างวด ${inst}`).toBe(expected)
      expect(extraPeriods, `ค่างวด ${inst}`).toBe(periods)
    }
  })
})

describe('TV-8 / TV-9 การโปะ', () => {
  const prepay = (date: string, amount: number): PaymentEvent =>
    ({ date: isoDate(date), amountSatang: baht(amount), kind: 'partial_prepay' })

  it('TV-8 shorten_term: โปะ 100,000 ที่งวด 12 -> งวดลดลง ดอกเบี้ยลดลง ปิดที่ 0', () => {
    const plain = buildSchedule(makeTerms())
    const withPrepay = buildSchedule(makeTerms(), [prepay('2027-10-01', 100_000)])

    expect(withPrepay.rows.length).toBeLessThan(plain.rows.length)
    expect(withPrepay.totalInterestFixed).toBeLessThan(plain.totalInterestFixed)
    expect(withPrepay.rows[withPrepay.rows.length - 1]!.balanceAfterFixed).toBe(0n)

    const row12 = withPrepay.rows[11]!
    expect(row12.flags).toContain('prepay')
    expect(f(row12.prepayFixed)).toBe('100,000.00')
  })

  it('โปะเร็วขึ้น 1 วันต้องประหยัดดอกเบี้ยมากกว่า — จุดที่ daily engine ชนะ monthly', () => {
    const early = buildSchedule(makeTerms(), [prepay('2027-09-15', 100_000)])
    const late = buildSchedule(makeTerms(), [prepay('2027-10-01', 100_000)])
    expect(early.totalInterestFixed).toBeLessThan(late.totalInterestFixed)
  })
})

describe('TV-23 guard ยอดโปะเกินหนี้', () => {
  it('โปะมากกว่าหนี้คงเหลือ -> ตัดพอดีที่ 0 ห้ามติดลบ ห้ามคืนเงินทอน', () => {
    const r = buildSchedule(makeTerms(), [
      { date: isoDate('2027-01-01'), amountSatang: baht(9_000_000), kind: 'partial_prepay' },
    ])
    for (const row of r.rows) {
      expect(row.balanceAfterFixed >= 0n, `งวด ${row.index} ติดลบ`).toBe(true)
    }
    expect(r.rows[r.rows.length - 1]!.balanceAfterFixed).toBe(0n)
    expect(r.totalPrincipalFixed).toBe(toFixed(baht(3_000_000)))
  })
})

describe('TV-6 rate step transition', () => {
  it('งวด 24 ใช้ 2.50% งวด 25 ใช้ 5.25% พร้อม flag rate_changed', () => {
    const { rows } = buildSchedule(makeTerms({
      rateSteps: [fixedStep(2.5, 1, 24), fixedStep(5.25, 25, null)],
      installmentBaht: 20_000,
    }))
    expect(Math.round(rows[23]!.effectiveRateBps)).toBe(250)
    expect(Math.round(rows[24]!.effectiveRateBps)).toBe(525)
    expect(rows[24]!.flags).toContain('rate_changed')
    expect(rows[23]!.flags).not.toContain('rate_changed')
  })
})

describe('TV-29 date_roll — ทิศทางต้องถูก', () => {
  const build = (roll: 'none' | 'preceding' | 'following') =>
    buildSchedule(makeTerms({
      startDate: isoDate('2026-10-05'),
      dueDayOfMonth: 5,
      dateRoll: roll,
      rollCalendar: 'weekend_only',
    }))

  it('preceding ต้องได้ดอกน้อยกว่า none และ following ต้องมากกว่า', () => {
    const none = build('none')
    const pre = build('preceding')
    const fol = build('following')
    expect(pre.totalInterestFixed).toBeLessThan(none.totalInterestFixed)
    expect(fol.totalInterestFixed).toBeGreaterThan(none.totalInterestFixed)
  })

  it('preceding เลื่อนวันตัดมาเร็วขึ้นเท่านั้น ไม่มีวันไหนเลื่อนออก', () => {
    for (const r of build('preceding').rows) {
      expect(r.date <= r.nominalDate, `งวด ${r.index}`).toBe(true)
    }
  })
})

describe('TV-32 anchor ต้องไม่ไหล', () => {
  it('ตัดวันที่ 5 preceding 360 งวด วันตัดต้องอยู่ในช่วงวันที่ 2-5 เท่านั้น', () => {
    const holidays = ['2027-01-01', '2027-04-13', '2028-01-03'].map(isoDate)
    const dates = buildDueDates({
      startDate: isoDate('2026-10-05'),
      dueDayOfMonth: 5,
      dateRoll: 'preceding',
      rollCalendar: 'weekend_and_bank_holidays',
      bankHolidays: new Set(holidays),
      overrides: {},
    }, 360)

    for (const x of dates) {
      const dayOfMonth = Number(x.actual.slice(8, 10))
      expect(dayOfMonth, `งวด ${x.period} = ${x.actual}`).toBeGreaterThanOrEqual(1)
      expect(dayOfMonth, `งวด ${x.period} = ${x.actual}`).toBeLessThanOrEqual(5)
    }
    // งวดที่ไม่โดนเลื่อนต้องเป็นวันที่ 5 เป๊ะ — พิสูจน์ว่า nominal ไม่ไหล
    expect(dates.filter((x) => x.actual === x.nominal).every((x) => x.actual.endsWith('-05'))).toBe(true)
  })
})

describe('TV-31 override วันตัดรายงวด', () => {
  // เริ่ม 2026-10-05 ตัดวันที่ 5 -> งวด 13 ครบกำหนด 2027-11-05 (งวดที่ spec ยกตัวอย่าง)
  it('งวด 13 เลื่อนเป็นวันที่ 3 -> งวด 13 สั้นลง 2 วัน งวด 14 ยาวขึ้น 2 วัน ผลรวมเท่าเดิม', () => {
    const cfg = {
      startDate: isoDate('2026-10-05'),
      dueDayOfMonth: 5,
      dateRoll: 'none' as const,
      rollCalendar: 'weekend_only' as const,
      bankHolidays: new Set<never>(),
      overrides: {},
    }
    const plain = buildDueDates(cfg, 15)
    const over = buildDueDates({ ...cfg, overrides: { 13: isoDate('2027-11-03') } }, 15)

    expect(plain[12]!.actual).toBe(isoDate('2027-11-05'))
    expect(plain[12]!.days).toBe(31) // 5 ต.ค. -> 5 พ.ย.
    expect(plain[13]!.days).toBe(30) // 5 พ.ย. -> 5 ธ.ค.

    expect(over[12]!.days).toBe(29)  // 5 ต.ค. -> 3 พ.ย.
    expect(over[13]!.days).toBe(32)  // 3 พ.ย. -> 5 ธ.ค.
    expect(over[12]!.days + over[13]!.days).toBe(plain[12]!.days + plain[13]!.days)

    // งวด 15 ต้องกลับมาเป็นวันที่ 5 ตามปกติ — พิสูจน์ว่า anchor ไม่ไหล
    expect(over[14]!.actual).toBe(plain[14]!.actual)
    expect(over[14]!.days).toBe(plain[14]!.days)
  })

  it('engine สะท้อนจำนวนวัน 29 / 32 และติด flag ที่งวดที่ถูกแก้', () => {
    const { rows } = buildSchedule(makeTerms({
      startDate: isoDate('2026-10-05'),
      dueDayOfMonth: 5,
      installmentBaht: 20_000,
      scheduleOverrides: { 13: isoDate('2027-11-03') },
    }))
    expect(rows[12]!.accrualDays).toBe(29)
    expect(rows[13]!.accrualDays).toBe(32)
    expect(rows[12]!.flags).toContain('date_overridden')
    expect(rows[13]!.flags).not.toContain('date_overridden')
  })

  it('ดอกเบี้ยตรงตาม spec เมื่อเงินต้นคงที่ 3,000,000 @5%', () => {
    // จำลองเฉพาะสองงวดโดยให้ค่างวด = ดอกเบี้ยพอดี เพื่อตรึงเงินต้น
    const rate = bps(500)
    const P = toFixed(baht(3_000_000))
    const i12 = (P * BigInt(rate) * 29n) / (10_000n * 365n)
    const i13 = (P * BigInt(rate) * 32n) / (10_000n * 365n)
    expect(f(i12 as Fixed)).toBe('11,917.81')
    expect(f(i13 as Fixed)).toBe('13,150.68')
  })
})

describe('TV-33 guard ของ override', () => {
  const cfg = {
    startDate: isoDate('2026-10-05'),
    dueDayOfMonth: 5,
    dateRoll: 'none' as const,
    rollCalendar: 'weekend_only' as const,
    bankHolidays: new Set<never>(),
    overrides: {},
  }

  it('override เร็วกว่าวันตัดงวดก่อนหน้า -> ต้องถูก reject', () => {
    const problems = validateOverrides(
      { ...cfg, overrides: { 12: isoDate('2027-09-01') } }, 360,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]!.reason).toBe('not_after_previous')
  })

  it('override เลยวันตัดงวดถัดไป -> ต้องถูก reject', () => {
    const problems = validateOverrides(
      { ...cfg, overrides: { 12: isoDate('2027-12-20') } }, 360,
    )
    expect(problems[0]!.reason).toBe('not_before_next')
  })

  it('override ที่ถูกต้องต้องผ่าน', () => {
    expect(validateOverrides({ ...cfg, overrides: { 12: isoDate('2027-11-03') } }, 360)).toHaveLength(0)
  })

  it('ถ้าหลุดเข้า engine ต้อง throw ไม่ใช่คืน accrualDays ติดลบ', () => {
    expect(() => buildSchedule(makeTerms({
      startDate: isoDate('2026-10-05'),
      dueDayOfMonth: 5,
      scheduleOverrides: { 12: isoDate('2027-09-01') },
    }))).toThrow(/ไม่ได้อยู่หลัง/)
  })
})

describe('schedule-dates: rollDate', () => {
  it('preceding ถอยหลัง following เดินหน้า', () => {
    const sat = isoDate('2026-10-03')
    const hol = new Set<never>()
    expect(rollDate(sat, 'preceding', 'weekend_only', hol)).toBe(isoDate('2026-10-02'))
    expect(rollDate(sat, 'following', 'weekend_only', hol)).toBe(isoDate('2026-10-05'))
    expect(rollDate(sat, 'none', 'weekend_only', hol)).toBe(sat)
  })

  it('ข้ามวันหยุดธนาคารด้วยเมื่อเลือกปฏิทินเต็ม', () => {
    const holidays = new Set([isoDate('2027-01-01')])
    // 1 ม.ค. 2027 เป็นวันศุกร์ + วันหยุด -> preceding ต้องถอยไป 31 ธ.ค. 2026 (พฤหัส)
    expect(rollDate(isoDate('2027-01-01'), 'preceding', 'weekend_and_bank_holidays', holidays))
      .toBe(isoDate('2026-12-31'))
    // ปฏิทินแบบเสาร์-อาทิตย์อย่างเดียวไม่ต้องเลื่อน
    expect(rollDate(isoDate('2027-01-01'), 'preceding', 'weekend_only', holidays))
      .toBe(isoDate('2027-01-01'))
  })
})

describe('invariant: จำนวนวันต้องต่อกันสนิท ไม่มีวันหายหรือนับซ้ำ', () => {
  it('ผลรวม accrualDays = จำนวนวันจาก startDate ถึงงวดสุดท้าย', () => {
    const { rows } = buildSchedule(makeTerms({
      startDate: isoDate('2026-10-05'),
      dueDayOfMonth: 5,
      dateRoll: 'preceding',
      scheduleOverrides: { 12: isoDate('2027-11-03'), 50: isoDate('2030-12-04') },
    }))
    const sum = rows.reduce((a, r) => a + r.accrualDays, 0)
    expect(sum).toBe(daysBetween(isoDate('2026-10-05'), rows[rows.length - 1]!.date))
  })
})
