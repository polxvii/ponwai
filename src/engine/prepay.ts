/**
 * แผนโปะ (spec ข้อ 3.4)
 *
 * 30 ปีมี 360 เดือน กรอกมือทั้งหมดไม่ไหว และเก็บเป็น array 360 ช่องก็ผิด
 * จึงเก็บเป็น "แผน 12 เดือน + override รายปี + ก้อนเดี่ยวตามวันที่"
 *
 * การ resolve 3 ชั้น:
 *   amount(year, month) = overrides[year][month]        ชนะทุกอย่าง
 *                      ?? months[month]                 ถ้า repeatMode ครอบคลุมปีนั้น
 *                      ?? 0
 *   แล้ว "บวก" lumps ที่ตรงวันจ่ายงวดนั้น — บวกเพิ่ม ไม่ใช่แทนที่ (TV-22)
 */

import { type ISODate, year as getYear, month as getMonth } from './date.js'
import { type Satang, ZERO_SATANG } from './money.js'

export type PrepayRepeatMode = 'single_year' | 'repeat_forever' | 'repeat_until'

export type PrepayLump = {
  payDate: ISODate
  amountSatang: Satang
  label?: string
}

export type PrepayPlan = {
  baseYear: number
  repeatMode: PrepayRepeatMode
  repeatUntilYear: number | null
  /** เดือน 1-12 -> ยอดโปะของปีฐาน */
  months: Readonly<Record<number, Satang>>
  /** ปี -> เดือน -> ยอดโปะ ใช้เฉพาะปีที่ต่างจากปีฐาน */
  overrides: Readonly<Record<number, Readonly<Record<number, Satang>>>>
  lumps: readonly PrepayLump[]
}

export function emptyPlan(baseYear: number): PrepayPlan {
  return {
    baseYear,
    repeatMode: 'repeat_forever',
    repeatUntilYear: null,
    months: {},
    overrides: {},
    lumps: [],
  }
}

/** ปีนี้อยู่ในช่วงที่แผนฐานครอบคลุมไหม */
export function planCoversYear(plan: PrepayPlan, y: number): boolean {
  if (y < plan.baseYear) return false
  switch (plan.repeatMode) {
    case 'single_year': return y === plan.baseYear
    case 'repeat_forever': return true
    case 'repeat_until': return plan.repeatUntilYear !== null && y <= plan.repeatUntilYear
  }
}

/** ยอดโปะรายเดือน ยังไม่รวม lumps */
export function resolveMonthlyPrepay(plan: PrepayPlan, y: number, m: number): Satang {
  const override = plan.overrides[y]?.[m]
  if (override !== undefined) return override
  if (!planCoversYear(plan, y)) return ZERO_SATANG
  return plan.months[m] ?? ZERO_SATANG
}

/** ผลรวม lumps ที่ตรงวันนั้นพอดี — หลายก้อนในวันเดียวต้องบวกรวมกันทั้งหมด */
export function resolveLumpsOn(plan: PrepayPlan, d: ISODate): Satang {
  let total = 0n
  for (const l of plan.lumps) {
    if (l.payDate === d) total += l.amountSatang
  }
  return total as Satang
}

/**
 * ยอดโปะทั้งหมดที่ตกกับวันตัดยอดวันนี้
 * = ยอดรายเดือนของเดือนนั้น + lumps ที่ตรงวันนี้
 */
export function resolvePrepayOn(plan: PrepayPlan, d: ISODate): Satang {
  const monthly = resolveMonthlyPrepay(plan, getYear(d), getMonth(d))
  return (monthly + resolveLumpsOn(plan, d)) as Satang
}

/** ปุ่ม "คัดลอกไปปีถัดไป" — สร้าง override ชุดใหม่จากยอดที่ resolve ได้ของปีต้นทาง */
export function copyYearToOverrides(plan: PrepayPlan, fromYear: number, toYear: number): PrepayPlan {
  const copied: Record<number, Satang> = {}
  for (let m = 1; m <= 12; m++) {
    copied[m] = resolveMonthlyPrepay(plan, fromYear, m)
  }
  return { ...plan, overrides: { ...plan.overrides, [toYear]: copied } }
}
