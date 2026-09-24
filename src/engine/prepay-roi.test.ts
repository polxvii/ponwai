import { describe, it, expect } from 'vitest'
import { buildSchedule } from './schedule.js'
import { makeTerms, fixedStep } from './test-helpers.js'
import { baht, formatFixedBaht, type Satang } from './money.js'
import { isoDate } from './date.js'
import { evaluatePrepayPlan } from './prepay-roi.js'
import type { PrepayPlan } from './prepay.js'
import type { PaymentEvent } from './types.js'

const f0 = (v: bigint) => formatFixedBaht(v as never, 0)
const s = (n: number): Satang => baht(n)

const TERMS = makeTerms({
  startDate: isoDate('2026-01-01'),
  principalBaht: 3_000_000,
  installmentBaht: 20_000,
  rateSteps: [fixedStep(5.0, 1, null)],
})

const baseline = buildSchedule(TERMS)

function planOf(monthly: number): PrepayPlan {
  const months: Record<number, Satang> = {}
  for (let m = 1; m <= 12; m++) months[m] = s(monthly)
  return {
    baseYear: 2026,
    repeatMode: 'repeat_forever',
    repeatUntilYear: null,
    months,
    overrides: {},
    lumps: [],
  }
}

describe('ROI ของแผนโปะ (ข้อ 3.4)', () => {
  it('ไม่ได้โปะเลย -> ROI เป็น null ไม่ใช่ 0 เพราะหารด้วยศูนย์ไม่ได้', () => {
    const withPlan = buildSchedule(TERMS, [], planOf(0))
    const r = evaluatePrepayPlan({
      loanId: 'a',
      baseline,
      withPlan,
      otherLoans: [],
      marginalTaxRateBps: null,
    })
    expect(r.roiBps).toBeNull()
    expect(r.periodsSaved).toBe(0)
  })

  it('โปะเดือนละ 5,000 -> ปิดเร็วขึ้นและประหยัดดอกจริง', () => {
    const withPlan = buildSchedule(TERMS, [], planOf(5_000))
    const r = evaluatePrepayPlan({
      loanId: 'a',
      baseline,
      withPlan,
      otherLoans: [],
      marginalTaxRateBps: null,
    })
    expect(r.periodsSaved).toBeGreaterThan(0)
    expect(r.interestSavedFixed).toBeGreaterThan(0n)
    expect(r.totalPrepaidFixed).toBeGreaterThan(0n)
    expect(r.roiBps).not.toBeNull()
  })

  it('⚠️ ROI ต่อบาทลดลงเมื่อโปะหนักขึ้น — diminishing return ต้องเห็น', () => {
    const light = evaluatePrepayPlan({
      loanId: 'a',
      baseline,
      withPlan: buildSchedule(TERMS, [], planOf(3_000)),
      otherLoans: [],
      marginalTaxRateBps: null,
    })
    const heavy = evaluatePrepayPlan({
      loanId: 'a',
      baseline,
      withPlan: buildSchedule(TERMS, [], planOf(20_000)),
      otherLoans: [],
      marginalTaxRateBps: null,
    })
    expect(heavy.totalPrepaidFixed).toBeGreaterThan(light.totalPrepaidFixed)
    expect(heavy.interestSavedFixed).toBeGreaterThan(light.interestSavedFixed)
    // โปะหนักกว่าประหยัดรวมได้มากกว่า แต่ต่อบาทที่โปะได้น้อยกว่า
    expect(heavy.roiBps!).toBeLessThan(light.roiBps!)
  })

  it('ไม่กรอกอัตราภาษี -> ROI หลังภาษีเป็น null ⛔ ห้ามเดาแทน', () => {
    const r = evaluatePrepayPlan({
      loanId: 'a',
      baseline,
      withPlan: buildSchedule(TERMS, [], planOf(5_000)),
      otherLoans: [],
      marginalTaxRateBps: null,
    })
    expect(r.afterTaxRoiBps).toBeNull()
  })

  it('กรอกอัตราภาษีแล้ว -> ROI หลังภาษีต่ำกว่า ROI ดิบ เพราะเสียสิทธิลดหย่อน', () => {
    const r = evaluatePrepayPlan({
      loanId: 'a',
      baseline,
      withPlan: buildSchedule(TERMS, [], planOf(5_000)),
      otherLoans: [],
      marginalTaxRateBps: 2_000, // 20%
    })
    expect(r.deductionLostFixed).toBeGreaterThan(0n)
    expect(r.afterTaxRoiBps!).toBeLessThan(r.roiBps!)
  })

  it('⛔ สัญญาอื่นกินเพดานลดหย่อนเต็มแล้ว -> โปะไม่ทำให้เสียสิทธิเพิ่ม', () => {
    // สัญญาที่ 2 ดอกเบี้ยเกิน 100,000 ต่อปีอยู่แล้ว สิทธิจึงเต็มทุกปีไม่ว่าจะโปะหรือไม่
    const big = buildSchedule(
      makeTerms({
        startDate: isoDate('2026-01-01'),
        principalBaht: 9_000_000,
        installmentBaht: 60_000,
        rateSteps: [fixedStep(5.0, 1, null)],
      }),
    )

    const alone = evaluatePrepayPlan({
      loanId: 'a',
      baseline,
      withPlan: buildSchedule(TERMS, [], planOf(5_000)),
      otherLoans: [],
      marginalTaxRateBps: 2_000,
    })
    const shared = evaluatePrepayPlan({
      loanId: 'a',
      baseline,
      withPlan: buildSchedule(TERMS, [], planOf(5_000)),
      otherLoans: [{ loanId: 'b', rows: big.rows }],
      marginalTaxRateBps: 2_000,
    })

    // นี่คือจุดที่พังเงียบถ้าคิดเพดานรายสัญญา จะบอกว่าเสียสิทธิทั้งที่ไม่ได้เสีย
    expect(shared.deductionLostFixed).toBeLessThan(alone.deductionLostFixed)
    expect(shared.afterTaxRoiBps!).toBeGreaterThan(alone.afterTaxRoiBps!)
  })

  it('เงินที่โปะรวมตรงกับผลต่างของยอดจ่ายทั้งหมด', () => {
    const withPlan = buildSchedule(TERMS, [], planOf(5_000))
    const r = evaluatePrepayPlan({
      loanId: 'a',
      baseline,
      withPlan,
      otherLoans: [],
      marginalTaxRateBps: null,
    })
    const sumPrepay = withPlan.rows.reduce((a, x) => a + x.prepayFixed, 0n)
    expect(f0(r.totalPrepaidFixed)).toBe(f0(sumPrepay))
  })
})

/**
 * TV-43 — เงินโปะที่บันทึกว่าจ่ายไปแล้ว ต้องไม่ถูกนับเป็นเงินโปะของแผนใหม่
 *
 * เคสจริง: บ้านรังสิต บันทึก "โปะบางส่วน" ไว้ 350,000 พอเปิดหน้าวางแผนโปะ
 * แผนยังว่าง แต่แผงสรุปอ่านว่า "ได้คืนต่อเงินโปะ 1 บาท = 0.00 บาท"
 * เพราะตัวเศษเป็นผลต่างจากเส้นฐาน (= 0) ส่วนตัวหารเป็นยอดสะสม (= 350,000)
 */
describe('TV-43 เงินโปะของแผน = ส่วนต่างจากเส้นฐาน ไม่ใช่ยอดสะสม', () => {
  const PREPAID: PaymentEvent[] = [
    { date: isoDate('2026-06-15'), amountSatang: s(350_000), kind: 'partial_prepay' },
  ]
  // เส้นฐานของคนที่โปะไปแล้ว คือตารางที่นับการโปะนั้นไว้แล้ว
  const paidBaseline = buildSchedule(TERMS, PREPAID)

  it('โปะไปแล้ว 350,000 แต่ยังไม่วางแผนอะไร -> ทุกตัวเลขเป็นศูนย์ และ ROI เป็น null', () => {
    const withPlan = buildSchedule(TERMS, PREPAID, planOf(0))
    const r = evaluatePrepayPlan({
      loanId: 'a',
      baseline: paidBaseline,
      withPlan,
      otherLoans: [],
      marginalTaxRateBps: null,
    })
    expect(r.periodsSaved).toBe(0)
    expect(r.interestSavedFixed).toBe(0n)
    expect(r.totalPrepaidFixed).toBe(0n)
    // ⛔ ก่อนแก้ค่านี้เป็น 0 ทำให้หน้าจอโชว์ "0.00 บาท" เหมือนโปะแล้วไม่ได้อะไรเลย
    expect(r.roiBps).toBeNull()
  })

  it('วางแผนโปะเพิ่มบนคนที่โปะไปแล้ว -> นับเฉพาะส่วนที่เพิ่ม', () => {
    const withPlan = buildSchedule(TERMS, PREPAID, planOf(5_000))
    const r = evaluatePrepayPlan({
      loanId: 'a',
      baseline: paidBaseline,
      withPlan,
      otherLoans: [],
      marginalTaxRateBps: null,
    })
    const onlyPlan = evaluatePrepayPlan({
      loanId: 'a',
      baseline,
      withPlan: buildSchedule(TERMS, [], planOf(5_000)),
      otherLoans: [],
      marginalTaxRateBps: null,
    })
    expect(r.totalPrepaidFixed).toBeGreaterThan(0n)
    // 350,000 ที่โปะไปแล้วต้องไม่โผล่มาในตัวหาร — ยอดของแผนเท่านั้น
    expect(r.totalPrepaidFixed).toBeLessThan(onlyPlan.totalPrepaidFixed)
    expect(r.roiBps).not.toBeNull()
  })
})
