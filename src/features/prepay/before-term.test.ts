/**
 * TV-46 — สัญญาที่ค่างวดไม่พอปิดหนี้ ต้องตอบ "ลดไปกี่ปี" ได้อยู่ดี
 *
 * ฝั่ง "จ่ายตามค่างวดอย่างเดียว" ไม่มีวันปิดหนี้ จึงไม่มีวันปิดหนี้ให้เอามาลบกัน
 * แต่กำหนดอายุสัญญาเป็นเส้นตายจริงที่เขียนไว้ในสัญญา ไม่ใช่ค่าที่สมมติขึ้น
 * "ปิดก่อนครบสัญญากี่ปี" จึงตอบได้เป็นปี โดยไม่ต้องเดาวันปิดหนี้ที่ไม่มีอยู่
 *
 * ⛔ ห้ามตอบด้วยผลบวกของตัวเลขที่แสดงอยู่แล้ว
 *    เคยใช้ "หนี้วันนี้น้อยลง" ซึ่งเท่ากับ เงินที่โปะ + ดอกที่ประหยัดได้ พอดี
 *    เลขที่ประกอบขึ้นจากสองช่องข้างบนไม่ได้บอกอะไรใหม่
 */

import { describe, expect, it } from 'vitest'
import { buildSchedule } from '@engine/schedule.js'
import { makeTerms, fixedStep } from '@engine/test-helpers.js'
import { baht } from '@engine/money.js'
import { isoDate } from '@engine/date.js'
import type { PaymentEvent } from '@engine/types.js'

const TERM_MONTHS = 360

/** ค่างวด 43,000 ต่ำกว่าดอกเบี้ยหลังพ้นโปรบนวงเงิน 10 ล้าน */
const TERMS = makeTerms({
  startDate: isoDate('2025-06-06'),
  principalBaht: 10_000_000,
  installmentBaht: 43_000,
  termMonths: TERM_MONTHS,
  rateSteps: [fixedStep(1.99, 1, 36), fixedStep(5.92, 37, null)],
})

const PREPAID: PaymentEvent[] = [
  { date: isoDate('2025-07-04'), amountSatang: baht(4_070_000), kind: 'installment' },
  { date: isoDate('2026-03-05'), amountSatang: baht(765_009), kind: 'partial_prepay' },
]

describe('TV-46 ปิดก่อนครบสัญญา', () => {
  it('จ่ายตามค่างวดอย่างเดียวไม่มีวันปิดหนี้ และครบ 30 ปียังเหลือหนี้ก้อนโต', () => {
    const contractOnly = buildSchedule(TERMS)
    expect(contractOnly.paidOff).toBe(false)

    const atTerm = contractOnly.rows.find((r) => r.index === TERM_MONTHS)
    expect(atTerm).toBeDefined()
    // ยังเหลือหนี้เกือบเท่าวงเงินเดิม — ค่างวดไม่พอแม้แต่จะจ่ายดอก
    expect(Number(atTerm!.balanceAfterFixed / 1_000_000_000_000n) / 100).toBeGreaterThan(8_000_000)
    expect(atTerm!.interestFixed).toBeGreaterThan(baht(43_000) * 1_000_000_000_000n / 100n)
  })

  it('โปะแล้วปิดได้ก่อนกำหนดสัญญาจริง และตอบเป็นปีได้', () => {
    const base = buildSchedule(TERMS, PREPAID)
    expect(base.paidOff).toBe(true)

    const beforeTerm = TERM_MONTHS - base.rows.length
    expect(beforeTerm).toBeGreaterThan(0)
    // ⚠️ ต้องอ่านจากความยาวตารางจริง ไม่ใช่ประมาณจากยอดที่โปะ
    expect(base.rows.length).toBeLessThan(TERM_MONTHS)
  })

  it('ไม่โปะ = ไม่มีตัวเลขนี้ ต้องไม่แอบคืนค่าบวก', () => {
    const noPrepay = buildSchedule(TERMS)
    // paidOff เป็น false จึงห้ามคำนวณ beforeTerm จากความยาวที่ชนเพดาน
    expect(noPrepay.paidOff).toBe(false)
    expect(TERM_MONTHS - noPrepay.rows.length).toBeLessThan(0)
  })
})
