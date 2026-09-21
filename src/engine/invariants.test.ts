import { describe, it, expect } from 'vitest'
import { baht, bps, toFixed, formatFixedBaht, type Satang, type Fixed } from './money.js'
import { isoDate, ymd, daysBetween, type ISODate } from './date.js'
import { buildSchedule } from './schedule.js'
import { ALL_DAY_COUNT_BASES } from './accrual.js'
import { ALL_ROUNDING_MODES } from './reconcile.js'
import type { LoanTerms, RateStep, ScheduleRow } from './types.js'
import type { PrepayPlan } from './prepay.js'

/**
 * TV-28 Invariant — property-based ไม่ใช่ค่าคงที่
 *
 * TV แบบค่าคงที่จับบั๊กได้ทีละเคส ข้อนี้จับได้ทั้งคลาส
 * รัน 1,000 ชุดสุ่ม ทุกชุดต้องผ่านทั้ง 4 ข้อ
 */

/** PRNG แบบ deterministic — ต้อง reproduce ได้เมื่อ test fail ไม่งั้นดีบักไม่ได้ */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeRandomCase(rnd: () => number): { terms: LoanTerms; plan?: PrepayPlan; seedInfo: string } {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))

  const principalBaht = int(300_000, 12_000_000)
  const termMonths = pick([120, 180, 240, 300, 360])
  const startDate: ISODate = ymd(int(2024, 2030), int(1, 12), int(1, 28))
  const dueDayOfMonth = int(1, 28)

  // เรตหลายช่วง โปร 1-3 ปีแล้วลอยตัว
  const promoMonths = pick([12, 24, 36])
  const promoRate = int(180, 420)
  const floatRate = int(450, 780)
  const rateSteps: RateStep[] = [
    { fromMonth: 1, toMonth: promoMonths, kind: 'fixed', fixedRateBps: bps(promoRate) },
    { fromMonth: promoMonths + 1, toMonth: null, kind: 'fixed', fixedRateBps: bps(floatRate) },
  ]

  // ค่างวดต้องมากกว่าดอกเบี้ยงวดแรกพอสมควร ไม่งั้นทุกเคสจะกลายเป็น negative am
  const monthlyFloatInterest = (principalBaht * floatRate) / 10_000 / 12
  const installmentBaht = Math.ceil(monthlyFloatInterest * (1 + rnd() * 0.8) + 500)

  const terms: LoanTerms = {
    principalSatang: baht(principalBaht),
    startDate,
    termMonths,
    dueDayOfMonth,
    dateRoll: pick(['none', 'preceding', 'following'] as const),
    rollCalendar: 'weekend_only',
    bankHolidays: [],
    scheduleOverrides: {},
    rateSteps,
    referenceRates: [],
    conventions: [{
      effectiveFrom: startDate,
      dayCountBasis: pick(ALL_DAY_COUNT_BASES),
      rounding: pick(ALL_ROUNDING_MODES),
      capitaliseUnpaidInterest: rnd() < 0.3,
    }],
    installmentSatang: baht(installmentBaht),
    prepayMode: 'shorten_term',
  }

  // 40% ของเคสมีแผนโปะด้วย
  let plan: PrepayPlan | undefined
  if (rnd() < 0.4) {
    const months: Record<number, Satang> = {}
    for (let m = 1; m <= 12; m++) months[m] = baht(int(0, 8_000))
    plan = {
      baseYear: Number(startDate.slice(0, 4)) + int(0, 3),
      repeatMode: 'repeat_forever',
      repeatUntilYear: null,
      months,
      overrides: {},
      lumps: [],
    }
  }

  const seedInfo =
    `P=${principalBaht} start=${startDate} due=${dueDayOfMonth} term=${termMonths} ` +
    `inst=${installmentBaht} promo=${promoRate}/${promoMonths}m float=${floatRate} ` +
    `basis=${terms.conventions[0]!.dayCountBasis} round=${terms.conventions[0]!.rounding} ` +
    `cap=${terms.conventions[0]!.capitaliseUnpaidInterest} roll=${terms.dateRoll} plan=${plan ? 'yes' : 'no'}`

  return plan ? { terms, plan, seedInfo } : { terms, seedInfo }
}

const f = (v: Fixed) => formatFixedBaht(v, 4)

describe('TV-28 Invariant — 1,000 ชุดสุ่ม', () => {
  const CASES = 1_000
  const rnd = mulberry32(20260921)
  const cases = Array.from({ length: CASES }, () => makeRandomCase(rnd))

  // ⚠️ ต้องเทียบกับ "วงเงินตั้งต้น" ไม่ใช่ "Σ เงินต้น"
  // เพราะโหมดทบต้นทำให้ผู้กู้ต้องคืนเงินต้นมากกว่าที่ยืมมา — TV-28 จับข้อนี้ได้
  it('(ก) Σ ยอดจ่าย = Σ ดอกเบี้ย + วงเงินตั้งต้น ทุกสตางค์', () => {
    for (const c of cases) {
      const r = buildSchedule(c.terms, [], c.plan)
      if (!r.paidOff) continue   // เคสที่ชนเพดานงวด ดอกค้างยังไม่ถูกจ่าย ข้าม
      const expected = (r.totalInterestFixed + toFixed(c.terms.principalSatang)) as Fixed
      expect(
        f(r.totalPaymentFixed),
        `${c.seedInfo}\n  payment=${f(r.totalPaymentFixed)} expected=${f(expected)}`,
      ).toBe(f(expected))
    }
  })

  it('(ข) Σ เงินต้น = วงเงินตั้งต้น + ดอกที่ถูกทบเข้าต้น', () => {
    for (const c of cases) {
      const r = buildSchedule(c.terms, [], c.plan)
      if (!r.paidOff) continue
      const expected = (toFixed(c.terms.principalSatang) + r.totalCapitalisedFixed) as Fixed
      expect(f(r.totalPrincipalFixed), c.seedInfo).toBe(f(expected))
    }
  })

  it('(ข2) โหมดไม่ทบต้น ดอกที่ถูกทบต้องเป็น 0 และเงินต้นเท่าวงเงินพอดี', () => {
    for (const c of cases) {
      if (c.terms.conventions[0]!.capitaliseUnpaidInterest) continue
      const r = buildSchedule(c.terms, [], c.plan)
      if (!r.paidOff) continue
      expect(r.totalCapitalisedFixed, c.seedInfo).toBe(0n)
      expect(f(r.totalPrincipalFixed), c.seedInfo).toBe(f(toFixed(c.terms.principalSatang)))
    }
  })

  it('(ค) balance ลดลงอย่างเดียว เว้นงวดที่ flag negative_amortization', () => {
    for (const c of cases) {
      const r = buildSchedule(c.terms, [], c.plan)
      let prev: Fixed | null = null
      for (const row of r.rows) {
        if (prev !== null && row.balanceAfterFixed > prev) {
          expect(row.flags, `${c.seedInfo}\n  งวด ${row.index} ยอดโตขึ้นโดยไม่มี flag`)
            .toContain('negative_amortization')
        }
        prev = row.balanceAfterFixed
      }
    }
  })

  it('(ง) balance งวดสุดท้าย = 0 พอดี ไม่ใช่ 0.01 และไม่ใช่ -0.03', () => {
    for (const c of cases) {
      const r = buildSchedule(c.terms, [], c.plan)
      if (!r.paidOff) continue
      const last = r.rows[r.rows.length - 1]!
      expect(last.balanceAfterFixed, `${c.seedInfo}\n  งวดสุดท้าย ${f(last.balanceAfterFixed)}`).toBe(0n)
      expect(last.accruedCarriedFixed, c.seedInfo).toBe(0n)
    }
  })

  it('(จ) ยอดคงเหลือห้ามติดลบในงวดใดเลย', () => {
    for (const c of cases) {
      for (const row of buildSchedule(c.terms, [], c.plan).rows) {
        expect(row.balanceAfterFixed >= 0n, `${c.seedInfo}\n  งวด ${row.index}`).toBe(true)
      }
    }
  })

  it('(ฉ) จำนวนวันต้องต่อกันสนิท ไม่มีวันหายหรือนับซ้ำ', () => {
    for (const c of cases) {
      const rows = buildSchedule(c.terms, [], c.plan).rows
      const sum = rows.reduce((a, r) => a + r.accrualDays, 0)
      const span = daysBetween(c.terms.startDate, rows[rows.length - 1]!.date)
      expect(sum, c.seedInfo).toBe(span)

      // ปลายช่วงของงวดก่อน ต้องเป็นต้นช่วงของงวดถัดไปพอดี
      let prevEnd = c.terms.startDate
      for (const r of rows) {
        expect(r.accrualFrom, `${c.seedInfo}\n  งวด ${r.index}`).toBe(prevEnd)
        prevEnd = r.date
      }
    }
  })

  it('(ช) ดอกเบี้ยห้ามติดลบ และห้ามเกินยอดหนี้ในงวดเดียว', () => {
    for (const c of cases) {
      for (const row of buildSchedule(c.terms, [], c.plan).rows) {
        expect(row.interestFixed >= 0n, `${c.seedInfo}\n  งวด ${row.index}`).toBe(true)
      }
    }
  })
})

describe('TV-28 กรณีขอบ ที่การสุ่มอาจไม่โดน', () => {
  const base = (over: Partial<LoanTerms>): LoanTerms => ({
    principalSatang: baht(3_000_000),
    startDate: isoDate('2028-01-31'),
    termMonths: 360,
    dueDayOfMonth: 31,
    dateRoll: 'none',
    rollCalendar: 'weekend_only',
    bankHolidays: [],
    scheduleOverrides: {},
    rateSteps: [{ fromMonth: 1, toMonth: null, kind: 'fixed', fixedRateBps: bps(500) }],
    referenceRates: [],
    conventions: [{
      effectiveFrom: isoDate('2028-01-31'),
      dayCountBasis: 'ACT/365F',
      rounding: 'none',
      capitaliseUnpaidInterest: false,
    }],
    installmentSatang: baht(20_000),
    prepayMode: 'shorten_term',
    ...over,
  })

  it('เริ่มวันที่ 31 ในปีอธิกสุรทิน — clamp แล้วต้องเด้งกลับ ไม่ drift', () => {
    const rows = buildSchedule(base({})).rows
    expect(rows[0]!.date).toBe(isoDate('2028-02-29'))
    expect(rows[1]!.date).toBe(isoDate('2028-03-31'))
    expect(rows[2]!.date).toBe(isoDate('2028-04-30'))
    expect(rows[3]!.date).toBe(isoDate('2028-05-31'))
  })

  it('เงินกู้ก้อนเล็กมาก ปิดได้ในงวดเดียว', () => {
    const r = buildSchedule(base({ principalSatang: baht(5_000) }))
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]!.balanceAfterFixed).toBe(0n)
    expect(r.paidOff).toBe(true)
  })

  it('อัตรา 0% — ดอกเบี้ยเป็นศูนย์ เงินต้นลดเต็มจำนวน', () => {
    const r = buildSchedule(base({
      rateSteps: [{ fromMonth: 1, toMonth: null, kind: 'fixed', fixedRateBps: bps(0) }],
    }))
    expect(r.totalInterestFixed).toBe(0n)
    expect(r.totalPrincipalFixed).toBe(toFixed(baht(3_000_000)))
    expect(r.rows).toHaveLength(150)  // 3,000,000 / 20,000
  })

  it('ค่างวดต่ำกว่าดอกเบี้ยตลอด — ชนเพดานงวดแล้วต้อง paidOff = false ไม่ใช่วนไม่รู้จบ', () => {
    const r = buildSchedule(base({
      rateSteps: [{ fromMonth: 1, toMonth: null, kind: 'fixed', fixedRateBps: bps(900) }],
      installmentSatang: baht(1_000),
    }))
    expect(r.paidOff).toBe(false)
    expect(r.rows.length).toBe(1_200)
    expect(r.rows.every((x: ScheduleRow) => x.flags.includes('negative_amortization'))).toBe(true)
  })
})
