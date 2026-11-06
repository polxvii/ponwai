/**
 * TV-57 — "ยังต้องจ่ายอีกเท่าไหร่จนปิดหนี้" (ต้น + ดอก)
 *
 * ผู้ใช้ต้องการตัวเลขนี้ไว้วางแผนเงินจนจบสัญญา — หน้าสัญญาเคยมีแต่เงินต้นคงเหลือ
 * ⛔ ตัวเลขนี้ผิดแล้วดูน่าเชื่อมาก เทสต์จึงไม่เทียบกับเลขที่คิดมือ
 *    แต่ตรึงด้วยความสัมพันธ์ที่ต้องจริงทุกสัญญา: อดีต + อนาคต = ทั้งสัญญา ทุกสตางค์
 */

import { describe, expect, it } from 'vitest'
import { buildSchedule } from '@engine/schedule.js'
import { makeTerms, fixedStep } from '@engine/test-helpers.js'
import { baht, FIXED_SCALE, type Fixed, type Satang } from '@engine/money.js'
import { isoDate } from '@engine/date.js'
import type { PrepayPlan } from '@engine/prepay.js'
import type { PaymentEvent } from '@engine/types.js'
import { balanceOn, remainingToPay, settledPeriods } from './progress'

// ตัวเลขสมมติทั้งหมด
const TERMS = makeTerms({
  startDate: isoDate('2026-03-05'),
  principalBaht: 3_000_000,
  installmentBaht: 25_000,
  dueDayOfMonth: 5,
  rateSteps: [fixedStep(4, 1, null)],
})
const PRINCIPAL = (baht(3_000_000) * FIXED_SCALE) as Fixed
const sum = (xs: readonly bigint[]): bigint => xs.reduce((a, b) => a + b, 0n)

/** สถานะ ณ วันหนึ่ง แบบเดียวกับที่หน้าสัญญาคิด */
function at(events: readonly PaymentEvent[], today: string, plan?: PrepayPlan) {
  const s = buildSchedule(TERMS, events, plan)
  const settled = settledPeriods(s.rows, events, isoDate(today))
  const balance = balanceOn(s.rows, events, isoDate(today), baht(3_000_000))
  const paidInterest = sum(s.rows.slice(0, settled).map((r) => r.interestPaidFixed))
  return { s, settled, balance, paidInterest, left: remainingToPay(s.rows, s.paidOff, settled, balance) }
}

describe('TV-57 ยังต้องจ่ายอีกเท่าไหร่จนปิดหนี้', () => {
  const events: PaymentEvent[] = [
    { date: isoDate('2026-04-05'), amountSatang: baht(25_000), kind: 'installment' },
    { date: isoDate('2026-05-05'), amountSatang: baht(25_000), kind: 'installment' },
    { date: isoDate('2026-06-05'), amountSatang: baht(225_000), kind: 'installment' },
  ]
  const now = at(events, '2026-06-20')

  it('ยอดรวม = เงินต้นคงเหลือ + ดอกเบี้ยที่ยังต้องจ่าย ทุกสตางค์', () => {
    expect(now.left).not.toBeNull()
    expect(now.left!.totalFixed).toBe(now.balance + now.left!.interestFixed)
    expect(now.left!.interestFixed).toBeGreaterThan(0n)
  })

  /** ตัวที่จับบั๊กได้จริง — ถ้านับงวดผิดไปงวดเดียว สมการนี้พังทันที */
  it('ดอกที่จ่ายไปแล้ว + ดอกที่ยังต้องจ่าย = ดอกทั้งสัญญา', () => {
    const wholeLoanInterest = now.s.totalPaymentFixed - PRINCIPAL
    expect(now.paidInterest + now.left!.interestFixed).toBe(wholeLoanInterest)
  })

  it('ยอดที่จ่ายไปแล้ว + ยอดที่ยังต้องจ่าย = ยอดจ่ายทั้งสัญญา', () => {
    const paid = sum(now.s.rows.slice(0, now.settled).map((r) => r.paymentFixed))
    expect(paid + now.left!.totalFixed).toBe(now.s.totalPaymentFixed)
  })

  it('จำนวนงวดที่เหลือ = งวดทั้งหมด − งวดที่จบแล้ว', () => {
    expect(now.left!.periods).toBe(now.s.rows.length - now.settled)
  })

  it('ยังไม่จ่ายสักงวด = ยอดจ่ายทั้งสัญญา และเงินต้นคือวงเงินเต็ม', () => {
    const start = at([], '2026-03-10')
    expect(start.settled).toBe(0)
    expect(start.left!.totalFixed).toBe(start.s.totalPaymentFixed)
    expect(start.left!.totalFixed - start.left!.interestFixed).toBe(PRINCIPAL)
  })

  it('จ่ายจนปิดหนี้แล้ว = ไม่เหลืออะไรต้องจ่าย', () => {
    const s = buildSchedule(TERMS, [])
    const last = s.rows[s.rows.length - 1]!
    const done = remainingToPay(s.rows, s.paidOff, last.index, 0n as Fixed)
    expect(done).toEqual({ totalFixed: 0n, interestFixed: 0n, periods: 0 })
  })

  /** แผนโปะลดดอกที่เหลือ แต่เงินต้นที่ต้องคืนเท่าเดิม — ต้นทุกบาทต้องจ่ายคืนอยู่ดี */
  it('ใส่แผนโปะแล้ว ดอกที่ยังต้องจ่ายลดลง ส่วนเงินต้นคงเหลือวันนี้เท่าเดิม', () => {
    const plan: PrepayPlan = {
      baseYear: 2026,
      repeatMode: 'repeat_forever',
      repeatUntilYear: null,
      months: { 12: baht(100_000) as Satang },
      overrides: {},
    }
    const withPlan = at(events, '2026-06-20', plan)
    expect(withPlan.balance).toBe(now.balance)
    expect(withPlan.left!.interestFixed).toBeLessThan(now.left!.interestFixed)
    expect(withPlan.left!.totalFixed).toBe(withPlan.balance + withPlan.left!.interestFixed)
  })

  /**
   * ⛔ ค่างวดไม่พอจ่ายดอก ตารางวิ่งชนเพดานจำนวนงวด
   *    ผลรวมของตารางแบบนั้นคือค่าของเพดาน ไม่ใช่ภาระจริง ต้องไม่ได้ตัวเลข
   */
  it('สัญญาที่ไม่มีวันปิดหนี้ ต้องไม่ได้ตัวเลขออกมา', () => {
    const never = makeTerms({
      startDate: isoDate('2026-03-05'),
      principalBaht: 3_000_000,
      installmentBaht: 5_000,
      dueDayOfMonth: 5,
      rateSteps: [fixedStep(4, 1, null)],
    })
    const s = buildSchedule(never, [])
    expect(s.paidOff).toBe(false)
    expect(remainingToPay(s.rows, s.paidOff, 0, PRINCIPAL)).toBeNull()
  })
})
