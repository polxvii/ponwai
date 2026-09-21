/**
 * จัดกลุ่มตารางผ่อนรายปี — 2 แกน (spec ข้อ 3.5)
 *
 *   ปีสัญญา  ตอบว่า "เรตที่ตกลงในสัญญากับที่จ่ายจริงตรงกันไหม"
 *   ปีปฏิทิน ตอบว่า "สิทธิลดหย่อนภาษีปีนี้ใช้เต็มหรือยัง"
 *
 * สองแกนนี้ไม่ทับกัน เพราะอัตราถูกนิยามด้วยเดือนของสัญญา
 * ส่วนเพดานลดหย่อนคิดเป็นปีปฏิทิน มีแกนเดียวจะเสียอย่างใดอย่างหนึ่งเสมอ
 *
 * ⛔ ทั้งสองแกนต้องมาจากตารางรายงวด "ชุดเดียวกัน" แล้วค่อยจัดกลุ่มทีหลัง
 *    ห้ามคำนวณแยกสองรอบ ไม่งั้นผลรวมจะไม่ตรงกัน (TV-25)
 */

import { year as getYear } from './date.js'
import { type Fixed, ZERO_FIXED } from './money.js'
import type { ScheduleRow } from './types.js'

export type GroupAxis = 'contract_year' | 'calendar_year'

export type YearGroup = {
  /** ปีสัญญา 1-indexed หรือ ปี ค.ศ. แล้วแต่แกน */
  key: number
  label: string
  rows: ScheduleRow[]
  periodCount: number
  /** ปีแรกกับปีสุดท้ายมักไม่ครบ 12 งวด ถ้าไม่ติดป้ายผู้ใช้จะเอาไปเทียบกับปีเต็มแล้วสรุปผิด */
  isPartialYear: boolean

  interestFixed: Fixed
  principalFixed: Fixed
  paymentFixed: Fixed
  prepayFixed: Fixed
  /** ยอดคงเหลือ ณ สิ้นกลุ่ม */
  closingBalanceFixed: Fixed

  /** อัตราที่จ่ายจริงถ่วงน้ำหนัก ไม่ใช่ค่าเฉลี่ยเลขคณิต (ดู effectiveRateOf) */
  effectiveRateBps: number
}

export function groupSchedule(rows: readonly ScheduleRow[], axis: GroupAxis): YearGroup[] {
  const buckets = new Map<number, ScheduleRow[]>()

  for (const r of rows) {
    const key = axis === 'contract_year'
      ? Math.floor((r.index - 1) / 12) + 1
      : getYear(r.date)
    const list = buckets.get(key)
    if (list) list.push(r)
    else buckets.set(key, [r])
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, groupRows]) => {
      const sum = (pick: (r: ScheduleRow) => Fixed): Fixed =>
        groupRows.reduce((a, r) => (a + pick(r)) as Fixed, ZERO_FIXED)

      const last = groupRows[groupRows.length - 1]!
      return {
        key,
        label: axis === 'contract_year' ? `ปีสัญญาที่ ${key}` : `ปี ${key + 543}`,
        rows: groupRows,
        periodCount: groupRows.length,
        isPartialYear: groupRows.length < 12,
        interestFixed: sum((r) => r.interestFixed),
        principalFixed: sum((r) => r.principalFixed),
        paymentFixed: sum((r) => r.paymentFixed),
        prepayFixed: sum((r) => r.prepayFixed),
        closingBalanceFixed: last.balanceAfterFixed,
        effectiveRateBps: effectiveRateOf(groupRows),
      }
    })
}

/**
 * อัตราที่จ่ายจริงของกลุ่มงวด ถ่วงน้ำหนักด้วยเงินต้นและจำนวนวัน
 *
 *   rate = Σ ดอกเบี้ย ÷ ( Σ (เงินต้นก่อนจ่าย × จำนวนวัน) ÷ 365 )
 *
 * ⛔ ห้ามเอาอัตรารายงวดมาบวกกันหารจำนวนงวด — ปีที่เปลี่ยนเรตกลางปีจะได้ตัวเลขที่ไม่มีความหมาย
 * ใช้สูตรนี้ทั้งกับการแสดงผลรายปี และการตรวจโฆษณา "ดอกเบี้ยเฉลี่ย 3 ปี" ของธนาคาร (TV-27)
 */
export function effectiveRateOf(rows: readonly ScheduleRow[]): number {
  let interest = ZERO_FIXED
  let weighted = 0n

  for (const r of rows) {
    interest = (interest + r.interestFixed) as Fixed
    const balanceBefore = r.balanceAfterFixed + r.principalFixed
    weighted += balanceBefore * BigInt(r.accrualDays)
  }

  if (weighted <= 0n) return 0
  // คูณ 1e6 ก่อนหารเพื่อเก็บทศนิยมของ bps
  return Number((interest * 10_000n * 365n * 1_000_000n) / weighted) / 1_000_000
}

/** ค่าเฉลี่ยเลขคณิตของอัตรา — มีไว้เทียบให้เห็นว่าต่างจากของจริงแค่ไหน ห้ามใช้แสดงผล */
export function arithmeticMeanRateBps(rateBpsList: readonly number[]): number {
  if (rateBpsList.length === 0) return 0
  return rateBpsList.reduce((a, b) => a + b, 0) / rateBpsList.length
}

// ---------- สิทธิลดหย่อนภาษี (spec ข้อ 1.9) ----------

/** เพดานดอกเบี้ยที่ลดหย่อนได้ต่อ "คน" ต่อปีภาษี รวมทุกสัญญา */
export const TAX_DEDUCTION_CAP_SATANG = 10_000_000n // 100,000 บาท

export type TaxYearSummary = {
  taxYear: number
  /** ดอกเบี้ยรวมทุกสัญญาของผู้ใช้ในปีภาษีนั้น */
  totalInterestFixed: Fixed
  /** ส่วนที่ใช้สิทธิได้จริง = min(ดอกเบี้ยรวม, เพดาน) */
  deductibleFixed: Fixed
  /** ส่วนเกินที่ใช้สิทธิไม่ได้ */
  excessFixed: Fixed
  /** สัญญาแต่ละตัวมีส่วนร่วมเท่าไหร่ — ใช้แสดงในหน้าของสัญญาเดี่ยว */
  byLoan: { loanId: string; interestFixed: Fixed }[]
}

/**
 * ⛔ เพดาน 100,000 เป็นของ "คน" ไม่ใช่ของ "สัญญา" (spec ข้อ 1.9)
 *
 * ผู้ใช้ที่มีบ้าน 2 หลังจะเห็นมิเตอร์สองอันที่ยังไม่เต็มทั้งคู่ แล้วเข้าใจว่าได้รวมกัน 200,000
 * ฟังก์ชันนี้จึงรับตารางของ "ทุกสัญญา" พร้อมกัน ห้ามเรียกทีละสัญญาแล้วเอาผลมาต่อกันเอง
 */
export function summariseTaxYears(
  loans: readonly { loanId: string; rows: readonly ScheduleRow[] }[],
  cap: bigint = TAX_DEDUCTION_CAP_SATANG * 1_000_000_000_000n,
): TaxYearSummary[] {
  const byYear = new Map<number, Map<string, Fixed>>()

  for (const loan of loans) {
    for (const r of loan.rows) {
      const y = getYear(r.date)
      let perLoan = byYear.get(y)
      if (!perLoan) { perLoan = new Map(); byYear.set(y, perLoan) }
      perLoan.set(loan.loanId, ((perLoan.get(loan.loanId) ?? ZERO_FIXED) + r.interestFixed) as Fixed)
    }
  }

  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([taxYear, perLoan]) => {
      const total = [...perLoan.values()].reduce((a, b) => (a + b) as Fixed, ZERO_FIXED)
      const deductible = (total > cap ? cap : total) as Fixed
      return {
        taxYear,
        totalInterestFixed: total,
        deductibleFixed: deductible,
        excessFixed: (total - deductible) as Fixed,
        byLoan: [...perLoan.entries()].map(([loanId, interestFixed]) => ({ loanId, interestFixed })),
      }
    })
}
