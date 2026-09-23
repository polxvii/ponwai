/**
 * TV-39 — ยอดคงเหลือวันนี้ต้องนับยอดที่จ่ายจริงไปแล้ว
 *
 * เคสจริงที่เจอ: โปะ 3,737,000 บันทึกวันที่ 5 ก.ย. ครบกำหนดงวดนั้น 5 ต.ค.
 * วันที่ 23 ก.ย. การ์ดโชว์ 9,671,301 แต่ตารางผ่อนข้างล่างโชว์ 5,950,199
 * เพราะการ์ดนับงวดจากวันครบกำหนดอย่างเดียว เงินออกจากบัญชีไปแล้วแต่ไม่ถูกนับ
 */

import { describe, expect, it } from 'vitest'
import { isoDate, type ISODate } from '@engine/date.js'
import { baht, FIXED_SCALE, type Fixed } from '@engine/money.js'
import type { PaymentEvent, ScheduleRow } from '@engine/types.js'
import { balanceOn, settledPeriods } from './progress'

const fixed = (n: number) => (BigInt(Math.round(n * 100)) * FIXED_SCALE) as Fixed

/** งวดเดือนละครั้ง ตัดวันที่ 5 ช่วงคิดดอกคือ (5 เดือนก่อน, 5 เดือนนี้] */
function row(index: number, from: string, due: string, balance: number): ScheduleRow {
  return {
    index,
    date: isoDate(due),
    nominalDate: isoDate(due),
    accrualFrom: isoDate(from),
    accrualDays: 30,
    effectiveRateBps: 200,
    paymentFixed: fixed(37_000),
    prepayFixed: 0n as Fixed,
    interestFixed: fixed(16_000),
    interestPaidFixed: fixed(16_000),
    principalFixed: fixed(21_000),
    accruedCarriedFixed: 0n as Fixed,
    balanceAfterFixed: fixed(balance),
    flags: [],
  }
}

const rows: ScheduleRow[] = [
  row(15, '2026-07-05', '2026-08-05', 9_691_838),
  row(16, '2026-08-05', '2026-09-05', 9_671_301),
  row(17, '2026-09-05', '2026-10-05', 5_950_199), // งวดที่มีการโปะก้อนใหญ่
  row(18, '2026-10-05', '2026-11-05', 5_923_306),
]

const DISBURSED = baht(10_000_000)
const TODAY = isoDate('2026-09-23')

describe('settledPeriods', () => {
  it('ไม่มีบันทึกจ่ายจริง ก็นับตามวันครบกำหนดเหมือนเดิม', () => {
    expect(settledPeriods(rows, [], TODAY)).toBe(16)
  })

  it('โปะไปแล้ววันที่ 5 ก.ย. ต้องนับงวด 17 แม้ยังไม่ถึงวันครบกำหนด 5 ต.ค.', () => {
    const events: PaymentEvent[] = [
      { date: isoDate('2026-09-05'), amountSatang: baht(3_737_000), kind: 'partial_prepay' },
    ]
    // 5 ก.ย. ตรงปลายช่วงงวด 16 พอดี จึงเป็นของงวด 16 ตามกฎ (from, due]
    expect(settledPeriods(rows, events, TODAY)).toBe(16)

    const later: PaymentEvent[] = [
      { date: isoDate('2026-09-10'), amountSatang: baht(3_737_000), kind: 'partial_prepay' },
    ]
    expect(settledPeriods(rows, later, TODAY)).toBe(17)
  })

  it('บันทึกล่วงหน้าไว้ ยังไม่นับ เพราะเงินยังไม่ออกจากบัญชี', () => {
    const future: PaymentEvent[] = [
      { date: isoDate('2026-10-01'), amountSatang: baht(3_737_000), kind: 'partial_prepay' },
    ]
    expect(settledPeriods(rows, future, TODAY)).toBe(16)
  })

  it('ยังไม่ถึงงวดแรกและไม่มีบันทึกอะไร = 0 งวด', () => {
    expect(settledPeriods(rows, [], isoDate('2026-01-01'))).toBe(0)
  })
})

describe('balanceOn', () => {
  it('ยอดคงเหลือขยับตามเงินที่จ่ายจริง ไม่ต้องรอวันครบกำหนด', () => {
    const events: PaymentEvent[] = [
      { date: isoDate('2026-09-10'), amountSatang: baht(3_737_000), kind: 'partial_prepay' },
    ]
    expect(balanceOn(rows, [], TODAY, DISBURSED)).toBe(fixed(9_671_301))
    expect(balanceOn(rows, events, TODAY, DISBURSED)).toBe(fixed(5_950_199))
  })

  it('ยังไม่ผ่อนงวดไหนเลย = วงเงินเต็ม', () => {
    const early: ISODate = isoDate('2026-01-01')
    expect(balanceOn(rows, [], early, DISBURSED)).toBe((DISBURSED * FIXED_SCALE) as Fixed)
  })
})
