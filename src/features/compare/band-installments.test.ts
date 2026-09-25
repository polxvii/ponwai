/**
 * TV-48 — ค่างวดรายช่วงของใบเสนอ ต้องมีผลจริงและต้องถูกปิดเมื่อบังคับจ่ายเท่ากัน
 *
 * ⛔ โหมดจ่ายเท่ากันมีไว้เทียบใบเสนอบนฐานเดียวกัน
 *    ถ้าค่างวดรายช่วงยังมีผล แต่ละใบจะจ่ายไม่เท่ากันอีก
 *    ตัวเลขที่ได้จะไม่ใช่การเปรียบเทียบ แต่ไม่มีอะไรบนจอบอกผู้ใช้
 */

import { describe, expect, it } from 'vitest'
import { evaluateOffer, type LoanOffer } from '@engine/compare.js'
import { installmentStepsFromYearly, rateStepsFromYearlyRates, defaultImportConvention } from '@engine/import.js'
import { baht, bps, type Satang } from '@engine/money.js'
import { isoDate } from '@engine/date.js'

const s = (n: number): Satang => baht(n)
const START = isoDate('2026-01-01')

function offer(steps?: LoanOffer['installmentSteps']): LoanOffer {
  return {
    bankCode: 'x',
    productName: 'ทดสอบ',
    loanAmountSatang: s(3_000_000),
    termMonths: 360,
    startDate: START,
    dueDayOfMonth: 1,
    rateSteps: rateStepsFromYearlyRates([bps(300), bps(300), bps(300)], bps(600)),
    referenceRates: [],
    conventions: [defaultImportConvention(START)],
    installmentQuotedSatang: s(15_000),
    ...(steps ? { installmentSteps: steps } : {}),
    fees: [],
    lockinMonths: 36,
    prepayPenaltyBps: bps(0),
  }
}

const BANDS = installmentStepsFromYearly([null, null, null], s(22_000))

describe('TV-48 ค่างวดรายช่วงของใบเสนอ', () => {
  it('ค่างวดหลังพ้นโปรสูงขึ้น -> หนี้ที่เหลือ ณ ครบ 3 ปีน้อยกว่า', () => {
    const flat = evaluateOffer(offer(), { horizonMonths: 48 })
    const band = evaluateOffer(offer(BANDS), { horizonMonths: 48 })
    // 3 ปีแรกเหมือนกันทุกอย่าง ต่างกันเฉพาะงวดที่ 37 เป็นต้นไป
    expect(band.balanceAtHorizonFixed).toBeLessThan(flat.balanceAtHorizonFixed)
  })

  it('⛔ โหมดจ่ายเท่ากัน -> ค่างวดรายช่วงต้องไม่มีผลเลย', () => {
    const a = evaluateOffer(offer(), { horizonMonths: 48, equalPaymentSatang: s(18_000) })
    const b = evaluateOffer(offer(BANDS), { horizonMonths: 48, equalPaymentSatang: s(18_000) })
    expect(b.balanceAtHorizonFixed).toBe(a.balanceAtHorizonFixed)
    expect(b.totalInterestFixed).toBe(a.totalInterestFixed)
  })

  it('ไม่ส่งช่วงมา -> เหมือนเดิมทุกประการ', () => {
    const a = evaluateOffer(offer(), { horizonMonths: 36 })
    const b = evaluateOffer(offer([]), { horizonMonths: 36 })
    expect(b.balanceAtHorizonFixed).toBe(a.balanceAtHorizonFixed)
  })
})
