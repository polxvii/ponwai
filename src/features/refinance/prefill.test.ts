/**
 * TV-45 — ดึงหนี้ที่ผ่อนอยู่จากสัญญาที่ติดตามไว้
 *
 * ⚠️ ต้องคิดจากตารางที่รวมการจ่ายจริงแล้ว ไม่ใช่ตัวเลขดิบใน active_loans
 *    คนที่โปะมาแล้ว ยอดคงเหลือกับงวดที่เหลือต่างจากสัญญาตั้งต้นคนละเรื่อง
 *    ถ้าดึงเลขดิบไปเทียบรีไฟแนนซ์ จะตัดสินใจบนหนี้ที่ไม่มีอยู่จริง
 */

import { describe, expect, it } from 'vitest'
import { isoDate } from '@engine/date.js'
import type { LoanFull } from '@/lib/db'
import { currentFromLoan } from './model'

const TODAY = isoDate('2026-09-24')

/** สัญญา 3 ล้าน 30 ปี ค่างวด 20,000 โปร 3% 2 ปี แล้วลอยตัว 5% */
function loanFixture(over: Partial<LoanFull> = {}): LoanFull {
  return {
    loan: {
      id: 'l1',
      property_id: 'p1',
      contract_date: '2024-01-01',
      first_accrual_date: '2024-01-01',
      first_due_date: '2024-02-05',
      due_day_of_month: 5,
      date_roll: 'none',
      roll_calendar: 'weekend_only',
      term_months: 360,
      disbursed_amount_satang: 300_000_000,
      installment_satang: 2_000_000,
      prepay_mode: 'shorten_term',
      status: 'active',
      origin: 'new_purchase',
      offer_id: null,
    },
    installmentSteps: [],
    propertyName: 'บ้านทดสอบ',
    bankCode: 'KBANK',
    bankName: 'กสิกรไทย',
    rateSteps: [
      { fromMonth: 1, toMonth: 24, kind: 'fixed', fixedRateBps: 300 },
      { fromMonth: 25, toMonth: null, kind: 'fixed', fixedRateBps: 500 },
    ],
    conventions: [
      {
        effectiveFrom: isoDate('2024-01-01'),
        dayCountBasis: 'ACT/365F',
        rounding: 'round_satang',
        capitaliseUnpaidInterest: false,
      },
    ],
    conventionAssumed: true,
    scheduleOverrides: {},
    payments: [],
    bankHolidays: [],
    ...over,
  } as LoanFull
}

describe('TV-45 เติมช่อง "หนี้ที่ผ่อนอยู่" จากสัญญาจริง', () => {
  it('ยังไม่เคยโปะ — ยอดคงเหลือกับงวดที่เหลือตรงกับตารางตามสัญญา', () => {
    const c = currentFromLoan(loanFixture(), TODAY)
    expect(c.asOf).toBe(TODAY)
    expect(c.dueDayOfMonth).toBe(5)
    expect(c.installment).toBe(20_000)
    // พ้นโปรแล้ว ณ วันนี้ (งวดที่ 32) ต้องได้เรตลอยตัว ไม่ใช่เรตโปรของงวดแรก
    expect(c.currentRate).toBe(5)
    expect(c.balance).toBeGreaterThan(0)
    expect(c.balance).toBeLessThan(3_000_000)
    // ⚠️ ไม่ใช่ 360 - 32 — ค่างวด 20,000 สูงกว่าที่ต้องใช้ผ่อน 3 ล้าน 30 ปีที่ 5%
    //    สัญญาจึงจบก่อนครบเทอม ต้องอ่านจากตารางจริง ไม่ใช่ลบจาก term_months
    expect(c.remainingMonths).toBeGreaterThan(0)
    expect(c.remainingMonths).toBeLessThan(360)
  })

  it('โปะไปแล้ว — ยอดคงเหลือลดลงและงวดที่เหลือสั้นลงจริง', () => {
    const plain = currentFromLoan(loanFixture(), TODAY)
    const prepaid = currentFromLoan(
      loanFixture({
        payments: [
          {
            id: 'x1',
            paidDate: isoDate('2025-06-05'),
            amountSatang: 50_000_000n,
            kind: 'partial_prepay',
            note: null,
          },
        ] as LoanFull['payments'],
      }),
      TODAY,
    )
    // ⛔ ถ้าดึงจาก active_loans ดิบ ๆ สองเคสนี้จะได้เลขเดียวกัน ซึ่งผิด
    expect(prepaid.balance).toBeLessThan(plain.balance as number)
    expect(prepaid.remainingMonths).toBeLessThan(plain.remainingMonths as number)
  })

  it('ค่างวดรายช่วง — เอาค่างวดของงวดถัดไป ไม่ใช่ของงวดแรก', () => {
    const c = currentFromLoan(
      loanFixture({
        installmentSteps: [
          { fromMonth: 1, toMonth: 24, amountSatang: 2_000_000n },
          { fromMonth: 25, toMonth: null, amountSatang: 2_600_000n },
        ] as LoanFull['installmentSteps'],
      }),
      TODAY,
    )
    expect(c.installment).toBe(26_000)
  })
})
