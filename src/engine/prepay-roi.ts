/**
 * ผลตอบแทนของแผนโปะ (spec ข้อ 3.4)
 *
 *   ROI ต่อบาทที่โปะ = ดอกเบี้ยที่ประหยัด ÷ เงินที่โปะ
 *
 * ตัวเลขนี้ **ลดลง** เมื่อโปะหนักขึ้น เพราะหนี้หมดเร็วจนไม่เหลือดอกเบี้ยให้ประหยัด
 * ต้องแสดง diminishing return ไม่ใช่บอกแค่ว่าโปะเยอะดี
 *
 * ROI หลังภาษีต่างกันตามปี
 *   ปีที่ดอกเบี้ยเกินเพดานลดหย่อน การโปะให้ผลเต็ม เพราะส่วนเกินไม่ได้ลดหย่อนอยู่แล้ว
 *   ปีที่ดอกเบี้ยต่ำกว่าเพดาน โปะไป 1 บาทจะเสียสิทธิลดหย่อน 1 บาทด้วย
 *
 * ⚠️ เพดานลดหย่อนเป็นของคนหนึ่งคนต่อปี ไม่ใช่ต่อสัญญา (ข้อ 1.9)
 *    การคิดว่าโปะแล้วเสียสิทธิเท่าไหร่ จึงต้องมองสัญญาอื่นของคนเดียวกันด้วย
 *    ไม่งั้นจะบอกว่าเสียสิทธิ ทั้งที่สิทธิเต็มไปแล้วจากอีกสัญญา (ข้อ 1.9 บรรทัดสุดท้าย)
 */

import { type Fixed, ZERO_FIXED } from './money.js'
import { summariseTaxYears } from './grouping.js'
import type { ScheduleResult, ScheduleRow } from './types.js'

export type PrepayOutcome = {
  /** ปิดหนี้เร็วขึ้นกี่งวด */
  periodsSaved: number
  interestSavedFixed: Fixed
  totalPrepaidFixed: Fixed
  /** ดอกที่ประหยัดต่อเงินโปะ 1 บาท เป็น bps — null = ยังไม่ได้โปะเลย */
  roiBps: number | null
  /** สิทธิลดหย่อนที่หายไปเพราะดอกเบี้ยลดลง คิดรวมเพดานข้ามสัญญาแล้ว */
  deductionLostFixed: Fixed
  /** null = ผู้ใช้ยังไม่กรอกอัตราภาษี ⛔ ห้ามเดาแทน */
  afterTaxRoiBps: number | null
}

export type OtherLoanRows = { loanId: string; rows: readonly ScheduleRow[] }

export function evaluatePrepayPlan(args: {
  loanId: string
  /** ตารางเดิมที่ยังไม่ใส่แผนโปะ */
  baseline: ScheduleResult
  /** ตารางหลังใส่แผนโปะ */
  withPlan: ScheduleResult
  /** สัญญาอื่นของคนเดียวกัน ใช้คิดเพดานลดหย่อนร่วม */
  otherLoans: readonly OtherLoanRows[]
  marginalTaxRateBps: number | null
}): PrepayOutcome {
  const { loanId, baseline, withPlan, otherLoans, marginalTaxRateBps } = args

  const interestSaved = (baseline.totalInterestFixed - withPlan.totalInterestFixed) as Fixed
  const totalPrepaid = withPlan.rows.reduce((a, r) => (a + r.prepayFixed) as Fixed, ZERO_FIXED)
  const periodsSaved = baseline.rows.length - withPlan.rows.length

  const roiBps =
    totalPrepaid > 0n ? Number((interestSaved * 10_000n) / totalPrepaid) : null

  // สิทธิลดหย่อนที่หายไป = ผลต่างของ "ส่วนที่ใช้สิทธิได้" ไม่ใช่ผลต่างของดอกเบี้ยดิบ
  const before = summariseTaxYears([
    { loanId, rows: baseline.rows },
    ...otherLoans,
  ])
  const after = summariseTaxYears([{ loanId, rows: withPlan.rows }, ...otherLoans])
  const afterByYear = new Map(after.map((t) => [t.taxYear, t.deductibleFixed]))

  let deductionLost = ZERO_FIXED
  for (const b of before) {
    const a = afterByYear.get(b.taxYear) ?? ZERO_FIXED
    // ปีที่โปะแล้วสิทธิยังเต็มเหมือนเดิม ผลต่างเป็น 0 ไม่ใช่ติดลบ
    const lost = b.deductibleFixed - a
    if (lost > 0n) deductionLost = (deductionLost + lost) as Fixed
  }

  const afterTaxRoiBps =
    marginalTaxRateBps === null || roiBps === null
      ? null
      : Number(
          ((interestSaved - (deductionLost * BigInt(marginalTaxRateBps)) / 10_000n) * 10_000n) /
            totalPrepaid,
        )

  return {
    periodsSaved,
    interestSavedFixed: interestSaved,
    totalPrepaidFixed: totalPrepaid,
    roiBps,
    deductionLostFixed: deductionLost,
    afterTaxRoiBps,
  }
}
