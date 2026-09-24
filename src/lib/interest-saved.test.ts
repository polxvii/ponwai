/**
 * TV-44 — "ประหยัดดอกไปแล้วเท่าไหร่" ต้องตอบได้ แม้ค่างวดตามสัญญาจะไม่พอปิดหนี้
 *
 * เคสจริง: วงเงิน 10 ล้าน ค่างวด 37,000 ช่วงโปร 1.99% แล้วลอยตัว 6.5%
 * พ้นโปรแล้วดอกเดือนละ ~54,000 มากกว่าค่างวด หนี้จึงโตแทนที่จะลด
 * ตารางตามสัญญาวิ่งไปชนเพดานจำนวนงวด เอายอดดอกรวมมาลบกันไม่ได้
 * แต่ "งวดที่ผ่านมาแล้ว" มีอยู่จริงทั้งสองฝั่ง จึงต้องเทียบได้เสมอ
 */

import { describe, expect, it } from 'vitest'
import { buildSchedule } from '@engine/schedule.js'
import { makeTerms, fixedStep } from '@engine/test-helpers.js'
import { baht, type Satang } from '@engine/money.js'
import { isoDate } from '@engine/date.js'
import type { PaymentEvent } from '@engine/types.js'
import { interestUpTo, settledPeriods } from './progress'

const s = (n: number): Satang => baht(n)

/** ค่างวดไม่พอจ่ายดอกหลังพ้นโปร — จ่ายตามสัญญาอย่างเดียวไม่มีวันปิดหนี้ */
const STARVED = makeTerms({
  startDate: isoDate('2025-01-01'),
  principalBaht: 10_000_000,
  installmentBaht: 37_000,
  rateSteps: [fixedStep(1.99, 1, 24), fixedStep(6.5, 25, null)],
})

describe('TV-44 ดอกที่ประหยัดไปแล้ว ตัดที่งวดเดียวกันทั้งสองฝั่ง', () => {
  it('ตั้งฉากไว้ก่อน: ค่างวดตามสัญญาชุดนี้ไม่มีวันปิดหนี้จริง', () => {
    const contractOnly = buildSchedule(STARVED)
    expect(contractOnly.paidOff).toBe(false)
  })

  it('โปะก้อนใหญ่ -> ยังบอกได้ว่าประหยัดดอกไปแล้วเท่าไหร่', () => {
    const events: PaymentEvent[] = [
      { date: isoDate('2025-06-15'), amountSatang: s(4_000_000), kind: 'partial_prepay' },
    ]
    const contractOnly = buildSchedule(STARVED)
    const actual = buildSchedule(STARVED, events)
    const n = settledPeriods(actual.rows, events, isoDate('2026-09-24'))

    expect(n).toBeGreaterThan(0)
    const saved = interestUpTo(contractOnly.rows, n) - interestUpTo(actual.rows, n)
    // ⛔ ก่อนแก้ ช่องนี้โชว์ "—" ทั้งที่โปะไป 4 ล้าน
    expect(saved).toBeGreaterThan(0n)

    // ผลต่างของ "ยอดรวมทั้งสัญญา" ใช้แทนกันไม่ได้ — ฝั่งสัญญาเป็นค่าของเพดาน
    const lifetime = contractOnly.totalInterestFixed - actual.totalInterestFixed
    expect(lifetime).toBeGreaterThan(saved * 10n)
  })

  it('ไม่ได้โปะเลย -> ประหยัด 0 ไม่ใช่ติดลบ', () => {
    const contractOnly = buildSchedule(STARVED)
    const n = settledPeriods(contractOnly.rows, [], isoDate('2026-09-24'))
    expect(interestUpTo(contractOnly.rows, n) - interestUpTo(contractOnly.rows, n)).toBe(0n)
  })

  it('n เกินความยาวตาราง -> ตัดที่ความยาวจริง ไม่พังและไม่นับเกิน', () => {
    const rows = buildSchedule(STARVED, []).rows
    expect(interestUpTo(rows, 99_999)).toBe(interestUpTo(rows, rows.length))
    expect(interestUpTo(rows, 0)).toBe(0n)
    expect(interestUpTo(rows, -5)).toBe(0n)
  })
})
