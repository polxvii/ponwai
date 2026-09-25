/**
 * TV-49 — คอลัมน์ "โปะ" ในตารางผ่อน ต้องตรงกับปฏิทินวางแผนโปะเสมอ
 *
 * ⛔ r.prepayFixed เฉย ๆ ใช้ไม่ได้ — นับเฉพาะรายการ "โปะบางส่วน" กับยอดจากแผน
 *    คนที่โอนรวมก้อนเดียว (ค่างวด 37,000 โอน 80,000) จะเห็นคอลัมน์โปะเป็น "—"
 *    ทั้งที่เงินต้นถูกตัดไป 43,000 จริง ๆ
 */

import { describe, expect, it } from 'vitest'
import { buildSchedule } from '@engine/schedule.js'
import { makeTerms, fixedStep } from '@engine/test-helpers.js'
import { baht, toFixed, type Satang } from '@engine/money.js'
import { isoDate } from '@engine/date.js'
import { findInstallment } from '@engine/rates.js'
import type { PaymentEvent } from '@engine/types.js'
import { prepayOfRow } from './progress'

const s = (n: number): Satang => baht(n)
const TERMS = makeTerms({
  startDate: isoDate('2026-01-01'),
  principalBaht: 3_000_000,
  installmentBaht: 20_000,
  dueDayOfMonth: 5,
  rateSteps: [fixedStep(4, 1, null)],
})
const sched = (i: number) =>
  toFixed(findInstallment(TERMS.installmentSteps, i, TERMS.installmentSatang))

describe('TV-49 ส่วนที่เป็นเงินโปะของแต่ละงวด', () => {
  it('โอนรวมเกินค่างวด -> ส่วนเกินคือเงินโปะ', () => {
    const events: PaymentEvent[] = [
      { date: isoDate('2026-02-05'), amountSatang: s(50_000), kind: 'installment' },
    ]
    const row = buildSchedule(TERMS, events).rows[0]!
    expect(row.flags).toContain('actual_payment')
    // 50,000 - 20,000 = 30,000
    expect(prepayOfRow(row, sched(row.index))).toBe(s(30_000) * 1_000_000_000_000n)
  })

  it('จ่ายพอดีค่างวด -> ไม่มีโปะ', () => {
    const events: PaymentEvent[] = [
      { date: isoDate('2026-02-05'), amountSatang: s(20_000), kind: 'installment' },
    ]
    const row = buildSchedule(TERMS, events).rows[0]!
    expect(prepayOfRow(row, sched(row.index))).toBe(0n)
  })

  it('บันทึก "โปะบางส่วน" ลอย ๆ โดยไม่บันทึกค่างวด -> ยังนับเป็นโปะ', () => {
    const events: PaymentEvent[] = [
      { date: isoDate('2026-02-03'), amountSatang: s(100_000), kind: 'partial_prepay' },
    ]
    const row = buildSchedule(TERMS, events).rows[0]!
    expect(row.flags).not.toContain('actual_payment')
    expect(prepayOfRow(row, sched(row.index))).toBe(s(100_000) * 1_000_000_000_000n)
  })

  it('⛔ งวดสุดท้ายจ่ายน้อยกว่าค่างวด -> ต้องเป็น 0 ไม่ใช่ติดลบ', () => {
    const rows = buildSchedule(TERMS).rows
    const last = rows[rows.length - 1]!
    expect(last.flags).toContain('final_payment')
    expect(prepayOfRow(last, sched(last.index))).toBe(0n)
  })
})
