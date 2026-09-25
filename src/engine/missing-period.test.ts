/**
 * TV-47 — งวดที่อยู่ในช่วงที่บันทึกไว้แล้ว แต่ไม่มีรายการ = ไม่ได้จ่าย
 *
 * เคสจริง: เบิกเงิน 27 ม.ค. วันตัดงวดคือวันที่ 5
 * งวดแรกจึงกินเวลาแค่ 9 วัน ธนาคารไม่เรียกเก็บแยก ไปรวมกับงวดถัดไป
 * แอพเคยเติมค่างวดเต็มให้งวดนั้นแล้วบอกว่า "คาด" ทั้งที่งวดนั้นผ่านไปแล้ว
 * และมีบันทึกของงวดถัดไปยืนยันอยู่ว่าเงินออกไปก้อนเดียว
 */

import { describe, expect, it } from 'vitest'
import { buildSchedule } from './schedule.js'
import { makeTerms, fixedStep } from './test-helpers.js'
import { baht, type Satang } from './money.js'
import { isoDate } from './date.js'
import type { PaymentEvent } from './types.js'

const s = (n: number): Satang => baht(n)

const TERMS = makeTerms({
  startDate: isoDate('2026-01-27'),
  dueDayOfMonth: 5,
  principalBaht: 3_000_000,
  installmentBaht: 20_000,
  rateSteps: [fixedStep(4, 1, null)],
})

describe('TV-47 งวดที่ไม่มีบันทึกภายในช่วงที่บันทึกแล้ว', () => {
  it('ข้ามงวดแรก แล้วจ่ายรวมในงวดที่สอง -> งวดแรกเป็น 0 ไม่ใช่ค่างวดเต็ม', () => {
    const events: PaymentEvent[] = [
      { date: isoDate('2026-03-05'), amountSatang: s(40_000), kind: 'installment' },
    ]
    const r = buildSchedule(TERMS, events)
    const first = r.rows[0]!
    const second = r.rows[1]!

    expect(first.paymentFixed).toBe(0n)
    expect(first.flags).toContain('no_payment_recorded')
    expect(first.flags).not.toContain('actual_payment')

    expect(second.flags).toContain('actual_payment')
    expect(second.paymentFixed).toBe(s(40_000) * 1_000_000_000_000n)
  })

  it('เงินต้นของงวดที่ถูกข้ามต้องไม่ลด — ห้ามตัดต้นที่ไม่เคยถูกจ่าย', () => {
    const skipped = buildSchedule(TERMS, [
      { date: isoDate('2026-03-05'), amountSatang: s(40_000), kind: 'installment' },
    ])
    expect(skipped.rows[0]!.principalFixed).toBe(0n)
    // ดอกยังเดินตามปกติ แค่ไม่มีใครจ่าย
    expect(skipped.rows[0]!.interestFixed).toBeGreaterThan(0n)
  })

  it('⛔ งวดหลังรายการล่าสุด ต้องยังเป็นประมาณการตามค่างวด ไม่ใช่ 0', () => {
    const r = buildSchedule(TERMS, [
      { date: isoDate('2026-02-05'), amountSatang: s(20_000), kind: 'installment' },
    ])
    // คนที่บันทึกงวดเดียวแล้วหยุด ต้องไม่กลายเป็นค้างชำระทุกงวดที่เหลือ
    const later = r.rows[5]!
    expect(later.flags).not.toContain('no_payment_recorded')
    expect(later.paymentFixed).toBe(s(20_000) * 1_000_000_000_000n)
  })

  it('ไม่บันทึกอะไรเลย -> ตารางเป็นประมาณการล้วนเหมือนเดิม', () => {
    const r = buildSchedule(TERMS)
    expect(r.rows.every((x) => !x.flags.includes('no_payment_recorded'))).toBe(true)
  })
})
