/**
 * TV-51 — ยอดจ่ายที่ลงก่อนวันตัด ต้องตัดดอก ณ วันนั้น ไม่ใช่ยกไปรวมที่วันตัด
 *
 * เทียบกับสลิปจริงของผู้ใช้ (กสิกรไทย เม.ย. 2569 · 1.99%)
 *   ยอดหนี้ต้นงวด                       5,226,720.20
 *   3 เม.ย. จ่ายค่างวด 37,000  29 วัน   ดอก 8,263.95  ต้น 28,736.05
 *   5 เม.ย. โอนเพิ่ม   43,000   2 วัน   ดอก   566.79  ต้น 42,433.21  <- ตรงกับสลิป
 *   ยอดเงินต้นคงค้าง                     5,155,550.94                <- ตรงกับสลิป
 *
 * ⛔ ถ้ารวม 80,000 ไปตัดทีเดียวที่วันตัด จะได้ดอก 31 วันบนยอดเต็ม = 8,833.87
 *    เกินจริง 3.13 บาท = ดอก 2 วันของเงินต้น 28,736.05 ที่จ่ายไปตั้งแต่วันที่ 3
 *    ส่วนต่างนี้ไม่โตขึ้น แต่ค้างติดยอดคงเหลือไปตลอดสัญญา
 */

import { describe, expect, it } from 'vitest'
import { buildSchedule } from './schedule.js'
import { makeTerms, fixedStep } from './test-helpers.js'
import { baht } from './money.js'
import { isoDate } from './date.js'
import type { PaymentEvent } from './types.js'

/** ปัดเป็นบาททศนิยม 2 ตำแหน่งเพื่อเทียบกับตัวเลขบนสลิป */
const B = (v: bigint) => Number(v / 1_000_000_000_000n) / 100

/** งวดเดียว 6 มี.ค. -> 5 เม.ย. 2569 (31 วัน) บนยอดต้นงวดจากใบแจ้งยอดจริง */
const TERMS = makeTerms({
  startDate: isoDate('2026-03-05'),
  firstDueDate: isoDate('2026-04-05'),
  principalBaht: 5_226_720.2,
  installmentBaht: 80_000,
  dueDayOfMonth: 5,
  rateSteps: [fixedStep(1.99, 1, null)],
  // ⚠️ defaultConventions ของ test helper ใช้ rounding 'none'
  //    สัญญาจริงปัดครึ่งขึ้นเป็นสตางค์ และธนาคารปัดทุกครั้งที่ตัดชำระ
  //    ถ้าไม่ระบุ เศษจะค้างข้ามจุดตัดแล้วเพี้ยนจากสลิปไป 1 สตางค์
  conventions: [{
    effectiveFrom: isoDate('2026-03-05'),
    dayCountBasis: 'ACT/365F',
    rounding: 'round_satang',
    capitaliseUnpaidInterest: false,
  }],
})

describe('TV-51 จ่ายค่างวดก่อนวันตัดแล้วโอนเพิ่มตอนวันตัด', () => {
  const events: PaymentEvent[] = [
    { date: isoDate('2026-04-03'), amountSatang: baht(37_000), kind: 'installment' },
    { date: isoDate('2026-04-05'), amountSatang: baht(43_000), kind: 'installment' },
  ]
  const r = buildSchedule(TERMS, events).rows[0]!

  it('ยอดเงินต้นคงค้างตรงกับสลิปธนาคารทุกสตางค์', () => {
    expect(B(r.balanceAfterFixed)).toBeCloseTo(5_155_550.94, 2)
  })

  it('ดอกทั้งงวด = 29 วันบนยอดเต็ม + 2 วันบนยอดที่ลดแล้ว', () => {
    expect(r.accrualDays).toBe(31)
    expect(B(r.interestFixed)).toBeCloseTo(8_830.74, 2)
    expect(B(r.interestPaidFixed)).toBeCloseTo(8_830.74, 2)
  })

  it('ยอดจ่ายรวมทั้งสองก้อน ห้ามนับซ้ำหรือตกหล่น', () => {
    expect(B(r.paymentFixed)).toBeCloseTo(80_000, 2)
    expect(B(r.principalFixed)).toBeCloseTo(71_169.26, 2)
  })

  it('ติดป้ายให้รู้ว่างวดนี้ดอกไม่ได้คิดบนยอดก้อนเดียวตลอดงวด', () => {
    expect(r.flags).toContain('early_payment')
  })
})

describe('TV-51 ถ้าเงินเข้าก้อนเดียวตรงวันตัด', () => {
  const r = buildSchedule(TERMS, [
    { date: isoDate('2026-04-05'), amountSatang: baht(80_000), kind: 'installment' },
  ]).rows[0]!

  it('คิด 31 วันบนยอดเต็ม — แพงกว่ากันพอดี 3.13 บาท', () => {
    expect(B(r.interestFixed)).toBeCloseTo(8_833.87, 2)
    expect(B(r.balanceAfterFixed)).toBeCloseTo(5_155_554.07, 2)
    expect(r.flags).not.toContain('early_payment')
  })
})

describe('TV-51 โปะสองก้อนวันเดียวกัน', () => {
  it('ต้องนับครบทั้งคู่ ไม่ใช่นับก้อนแรกก้อนเดียว', () => {
    const rows = buildSchedule(TERMS, [
      { date: isoDate('2026-03-20'), amountSatang: baht(100_000), kind: 'partial_prepay' },
      { date: isoDate('2026-03-20'), amountSatang: baht(150_000), kind: 'partial_prepay' },
    ]).rows
    expect(B(rows[0]!.prepayFixed)).toBeCloseTo(250_000, 2)
  })
})
