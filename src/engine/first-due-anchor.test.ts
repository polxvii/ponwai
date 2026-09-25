/**
 * TV-0 — งวดแรกต้องตรงกับใบแจ้งยอดจริง
 *
 * เทียบกับตารางของผู้ใช้จริง (วงเงิน 10,000,000 · เบิก 29 พ.ค. 2568 · วันตัดรอบ 5 · 1.99%)
 *   งวด 1  29 พ.ค. -> 4 ก.ค.   36 วัน  ดอก 19,627.39  คงเหลือ 5,949,627.39 (หลังโปะ 4,070,000)
 *   งวด 2   4 ก.ค. -> 5 ส.ค.   32 วัน  ดอก 10,380.06  คงเหลือ 5,723,007.45
 *   งวด 3   5 ส.ค. -> 5 ก.ย.   31 วัน  ดอก  9,672.67  คงเหลือ 5,652,680.12
 *   งวด 4   5 ก.ย. -> 3 ต.ค.   28 วัน  ดอก  8,629.24  คงเหลือ 5,581,309.36
 *
 * ⛔ ธนาคารไม่ออกบิลรอบ 5 มิ.ย. เพราะเพิ่งเบิกเงินได้ 7 วัน
 *    แอพเคยเดาวันตัดจาก startDate + dueDayOfMonth จึงแทรกงวด 7 วันที่ไม่มีอยู่จริง
 *    ทั้งตารางเลื่อนไปหนึ่งงวดและไม่มีทางตรงกับใบแจ้งยอด
 */

import { describe, expect, it } from 'vitest'
import { buildSchedule } from './schedule.js'
import { makeTerms, fixedStep } from './test-helpers.js'
import { baht } from './money.js'
import { isoDate, type ISODate } from './date.js'
import { nominalDueDate } from './schedule-dates.js'
import type { PaymentEvent } from './types.js'

/** ปัดเป็นบาททศนิยม 2 ตำแหน่งเพื่อเทียบกับตัวเลขในใบ */
const B = (v: bigint) => Number(v / 1_000_000_000_000n) / 100

const TERMS = makeTerms({
  startDate: isoDate('2025-05-29'),
  firstDueDate: isoDate('2025-07-04'),
  principalBaht: 10_000_000,
  installmentBaht: 80_000,
  dueDayOfMonth: 5,
  dateRoll: 'preceding',
  rollCalendar: 'weekend_and_bank_holidays',
  rateSteps: [fixedStep(1.99, 1, null)],
})

const EVENTS: PaymentEvent[] = [
  { date: isoDate('2025-07-04'), amountSatang: baht(4_070_000), kind: 'installment' },
  { date: isoDate('2025-08-05'), amountSatang: baht(237_000), kind: 'installment' },
  { date: isoDate('2025-09-05'), amountSatang: baht(80_000), kind: 'installment' },
  { date: isoDate('2025-10-03'), amountSatang: baht(80_000), kind: 'installment' },
]

describe('TV-0 ตารางผ่อนตรงกับใบแจ้งยอดจริง', () => {
  const rows = buildSchedule(TERMS, EVENTS).rows

  it('งวดแรกเป็นงวดเดียว 36 วัน ไม่ถูกซอยตามวันตัดรอบ', () => {
    expect(rows[0]!.accrualFrom).toBe('2025-05-29')
    expect(rows[0]!.date).toBe('2025-07-04')
    expect(rows[0]!.accrualDays).toBe(36)
    expect(B(rows[0]!.interestFixed)).toBeCloseTo(19_627.39, 2)
    expect(B(rows[0]!.balanceAfterFixed)).toBeCloseTo(5_949_627.39, 2)
  })

  it('งวดถัดไปนับจากวันตัดงวดแรกเป็น anchor ใหม่ ไม่ใช่จากวันเบิกเงิน', () => {
    expect(rows[1]!.date).toBe('2025-08-05')
    expect(rows[1]!.accrualDays).toBe(32)
    expect(B(rows[1]!.interestFixed)).toBeCloseTo(10_380.06, 2)
    expect(B(rows[1]!.balanceAfterFixed)).toBeCloseTo(5_723_007.45, 2)
  })

  it('เลื่อนวันหยุดถูกต้อง — 5 ต.ค. ตรงวันอาทิตย์ จึงเป็น 3 ต.ค. และงวดเหลือ 28 วัน', () => {
    expect(rows[2]!.date).toBe('2025-09-05')
    expect(rows[2]!.accrualDays).toBe(31)
    expect(B(rows[2]!.balanceAfterFixed)).toBeCloseTo(5_652_680.12, 2)

    expect(rows[3]!.date).toBe('2025-10-03')
    expect(rows[3]!.accrualDays).toBe(28)
    expect(B(rows[3]!.interestFixed)).toBeCloseTo(8_629.24, 2)
    expect(B(rows[3]!.balanceAfterFixed)).toBeCloseTo(5_581_309.36, 2)
  })

  it('⛔ ไม่ระบุวันตัดงวดแรก = กฎเดิม ต้องไม่เปลี่ยนพฤติกรรมของสัญญาที่ไม่มีค่านี้', () => {
    const { firstDueDate: _drop, ...noAnchor } = TERMS
    const r = buildSchedule(noAnchor)
    // กฎเดิมสร้างงวดสั้น ๆ 7 วันจาก 29 พ.ค. ถึง 5 มิ.ย.
    expect(r.rows[0]!.date).toBe('2025-06-05')
    expect(r.rows[0]!.accrualDays).toBe(7)
  })

  it('⛔ anchor ต้องไม่ไหล — 30 ปีผ่านไปวันตัดยังอยู่วันที่ 5 (TV-32)', () => {
    // เรียกกฎวันที่ตรง ๆ ไม่ผ่าน buildSchedule เพราะสัญญานี้ปิดหนี้ก่อนครบ 30 ปี
    const cfg = {
      startDate: isoDate('2025-05-29'),
      firstDueDate: isoDate('2025-07-04'),
      dueDayOfMonth: 5,
      dateRoll: 'preceding' as const,
      rollCalendar: 'weekend_and_bank_holidays' as const,
      bankHolidays: new Set<ISODate>(),
      overrides: {},
    }
    for (const period of [2, 12, 60, 120, 360]) {
      expect(nominalDueDate(cfg, period).slice(8, 10)).toBe('05')
    }
    // งวดแรกยังเป็นวันที่ธนาคารกำหนด ไม่ถูกกฎรายเดือนทับ
    expect(nominalDueDate(cfg, 1)).toBe('2025-07-04')
  })
})
