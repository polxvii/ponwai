/**
 * TV-55 — แผนโปะเป็นการ "คาดการณ์" ห้ามบวกทับเดือนที่รู้แล้วว่าจ่ายอะไรไป
 *
 * ⛔ เคสจริงที่ผู้ใช้เจอ: วางแผนโปะเดือน ต.ค. ไว้ 225,000 พอถึงเวลาโปะจริงแค่ 150,000
 *    ตารางกลับแสดงยอดโปะเดือนนั้น 375,000 = แผน + ของจริง
 *    และยอดหนี้ลดลงไป 375,000 ทั้งที่เงินออกจากบัญชีแค่ 150,000
 *    วันปิดหนี้ ดอกรวม และสิทธิลดหย่อนทุกปีหลังจากนั้นจึงผิดตามไปทั้งเส้น
 *
 * กฎ: งวดที่มีรายการจ่ายบันทึกไว้ หรืออยู่ในช่วงที่บันทึกครบแล้ว = ความจริงชนะแผนเสมอ
 */

import { describe, expect, it } from 'vitest'
import { buildSchedule } from './schedule.js'
import { makeTerms, fixedStep } from './test-helpers.js'
import { baht, formatFixedBaht, type Satang } from './money.js'
import { isoDate } from './date.js'
import type { PrepayPlan } from './prepay.js'
import type { PaymentEvent, ScheduleRow } from './types.js'

const TERMS = makeTerms({
  startDate: isoDate('2026-03-05'),
  principalBaht: 3_000_000,
  installmentBaht: 20_000,
  dueDayOfMonth: 5,
  rateSteps: [fixedStep(4, 1, null)],
})

/** โปะ 225,000 ทุกเดือนตุลาคม */
const PLAN: PrepayPlan = {
  baseYear: 2026,
  repeatMode: 'repeat_forever',
  repeatUntilYear: null,
  months: { 10: baht(225_000) as Satang },
  overrides: {},
}

const OCT = isoDate('2026-10-05')
const rowOn = (rows: readonly ScheduleRow[], d: string): ScheduleRow | undefined =>
  rows.find((r) => r.date === d)

describe('TV-55 เดือนที่โปะจริงแล้ว แผนต้องไม่บวกทับ', () => {
  /** จ่ายค่างวดตามปกติ แล้วโปะจริง 150,000 ในวันตัดเดียวกัน */
  const events: PaymentEvent[] = [
    { date: OCT, amountSatang: baht(20_000), kind: 'installment' },
    { date: OCT, amountSatang: baht(150_000), kind: 'partial_prepay' },
  ]

  const withPlan = buildSchedule(TERMS, events, PLAN)
  const row = rowOn(withPlan.rows, OCT)!

  it('ยอดโปะของเดือนนั้นต้องเป็น 150,000 ที่จ่ายจริง ไม่ใช่ 375,000', () => {
    expect(formatFixedBaht(row.prepayFixed)).toBe('150,000.00')
  })

  it('ยอดที่ตัดออกจากหนี้ต้องไม่เกินเงินที่ออกจากบัญชีจริง', () => {
    const noPlan = buildSchedule(TERMS, events)
    const a = rowOn(noPlan.rows, OCT)!
    expect(formatFixedBaht(row.balanceAfterFixed)).toBe(formatFixedBaht(a.balanceAfterFixed))
  })

  /**
   * ⛔ ตัวที่เจ็บที่สุด — ผิดเดือนเดียวแต่ลามทั้งสัญญา
   *    ถ้าตารางตัดหนี้เกินจริง 225,000 ตั้งแต่ ต.ค. 2569 ทุกงวดหลังจากนั้นเพี้ยนตาม
   *    ของจริงที่เจอคือปิดหนี้ที่งวด 91 แทนที่จะเป็น 206 — เร็วกว่าความจริงเกือบสิบปี
   *
   * ใช้แผนปีเดียวเพื่อตัดตัวแปร: ตุลาคมปีถัดไปไม่มีแผน ตารางทั้งเส้นจึงต้องเท่ากันเป๊ะ
   */
  it('แผนที่มีแต่เดือนที่โปะจริงไปแล้ว ต้องไม่ขยับตารางเลยแม้แต่งวดเดียว', () => {
    const onlyThisYear = buildSchedule(TERMS, events, {
      ...PLAN,
      repeatMode: 'single_year' as const,
    })
    const noPlan = buildSchedule(TERMS, events)
    expect(onlyThisYear.rows.length).toBe(noPlan.rows.length)
    expect(formatFixedBaht(onlyThisYear.totalInterestFixed)).toBe(
      formatFixedBaht(noPlan.totalInterestFixed),
    )
  })

  /** แผนที่ทำซ้ำทุกปี ต้องเริ่มมีผลที่ตุลาคมปีถัดไป ไม่ใช่ปีนี้ */
  it('จุดแรกที่ตารางเริ่มต่างต้องเป็น ต.ค. 2570 ไม่ใช่ ต.ค. 2569', () => {
    const noPlan = buildSchedule(TERMS, events)
    const first = withPlan.rows.find(
      (r, i) => r.balanceAfterFixed !== noPlan.rows[i]?.balanceAfterFixed,
    )
    expect(first?.date).toBe(isoDate('2027-10-05'))
  })
})

describe('TV-55 เดือนที่ยังไม่ถึง แผนต้องทำงานเหมือนเดิม', () => {
  it('ไม่มีรายการจ่ายเลย = แผนลงครบทุกเดือนตุลาคม', () => {
    const rows = buildSchedule(TERMS, [], PLAN).rows
    expect(formatFixedBaht(rowOn(rows, OCT)!.prepayFixed)).toBe('225,000.00')
    expect(formatFixedBaht(rowOn(rows, isoDate('2027-10-05'))!.prepayFixed)).toBe('225,000.00')
  })

  it('บันทึกถึงแค่ ต.ค. 2569 — ตุลาคมปีถัดไปยังเป็นอนาคต แผนต้องลงตามปกติ', () => {
    const events: PaymentEvent[] = [
      { date: OCT, amountSatang: baht(20_000), kind: 'installment' },
    ]
    const rows = buildSchedule(TERMS, events, PLAN).rows
    expect(formatFixedBaht(rowOn(rows, OCT)!.prepayFixed)).toBe('0.00')
    expect(formatFixedBaht(rowOn(rows, isoDate('2027-10-05'))!.prepayFixed)).toBe('225,000.00')
  })

  /**
   * ⚠️ งวดที่อยู่ในช่วงที่บันทึกครบแล้วแต่ไม่มีรายการ แปลว่า "ไม่ได้จ่าย"
   *    ไม่ใช่ "ยังไม่ได้กรอก" — กฎเดียวกับที่ใช้กับค่างวด แผนต้องตามกฎนี้ด้วย
   */
  it('งวดก่อนรายการล่าสุดที่ไม่มีบันทึก = ไม่ได้โปะ แผนห้ามเติมให้', () => {
    const events: PaymentEvent[] = [
      { date: isoDate('2026-05-05'), amountSatang: baht(20_000), kind: 'installment' },
      { date: isoDate('2026-12-05'), amountSatang: baht(20_000), kind: 'installment' },
    ]
    const rows = buildSchedule(TERMS, events, PLAN).rows
    expect(formatFixedBaht(rowOn(rows, OCT)!.prepayFixed)).toBe('0.00')
  })

  it('จ่ายล่วงหน้าก่อนวันตัด ก็ยังถือว่างวดนั้นรู้แล้ว แผนห้ามลง', () => {
    const events: PaymentEvent[] = [
      { date: isoDate('2026-10-02'), amountSatang: baht(170_000), kind: 'installment' },
    ]
    const rows = buildSchedule(TERMS, events, PLAN).rows
    expect(formatFixedBaht(rowOn(rows, OCT)!.prepayFixed)).toBe('0.00')
  })
})
