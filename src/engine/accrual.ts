/**
 * ดอกเบี้ยรายวันจากเงินต้นคงเหลือ (spec ข้อ 1.1)
 *
 *   interest(d0 -> d1) = Σ  balance × rate ÷ ตัวหารตาม day-count basis
 *                      d ∈ [d0, d1)
 *
 * ช่วงเป็นปลายเปิดเสมอ: วันตัดยอดนับเป็นวันแรกของงวดถัดไป ไม่ใช่วันสุดท้ายของงวดนี้
 * (เขียนแบบ (d0, d1] ก็ได้จำนวนวันเท่ากัน ดูข้อ 1.4.3 — แต่ engine ใช้ [d0, d1) แบบเดียวตลอด)
 */

import {
  type ISODate, daysBetween, daysInYear, isLeapYear,
  year, month, day, startOfNextYear, minDate, toDayNumber, fromDayNumber,
} from './date.js'
import {
  type Fixed, type Bps, BPS_DENOM, ZERO_FIXED,
} from './money.js'

export type DayCountBasis =
  /** หาร 365 เสมอ + นับ 29 ก.พ. ด้วย -> ปีอธิกสุรทินจ่าย 366/365 ของอัตรา nominal */
  | 'ACT/365F'
  /** หาร 366 ในปีอธิกสุรทิน -> จ่ายพอดี 1 ปี ต้องตัดช่วงที่ขอบปีปฏิทิน */
  | 'ACT/ACT'
  /** หาร 365 + ไม่นับ 29 ก.พ. — ยังไม่พบหลักฐานว่าธนาคารไทยใช้จริง มีไว้ให้ inference ลอง */
  | 'ACT/365_SKIP'

export const ALL_DAY_COUNT_BASES: readonly DayCountBasis[] = [
  'ACT/365F',
  'ACT/ACT',
  'ACT/365_SKIP',
] as const

/**
 * จำนวนวันที่คิดดอกเบี้ยจริงในช่วง [d0, d1) ตาม basis
 * ต่างจาก daysBetween เฉพาะโหมด ACT/365_SKIP ที่ข้ามวันที่ 29 ก.พ.
 */
export function accrualDays(d0: ISODate, d1: ISODate, basis: DayCountBasis): number {
  const raw = daysBetween(d0, d1)
  if (basis !== 'ACT/365_SKIP') return raw
  return raw - countLeapDays(d0, d1)
}

/** นับจำนวนวันที่ 29 ก.พ. ในช่วง [d0, d1) โดยไม่ต้องวนทีละวัน */
function countLeapDays(d0: ISODate, d1: ISODate): number {
  if (d0 >= d1) return 0
  let n = 0
  for (let y = year(d0); y <= year(d1); y++) {
    if (!isLeapYear(y)) continue
    const feb29 = `${y}-02-29` as ISODate
    if (feb29 >= d0 && feb29 < d1) n++
  }
  return n
}

/**
 * ดอกเบี้ยสะสมในช่วง [d0, d1) ที่เงินต้นคงที่และอัตราคงที่
 * คืนค่าเป็น Fixed แบบ exact ยังไม่ปัด — ผู้เรียกเป็นคนตัดสินใจว่าจะปัดเมื่อไหร่
 *
 * โหมด ACT/ACT ต้องตัดช่วงที่ 31 ธ.ค. แล้วใช้ตัวหารคนละตัวสองท่อน
 * ห้ามใช้ตัวหารของปีที่งวดครบกำหนดกับทั้งช่วง (spec ข้อ 1.1.1 Implementation note)
 */
export function accrueInterest(
  balance: Fixed,
  rateBps: Bps,
  d0: ISODate,
  d1: ISODate,
  basis: DayCountBasis,
): Fixed {
  if (d0 > d1) throw new Error(`ช่วง accrual ติดลบ: ${d0} -> ${d1}`)
  if (d0 === d1) return ZERO_FIXED
  if (balance === 0n || rateBps === 0) return ZERO_FIXED

  const num = balance * BigInt(rateBps)

  if (basis === 'ACT/ACT') {
    let total = 0n
    let cur = d0
    while (cur < d1) {
      const segEnd = minDate(d1, startOfNextYear(cur))
      const days = BigInt(daysBetween(cur, segEnd))
      total += num * days / (BPS_DENOM * BigInt(daysInYear(year(cur))))
      cur = segEnd
    }
    return total as Fixed
  }

  const days = BigInt(accrualDays(d0, d1, basis))
  return (num * days / (BPS_DENOM * 365n)) as Fixed
}

/**
 * ดอกเบี้ยสะสมเมื่ออัตราเปลี่ยนกลางช่วง
 * `rateAt(d)` ต้องคืนอัตราที่มีผล ณ วันนั้น ตัวเรียกเป็นคนแก้ RateStep + ReferenceRate มาให้แล้ว
 *
 * ตัดช่วงทุกครั้งที่อัตราเปลี่ยน แล้วรวมกัน — ห้ามใช้อัตราเดียวทั้งงวด (spec TV-7)
 */
export function accrueInterestVariableRate(
  balance: Fixed,
  d0: ISODate,
  d1: ISODate,
  basis: DayCountBasis,
  rateAt: (d: ISODate) => Bps,
): { interest: Fixed; segments: RateSegment[] } {
  if (d0 > d1) throw new Error(`ช่วง accrual ติดลบ: ${d0} -> ${d1}`)
  if (d0 === d1) return { interest: ZERO_FIXED, segments: [] }

  const segments: RateSegment[] = []
  let total = 0n
  let segStart = d0
  let segRate = rateAt(d0)

  const end = toDayNumber(d1)
  for (let n = toDayNumber(d0) + 1; n <= end; n++) {
    const cur = fromDayNumber(n)
    const r = n === end ? null : rateAt(cur)
    if (r === null || r !== segRate) {
      const i = accrueInterest(balance, segRate, segStart, cur, basis)
      total += i
      segments.push({ from: segStart, to: cur, rateBps: segRate, interest: i })
      segStart = cur
      if (r !== null) segRate = r
    }
  }

  return { interest: total as Fixed, segments }
}

export type RateSegment = {
  from: ISODate
  /** ปลายเปิด */
  to: ISODate
  rateBps: Bps
  interest: Fixed
}

/** ใช้ตรวจว่าช่วงนี้คร่อมวันที่ 29 ก.พ. ไหม — สำหรับข้อความอธิบายในโมดูล reconciliation */
export function spansLeapDay(d0: ISODate, d1: ISODate): boolean {
  return countLeapDays(d0, d1) > 0
}

/** ใช้ใน UI: ช่วงนี้อยู่คร่อมขอบปีปฏิทินไหม (ACT/ACT จะให้ผลต่างจาก ACT/365F เฉพาะกรณีเกี่ยวกับปีอธิกฯ) */
export function spansYearBoundary(d0: ISODate, d1: ISODate): boolean {
  return year(d0) !== year(d1) || (month(d1) === 1 && day(d1) === 1 && year(d0) === year(d1) - 1)
}
