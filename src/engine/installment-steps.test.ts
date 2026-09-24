/**
 * TV-41 — ค่างวดที่ต่างกันตามช่วงของสัญญา
 *
 * ธนาคารไทยมักคิดค่างวดช่วงโปร (ปี 1-3) ต่ำกว่าช่วงลอยตัว
 * ถ้าบังคับใช้ค่างวดเดียวทั้งสัญญา ตารางจะเพี้ยนตั้งแต่งวดที่พ้นโปรเป็นต้นไป
 */

import { describe, expect, it } from 'vitest'
import { buildSchedule } from './schedule.js'
import { makeTerms, fixedStep } from './test-helpers.js'
import { baht, FIXED_SCALE, type Fixed } from './money.js'
import { isoDate } from './date.js'
import type { InstallmentStep } from './types.js'
import { findInstallment } from './rates.js'

const toBaht = (v: Fixed) => Number(v / FIXED_SCALE) / 100

const base = () =>
  makeTerms({
    principalBaht: 3_000_000,
    startDate: isoDate('2025-01-01'),
    dueDayOfMonth: 1,
    installmentBaht: 15_000,
    rateSteps: [fixedStep(3.0, 1, 36), fixedStep(6.0, 37, null)],
  })

describe('findInstallment', () => {
  const steps: InstallmentStep[] = [
    { fromMonth: 1, toMonth: 12, amountSatang: baht(15_000) },
    { fromMonth: 13, toMonth: 36, amountSatang: baht(16_000) },
    { fromMonth: 37, toMonth: null, amountSatang: baht(22_000) },
  ]

  it('เลือกช่วงตามเลขงวด', () => {
    expect(findInstallment(steps, 1, baht(1))).toBe(baht(15_000))
    expect(findInstallment(steps, 12, baht(1))).toBe(baht(15_000))
    expect(findInstallment(steps, 13, baht(1))).toBe(baht(16_000))
    expect(findInstallment(steps, 36, baht(1))).toBe(baht(16_000))
    expect(findInstallment(steps, 37, baht(1))).toBe(baht(22_000))
    expect(findInstallment(steps, 999, baht(1))).toBe(baht(22_000))
  })

  it('ไม่มี steps เลย = ใช้ค่าตั้งต้น (สัญญาเก่าที่บันทึกก่อนมีฟีเจอร์นี้)', () => {
    expect(findInstallment(undefined, 5, baht(15_000))).toBe(baht(15_000))
    expect(findInstallment([], 5, baht(15_000))).toBe(baht(15_000))
  })

  it('งวดที่ไม่มีช่วงไหนครอบ = ใช้ค่าตั้งต้น ไม่ใช่ 0', () => {
    const gap: InstallmentStep[] = [{ fromMonth: 13, toMonth: 24, amountSatang: baht(16_000) }]
    expect(findInstallment(gap, 5, baht(15_000))).toBe(baht(15_000))
  })
})

describe('buildSchedule กับค่างวดหลายช่วง', () => {
  it('ไม่ส่ง steps = ใช้ค่างวดเดียวทุกงวดเหมือนเดิม', () => {
    const r = buildSchedule(base())
    expect(toBaht(r.rows[0]!.paymentFixed)).toBe(15_000)
    expect(toBaht(r.rows[40]!.paymentFixed)).toBe(15_000)
  })

  it('ค่างวดขยับตรงงวดที่ขึ้นช่วงใหม่ ไม่ใช่งวดถัดไป', () => {
    const terms = {
      ...base(),
      installmentSteps: [
        { fromMonth: 1, toMonth: 36, amountSatang: baht(15_000) },
        { fromMonth: 37, toMonth: null, amountSatang: baht(22_000) },
      ] as InstallmentStep[],
    }
    const r = buildSchedule(terms)
    expect(toBaht(r.rows[35]!.paymentFixed)).toBe(15_000) // งวด 36 งวดสุดท้ายของโปร
    expect(toBaht(r.rows[36]!.paymentFixed)).toBe(22_000) // งวด 37 พ้นโปรแล้ว
  })

  it('ค่างวดที่สูงขึ้นช่วงลอยตัวทำให้ปิดหนี้เร็วกว่าการใช้ค่างวดเดียว', () => {
    const flat = buildSchedule(base())
    const stepped = buildSchedule({
      ...base(),
      installmentSteps: [
        { fromMonth: 1, toMonth: 36, amountSatang: baht(15_000) },
        { fromMonth: 37, toMonth: null, amountSatang: baht(22_000) },
      ] as InstallmentStep[],
    })
    expect(stepped.rows.length).toBeLessThan(flat.rows.length)
    expect(stepped.totalInterestFixed).toBeLessThan(flat.totalInterestFixed)
  })

  it('ยอดที่บันทึกว่าจ่ายจริงยังชนะค่างวดของช่วงเสมอ', () => {
    const terms = {
      ...base(),
      installmentSteps: [
        { fromMonth: 1, toMonth: null, amountSatang: baht(15_000) },
      ] as InstallmentStep[],
    }
    const r = buildSchedule(terms, [
      { date: isoDate('2025-03-01'), amountSatang: baht(50_000), kind: 'installment' },
    ])
    expect(toBaht(r.rows[1]!.paymentFixed)).toBe(50_000)
    expect(r.rows[1]!.flags).toContain('actual_payment')
  })
})
