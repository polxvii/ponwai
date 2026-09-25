import { type ISODate, isoDate } from './date.js'
import { baht, bps, type Satang } from './money.js'
import type { LoanTerms, RateStep, LoanConvention } from './types.js'

/** convention เริ่มต้นของทุก TV: exact ไม่ปัด, ACT/365F, ดอกค้างไม่ทบต้น (spec ข้อ 9.1) */
export function defaultConventions(from: string): LoanConvention[] {
  return [{
    effectiveFrom: isoDate(from),
    dayCountBasis: 'ACT/365F',
    rounding: 'none',
    capitaliseUnpaidInterest: false,
  }]
}

export function fixedStep(rate: number, fromMonth = 1, toMonth: number | null = null): RateStep {
  return { fromMonth, toMonth, kind: 'fixed', fixedRateBps: bps(Math.round(rate * 100)) }
}

export type TermsOverrides = Partial<LoanTerms> & {
  principalBaht?: number
  installmentBaht?: number
}

export function makeTerms(o: TermsOverrides = {}): LoanTerms {
  const startDate = o.startDate ?? isoDate('2026-10-01')
  const principalSatang: Satang = o.principalSatang ?? baht(o.principalBaht ?? 3_000_000)
  const installmentSatang: Satang = o.installmentSatang ?? baht(o.installmentBaht ?? 16_200)

  return {
    principalSatang,
    startDate,
    // ⚠️ optional บน LoanTerms — ต้องส่งต่อแบบมีเงื่อนไข ไม่งั้น exactOptionalPropertyTypes ฟ้อง
    //    และถ้าลืมส่ง เทสต์จะเงียบ ๆ ใช้กฎเดิมโดยไม่มีใครรู้
    ...(o.firstDueDate !== undefined ? { firstDueDate: o.firstDueDate } : {}),
    termMonths: o.termMonths ?? 360,
    dueDayOfMonth: o.dueDayOfMonth ?? 1,
    dateRoll: o.dateRoll ?? 'none',
    rollCalendar: o.rollCalendar ?? 'weekend_only',
    bankHolidays: o.bankHolidays ?? [],
    scheduleOverrides: o.scheduleOverrides ?? {},
    rateSteps: o.rateSteps ?? [fixedStep(5.0)],
    referenceRates: o.referenceRates ?? [],
    conventions: o.conventions ?? defaultConventions(startDate),
    installmentSatang,
    prepayMode: o.prepayMode ?? 'shorten_term',
  }
}

export function d(s: string): ISODate {
  return isoDate(s)
}
