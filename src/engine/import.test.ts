import { describe, it, expect } from 'vitest'
import { baht, bps, formatSatangBaht, type Satang } from './money.js'
import { isoDate } from './date.js'
import { fixedStep, defaultConventions } from './test-helpers.js'
import {
  validateImport, validateContext, buildFromImport, previewImport,
  rateStepsFromYearlyRates, defaultImportConvention, QUICK_LIMITATIONS,
  type QuickImport, type FullImport, type ImportContext,
} from './import.js'

const s = (n: number): Satang => baht(n)
const fs = (v: Satang) => formatSatangBaht(v)

/** ctx สำหรับ Quick — เริ่ม 2026-10-01 */
const ctx: ImportContext = {
  referenceRates: [],
  conventions: [defaultImportConvention(isoDate('2026-10-01'))],
}

/** ctx สำหรับ Full — สัญญาเริ่ม 2023-04-01 convention ต้องครอบวันนั้น */
const ctxFull: ImportContext = {
  referenceRates: [],
  conventions: [defaultImportConvention(isoDate('2023-04-01'))],
}

const quick: QuickImport = {
  mode: 'quick',
  balanceSatang: s(2_400_000),
  asOfDate: isoDate('2026-10-01'),
  installmentSatang: s(18_000),
  dueDayOfMonth: 1,
  rateSteps: [fixedStep(5.5)],
  originalMaturityDate: isoDate('2046-10-01'),
}

const full: FullImport = {
  mode: 'full',
  contractDate: isoDate('2023-04-01'),
  firstAccrualDate: isoDate('2023-04-01'),
  originalAmountSatang: s(3_000_000),
  termMonths: 360,
  dueDayOfMonth: 1,
  installmentSatang: s(20_000),
  rateSteps: [fixedStep(3.0, 1, 36), fixedStep(5.5, 37, null)],
  payments: [],
}

describe('Quick import', () => {
  it('ใช้ยอดคงเหลือเป็นจุดตั้งต้น ไม่ใช่วงเงินเดิม', () => {
    const r = buildFromImport(quick, { ...ctx, conventions: defaultConventions('2026-10-01') })
    expect(r.terms.principalSatang).toBe(s(2_400_000))
    expect(r.terms.startDate).toBe(isoDate('2026-10-01'))
  })

  it('คำนวณจำนวนงวดที่เหลือจากวันครบสัญญาเดิม', () => {
    const r = buildFromImport(quick, ctx)
    expect(r.remainingMonths).toBe(240)   // ต.ค. 2569 -> ต.ค. 2589 = 20 ปี
  })

  it('⚠️ ต้องแจ้งข้อจำกัดครบ 4 ข้อ ไม่ใช่ซ่อนไว้', () => {
    const r = buildFromImport(quick, ctx)
    expect(r.limitations).toHaveLength(4)
    const codes = r.limitations.map((x) => x.code)
    expect(codes).toContain('no_payment_history')
    expect(codes).toContain('no_tax_deduction_history')
    expect(codes).toContain('cannot_reconcile_past')
  })

  it('ไม่มีประวัติย้อนหลัง — historicalRows ว่าง และปีภาษีว่าง', () => {
    const r = buildFromImport(quick, ctx)
    expect(r.historicalRows).toHaveLength(0)
    expect(previewImport(quick, ctx).taxYearsCovered).toHaveLength(0)
  })

  it('ผ่อนต่อจากจุดตั้งต้นแล้วปิดหนี้ได้จริง', () => {
    const p = previewImport(quick, ctx)
    expect(p.projectedPayoffDate).not.toBeNull()
    expect(p.projectedTotalInterestSatang > 0n).toBe(true)
  })
})

describe('Full import', () => {
  const withPayments: FullImport = {
    ...full,
    payments: [
      { date: isoDate('2024-01-01'), amountSatang: s(50_000), kind: 'partial_prepay' },
      { date: isoDate('2025-06-01'), amountSatang: s(80_000), kind: 'partial_prepay' },
    ],
  }

  it('ใช้วงเงินเดิมและวันทำสัญญาเป็นจุดตั้งต้น', () => {
    const r = buildFromImport(withPayments, ctxFull)
    expect(r.terms.principalSatang).toBe(s(3_000_000))
    expect(r.terms.startDate).toBe(isoDate('2023-04-01'))
  })

  it('ไม่มีข้อจำกัด เพราะมีประวัติครบ', () => {
    expect(buildFromImport(withPayments, ctxFull).limitations).toHaveLength(0)
  })

  it('สร้างตารางย้อนหลังถึงรายการจ่ายล่าสุดได้', () => {
    const r = buildFromImport(withPayments, ctxFull)
    expect(r.historicalRows.length).toBeGreaterThan(0)
    const last = r.historicalRows[r.historicalRows.length - 1]!
    expect(last.date <= isoDate('2025-06-01')).toBe(true)
  })

  it('มีข้อมูลปีภาษีย้อนหลัง — ต่างจาก Quick ตรงนี้', () => {
    const p = previewImport(withPayments, ctxFull)
    expect(p.taxYearsCovered).toContain(2023)
    expect(p.taxYearsCovered).toContain(2024)
  })

  it('การโปะย้อนหลังถูกนำมาคิดจริง', () => {
    const withoutPrepay = buildFromImport(full, ctxFull)
    const withPrepay = buildFromImport(withPayments, ctxFull)
    expect(withPrepay.events).toHaveLength(2)
    expect(withoutPrepay.events).toHaveLength(0)
  })
})

describe('validateImport', () => {
  it('Quick: วันครบสัญญาอยู่ก่อนวันตั้งต้น -> reject', () => {
    const bad = { ...quick, originalMaturityDate: isoDate('2025-01-01') }
    expect(validateImport(bad).some((x) => x.field === 'originalMaturityDate')).toBe(true)
  })

  it('Quick: ยอดคงเหลือเป็น 0 -> reject', () => {
    expect(validateImport({ ...quick, balanceSatang: 0n as Satang })
      .some((x) => x.field === 'balanceSatang')).toBe(true)
  })

  it('Quick: ไม่มี rate step -> reject', () => {
    expect(validateImport({ ...quick, rateSteps: [] })
      .some((x) => x.field === 'rateSteps')).toBe(true)
  })

  it('Full: รายการจ่ายไม่เรียงวันที่ -> reject', () => {
    const bad: FullImport = {
      ...full,
      payments: [
        { date: isoDate('2025-06-01'), amountSatang: s(10_000), kind: 'partial_prepay' },
        { date: isoDate('2024-01-01'), amountSatang: s(10_000), kind: 'partial_prepay' },
      ],
    }
    expect(validateImport(bad).some((x) => x.field === 'payments')).toBe(true)
  })

  it('Full: รายการจ่ายอยู่ก่อนวันเริ่มคิดดอกเบี้ย -> reject', () => {
    const bad: FullImport = {
      ...full,
      payments: [{ date: isoDate('2022-01-01'), amountSatang: s(10_000), kind: 'partial_prepay' }],
    }
    expect(validateImport(bad).some((x) => x.message.includes('ก่อนวันเริ่มคิดดอกเบี้ย'))).toBe(true)
  })

  it('input ที่ไม่ผ่าน ต้อง throw พร้อมบอกว่าผิดตรงไหน ไม่ใช่คำนวณมั่ว', () => {
    expect(() => buildFromImport({ ...quick, balanceSatang: 0n as Satang }, ctx))
      .toThrow(/ยอดคงเหลือต้องมากกว่า 0/)
  })

  it('input ที่ถูกต้อง ต้องไม่มีปัญหา', () => {
    expect(validateImport(quick)).toHaveLength(0)
    expect(validateImport(full)).toHaveLength(0)
    expect(validateContext(quick, ctx)).toHaveLength(0)
    expect(validateContext(full, ctxFull)).toHaveLength(0)
  })

  it('convention ไม่ครอบวันเริ่มสัญญา -> ต้องบอกชัดตั้งแต่ชั้น validate', () => {
    const problems = validateContext(full, ctx)   // ctx เริ่ม 2026 แต่สัญญาเริ่ม 2023
    expect(problems.some((x) => x.field === 'conventions')).toBe(true)
    expect(() => buildFromImport(full, ctx)).toThrow(/LoanConvention ต้องมีผลไม่ช้ากว่า/)
  })

  it('เลือกปฏิทินรวมวันหยุด แต่ไม่ส่งรายการวันหยุดมา -> เตือน', () => {
    const problems = validateContext(quick, { ...ctx, rollCalendar: 'weekend_and_bank_holidays' })
    expect(problems.some((x) => x.field === 'bankHolidays')).toBe(true)
  })
})

describe('กรอกเรตเป็น "ปีที่" แทน from_month/to_month (ข้อ 5A.3)', () => {
  it('3 ปีแรก + ลอยตัว -> ได้ 4 step', () => {
    const steps = rateStepsFromYearlyRates([bps(250), bps(325), bps(375)], bps(483))
    expect(steps).toHaveLength(4)
    expect(steps[0]).toMatchObject({ fromMonth: 1, toMonth: 12, fixedRateBps: 250 })
    expect(steps[1]).toMatchObject({ fromMonth: 13, toMonth: 24, fixedRateBps: 325 })
    expect(steps[2]).toMatchObject({ fromMonth: 25, toMonth: 36, fixedRateBps: 375 })
    expect(steps[3]).toMatchObject({ fromMonth: 37, toMonth: null, fixedRateBps: 483 })
  })

  it('ใช้แทน fixedStep ใน TV-21 ได้ผลเหมือนกัน', () => {
    const steps = rateStepsFromYearlyRates([bps(250), bps(325), bps(375)], bps(483))
    const manual = [
      fixedStep(2.50, 1, 12), fixedStep(3.25, 13, 24),
      fixedStep(3.75, 25, 36), fixedStep(4.83, 37, null),
    ]
    expect(steps).toEqual(manual)
  })
})

describe('convention ตั้งต้นของสัญญาที่ import เข้ามา', () => {
  it('ACT/365F + ไม่ทบต้น ตาม default ที่ตัดสินใจไว้', () => {
    const c = defaultImportConvention(isoDate('2026-10-01'))
    expect(c.dayCountBasis).toBe('ACT/365F')
    expect(c.capitaliseUnpaidInterest).toBe(false)
  })
})

describe('ข้อจำกัดของ Quick ต้องเป็นข้อความที่คนอ่านเข้าใจ', () => {
  it('ทุกข้อมีข้อความภาษาไทยที่อธิบายผลกระทบจริง', () => {
    for (const l of QUICK_LIMITATIONS) {
      expect(l.message.length).toBeGreaterThan(20)
      expect(l.code).toBeTruthy()
    }
  })
})
