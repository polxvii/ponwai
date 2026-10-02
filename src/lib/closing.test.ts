/**
 * TV-53 — ปิดสัญญาต้องกดกลับได้ และต้องไม่กลืนข้อมูลที่จ่ายไปจริง
 *
 * ⛔ เทสต์ชุดนี้คุม "ปิดแล้วตัวเลขเปลี่ยนยังไง" ไม่ใช่แค่ว่า flag ถูกเขียนลง DB
 *    จุดที่พังเงียบที่สุดคือ งวดในอนาคตยังโผล่ในสรุปภาษีของสัญญาที่ปิดไปแล้ว
 */

import { describe, expect, it } from 'vitest'
import { buildSchedule } from '@engine/schedule.js'
import { makeTerms, fixedStep } from '@engine/test-helpers.js'
import { isoDate } from '@engine/date.js'
import { rowsUntilClose, validateClose } from './closing'

const TERMS = makeTerms({
  startDate: isoDate('2026-03-05'),
  principalBaht: 3_000_000,
  installmentBaht: 20_000,
  dueDayOfMonth: 5,
  rateSteps: [fixedStep(4, 1, null)],
})
const ROWS = buildSchedule(TERMS, []).rows

describe('TV-53 ตัดตารางที่วันปิดสัญญา', () => {
  it('ยังไม่ปิด = ได้ตารางเดิมทั้งชุด ไม่ใช่สำเนาที่ถูกตัด', () => {
    expect(rowsUntilClose(ROWS, null)).toBe(ROWS)
  })

  it('งวดหลังวันปิดต้องหายไป ไม่งั้นสรุปภาษีนับดอกของงวดที่ไม่มีวันเกิดขึ้น', () => {
    const cut = rowsUntilClose(ROWS, isoDate('2027-01-05'))
    expect(cut.length).toBeGreaterThan(0)
    expect(cut.every((r) => r.date <= isoDate('2027-01-05'))).toBe(true)
    expect(cut.length).toBeLessThan(ROWS.length)
  })

  it('งวดที่วันตัดตรงกับวันปิดพอดีต้องเก็บไว้ — ดอกช่วงนั้นเกิดขึ้นจริงแล้ว', () => {
    const cut = rowsUntilClose(ROWS, isoDate('2027-01-05'))
    expect(cut[cut.length - 1]!.date).toBe(isoDate('2027-01-05'))
  })

  it('ปิดก่อนงวดแรกจะได้ตารางว่าง ไม่ใช่โยน error', () => {
    expect(rowsUntilClose(ROWS, isoDate('2026-03-10'))).toEqual([])
  })
})

describe('TV-53 เงื่อนไขก่อนปิด', () => {
  const base = {
    firstAccrualDate: isoDate('2026-03-05'),
    today: isoDate('2027-06-01'),
    payments: [],
  }

  it('วันปิดปกติผ่านหมด', () => {
    expect(validateClose({ ...base, closedDate: isoDate('2027-05-05') })).toEqual([])
  })

  it('ปิดก่อนวันเบิกเงินกู้ไม่ได้ สัญญายังไม่เริ่มด้วยซ้ำ', () => {
    const errs = validateClose({ ...base, closedDate: isoDate('2026-02-01') })
    expect(errs.some((e) => e.includes('วันเบิกเงินกู้'))).toBe(true)
  })

  /**
   * ⛔ ปล่อยให้ปิดล่วงหน้าได้ = "ยอดคงเหลือวันนี้" กลายเป็นยอดของวันที่ยังไม่มาถึง
   *    เพราะทั้งแอพคิดยอดจากตารางที่ถูกตัดด้วยวันปิด
   */
  it('ปิดล่วงหน้าไม่ได้', () => {
    const errs = validateClose({ ...base, closedDate: isoDate('2027-07-01') })
    expect(errs.some((e) => e.includes('ล่วงหน้า'))).toBe(true)
  })

  it('วันปิดเป็นวันนี้พอดีได้', () => {
    expect(validateClose({ ...base, closedDate: base.today })).toEqual([])
  })

  it('มีรายการจ่ายหลังวันปิด = ขัดกันเอง ต้องบอกวันที่ของรายการแรกให้ไปตามแก้', () => {
    const errs = validateClose({
      ...base,
      closedDate: isoDate('2027-01-05'),
      payments: [{ paidDate: isoDate('2026-12-05') }, { paidDate: isoDate('2027-03-05') }],
    })
    expect(errs).toHaveLength(1)
    expect(errs[0]).toContain('2570')
  })

  it('รายการจ่ายวันเดียวกับวันปิดไม่ถือว่าหลังวันปิด — ยอดปิดบัญชีจ่ายวันนั้นพอดี', () => {
    expect(
      validateClose({
        ...base,
        closedDate: isoDate('2027-01-05'),
        payments: [{ paidDate: isoDate('2027-01-05') }],
      }),
    ).toEqual([])
  })

  it('หลายรายการหลังวันปิดต้องบอกจำนวนด้วย ไม่ใช่โผล่ทีละอันให้แก้วนไปเรื่อย', () => {
    const errs = validateClose({
      ...base,
      closedDate: isoDate('2026-12-05'),
      payments: [{ paidDate: isoDate('2027-03-05') }, { paidDate: isoDate('2027-01-05') }],
    })
    expect(errs).toHaveLength(1)
    expect(errs[0]).toContain('2 รายการ')
    // รายการแรกตามเวลา ไม่ใช่ตามลำดับที่ส่งเข้ามา
    expect(errs[0]).toContain('มกราคม 2570')
  })
})
