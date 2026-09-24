/**
 * TV-42 — "ค่างวดตามสัญญา" เว้นว่างได้เมื่อกรอกครบทุกช่วง
 *
 * ที่มา: สัญญาที่ค่างวดไม่เท่ากันสักช่วงเดียว ไม่มีเลขไหนกรอกช่องนั้นได้อย่างไม่มั่ว
 * แต่ DB บังคับว่าค่างวดตั้งต้นต้อง > 0 เสมอ ฟอร์มจึงต้องเติมให้เองจากช่วงแรก
 * ไม่ใช่ปล่อย 0 ลงไปให้ Postgres ปฏิเสธเป็นภาษาอังกฤษดิบ
 */

import { describe, expect, it } from 'vitest'
import { isoDate } from '@engine/date.js'
import { bandsCoverEveryPeriod, emptyLoanDraft, toNewLoanInput, validateDraft } from './model'
import type { LoanDraft } from './model'

const TODAY = isoDate('2026-09-24')

/** ร่างที่กรอกครบทุกอย่างแล้ว ยกเว้นเรื่องค่างวดซึ่งแต่ละเทสต์กำหนดเอง */
function draft(over: Partial<LoanDraft>): LoanDraft {
  return {
    ...emptyLoanDraft(TODAY),
    propertyName: 'คอนโดอโศก',
    bankCode: 'KBANK',
    disbursed: 10_000_000,
    firstDueDate: isoDate('2026-10-24'),
    promoRates: [1.99, 1.99, 3.5],
    floatingRate: 6.5,
    ...over,
  }
}

const errorsOf = (d: LoanDraft) => validateDraft(d).filter((e) => e.includes('ค่างวด'))

describe('ค่างวดตั้งต้นเว้นว่างได้เมื่อทุกช่วงมีค่างวดของตัวเอง', () => {
  it('กรอกครบทุกช่วง + เว้นค่างวดตั้งต้น = ผ่าน', () => {
    const d = draft({
      installment: '',
      promoInstallments: [15_000, 15_000, 18_000],
      floatingInstallment: 22_000,
    })
    expect(bandsCoverEveryPeriod(d)).toBe(true)
    expect(errorsOf(d)).toEqual([])
  })

  it('เว้นช่วงไหนไว้ช่วงหนึ่ง แล้วเว้นค่างวดตั้งต้นด้วย = ไม่ผ่าน', () => {
    const d = draft({
      installment: '',
      promoInstallments: [15_000, '', 18_000],
      floatingInstallment: 22_000,
    })
    expect(bandsCoverEveryPeriod(d)).toBe(false)
    expect(errorsOf(d)).toHaveLength(1)
  })

  it('ช่วงลอยตัวไม่มีค่างวด = ยังต้องพึ่งค่าตั้งต้น', () => {
    const d = draft({
      installment: '',
      promoInstallments: [15_000, 15_000, 18_000],
      floatingInstallment: '',
    })
    expect(bandsCoverEveryPeriod(d)).toBe(false)
    expect(errorsOf(d)).toHaveLength(1)
  })

  it('ช่องเรตที่เว้นว่างไม่นับเป็นช่วง จึงไม่ต้องมีค่างวด', () => {
    const d = draft({
      installment: '',
      promoRates: [1.99, '', ''],
      promoInstallments: [15_000, '', ''],
      floatingInstallment: 22_000,
    })
    expect(bandsCoverEveryPeriod(d)).toBe(true)
    expect(errorsOf(d)).toEqual([])
  })

  it('เว้นค่างวดตั้งต้น → เก็บค่างวดช่วงแรกลง DB แทน (คอลัมน์บังคับ > 0)', () => {
    const input = toNewLoanInput(
      draft({
        installment: '',
        promoInstallments: [15_000, 15_000, 18_000],
        floatingInstallment: 22_000,
      }),
    )
    expect(input.installmentSatang).toBe(1_500_000n)
    // ⚠️ ช่วงแรกต้องยังถูกส่งไปเต็ม ๆ ด้วย ไม่ใช่หายไปเพราะย้ายไปเป็นค่าตั้งต้นแล้ว
    expect(input.promoInstallmentsSatang).toEqual([1_500_000n, 1_500_000n, 1_800_000n])
    expect(input.floatingInstallmentSatang).toBe(2_200_000n)
  })

  it('ไม่มีเรตโปรเลย → ค่าตั้งต้นตกไปใช้ค่างวดช่วงลอยตัว', () => {
    const input = toNewLoanInput(
      draft({
        installment: '',
        promoRates: ['', '', ''],
        promoInstallments: ['', '', ''],
        floatingInstallment: 22_000,
      }),
    )
    expect(input.installmentSatang).toBe(2_200_000n)
  })

  it('กรอกค่างวดตั้งต้นเองแล้ว ช่วงที่เว้นว่างจึงเว้นได้ตามเดิม', () => {
    const d = draft({
      installment: 37_000,
      promoInstallments: ['', '', ''],
      floatingInstallment: '',
    })
    expect(errorsOf(d)).toEqual([])
    const input = toNewLoanInput(d)
    expect(input.installmentSatang).toBe(3_700_000n)
    expect(input.promoInstallmentsSatang).toEqual([null, null, null])
  })

  it('ไม่กรอกอะไรเลยสักทาง = ยังเตือนเหมือนเดิม', () => {
    expect(errorsOf(draft({ installment: '' }))).toHaveLength(1)
  })
})
