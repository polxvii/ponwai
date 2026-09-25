/**
 * TV-50 — ช่วงคิดดอกของงวดคือ (วันตัดงวดก่อน, วันตัดงวดนี้]
 *
 * ดอกเบี้ยคิด "ถึงวันตัด โดยรวมวันตัดด้วย" ไม่ใช่หยุดที่วันก่อนหน้า
 * accrueInterestVariableRate ไล่วันจาก d0+1 ถึง d1 โดยรวมปลาย (accrual.ts)
 * และทั้ง engine ใช้ขอบเดียวกันหมด — ยอดจ่ายและยอดโปะที่ลงตรงวันตัดเป็นของงวดนั้น
 *
 * ⛔ ตารางผ่อนเคยแสดงช่วงเป็น accrualFrom – (วันตัด−1)
 *    จำนวนวันเท่ากันก็จริง แต่ป้ายเลื่อนไปหนึ่งวันทั้งสองหัว
 *    พอเทียบกับใบแจ้งยอดที่เขียนว่าคิดดอกถึงวันที่ 5 แล้วดูเหมือน engine คิดผิด
 *    ทั้งที่เลขถูก เทสต์นี้ตรึงขอบไว้ ถ้าใครเปลี่ยนกลับจะพังทันที
 */

import { describe, expect, it } from 'vitest'
import { buildSchedule } from './schedule.js'
import { makeTerms, fixedStep } from './test-helpers.js'
import { baht } from './money.js'
import { addDays, isoDate } from './date.js'
import type { PaymentEvent } from './types.js'

describe('TV-50 ขอบของช่วงคิดดอก', () => {
  const rows = buildSchedule(makeTerms(), []).rows.slice(0, 24)

  it('วันตัดอยู่ในช่วง — addDays(accrualFrom, accrualDays) ต้องเท่ากับวันตัดพอดี', () => {
    for (const r of rows) {
      expect(addDays(r.accrualFrom, r.accrualDays)).toBe(r.date)
    }
  })

  it('วันตัดเป็นขอบร่วมของสองงวด ไม่มีวันหลุดและไม่มีวันถูกคิดซ้ำ', () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.accrualFrom).toBe(rows[i - 1]!.date)
    }
  })

  it('ดอกเบี้ยของงวดคิดจากจำนวนวันเต็มระหว่างวันตัดสองครั้ง', () => {
    // งวด 2: 1 พ.ย. -> 1 ธ.ค. = 30 วัน ที่ 5% ACT/365F บนยอดหลังตัดงวดแรก
    const r = rows[1]!
    expect(r.accrualDays).toBe(30)
    const before = rows[0]!.balanceAfterFixed
    const expected = (before * 500n * 30n) / (10_000n * 365n)
    expect(Number(r.interestFixed)).toBeCloseTo(Number(expected), -6)
  })
})

describe('TV-50 ยอดโปะที่ลงตรงวันตัดพอดี', () => {
  const DUE_2 = isoDate('2026-12-01')
  const events: PaymentEvent[] = [
    { date: DUE_2, amountSatang: baht(100_000), kind: 'partial_prepay' },
  ]
  const rows = buildSchedule(makeTerms(), events).rows

  it('นับเป็นของงวดที่วันตัดนั้น ไม่ใช่ของงวดถัดไป', () => {
    expect(rows[1]!.date).toBe(DUE_2)
    expect(rows[1]!.prepayFixed).toBeGreaterThan(0n)
    expect(rows[2]!.prepayFixed).toBe(0n)
  })

  it('ไม่ถูกคิดซ้ำในงวดถัดไปที่ใช้วันเดียวกันเป็น accrualFrom', () => {
    expect(rows[2]!.accrualFrom).toBe(DUE_2)
    const total = rows.reduce((a, r) => a + r.prepayFixed, 0n)
    expect(total).toBe(rows[1]!.prepayFixed)
  })
})

describe('TV-50 กับตัวเลขจากใบแจ้งยอดจริง', () => {
  const rows = buildSchedule(
    makeTerms({
      startDate: isoDate('2025-05-29'),
      firstDueDate: isoDate('2025-07-04'),
      principalBaht: 10_000_000,
      installmentBaht: 80_000,
      dueDayOfMonth: 5,
      dateRoll: 'preceding',
      rollCalendar: 'weekend_and_bank_holidays',
      rateSteps: [fixedStep(1.99, 1, null)],
    }),
    [],
  ).rows

  it('งวดแรกคิดดอก 30 พ.ค. ถึง 4 ก.ค. รวมวันตัด = 36 วัน', () => {
    const r = rows[0]!
    expect(r.accrualFrom).toBe('2025-05-29')
    expect(addDays(r.accrualFrom, 1)).toBe('2025-05-30') // วันแรกที่ถูกคิดดอก
    expect(r.date).toBe('2025-07-04') // วันสุดท้ายที่ถูกคิดดอก
    expect(r.accrualDays).toBe(36)
  })
})
