/**
 * แผนโปะ (spec ข้อ 3.4)
 *
 * 30 ปีมี 360 เดือน กรอกมือทั้งหมดไม่ไหว และเก็บเป็น array 360 ช่องก็ผิด
 * จึงเก็บเป็น "แผน 12 เดือน + override รายปี"
 *
 * การ resolve:
 *   amount(year, month) = overrides[year][month]        ชนะทุกอย่าง
 *                      ?? months[month]                 ถ้า repeatMode ครอบคลุมปีนั้น
 *                      ?? 0
 *
 * ⛔ เคยมี "ก้อนเดี่ยวตามวันที่" (lumps) — เอาออกแล้ว ห้ามใส่กลับ
 *    มันนับก้อนนั้นเฉพาะเมื่อวันที่ตรงวันตัดงวดเป๊ะ ๆ ไม่ตรงก็ถูกทิ้งเงียบ ๆ
 *    ความแม่นระดับวันที่ที่มันเสนอจึงเป็นของปลอม เพราะแผนลงที่วันตัดงวดเสมอ
 *    และซ้ำกับปฏิทินรายเดือนที่ทำงานเดียวกันอยู่แล้ว [SOURCE: ผู้ใช้]
 *    การโปะจริงที่เกิดขึ้นแล้วให้บันทึกเป็นรายการจ่าย ซึ่งตัดดอกตามวันจริง (TV-51)
 */

import { type ISODate, year as getYear, month as getMonth } from './date.js'
import { type Satang, ZERO_SATANG } from './money.js'

export type PrepayRepeatMode = 'single_year' | 'repeat_forever' | 'repeat_until'

export type PrepayPlan = {
  baseYear: number
  repeatMode: PrepayRepeatMode
  repeatUntilYear: number | null
  /** เดือน 1-12 -> ยอดโปะของปีฐาน */
  months: Readonly<Record<number, Satang>>
  /** ปี -> เดือน -> ยอดโปะ ใช้เฉพาะปีที่ต่างจากปีฐาน */
  overrides: Readonly<Record<number, Readonly<Record<number, Satang>>>>
}

export function emptyPlan(baseYear: number): PrepayPlan {
  return {
    baseYear,
    repeatMode: 'repeat_forever',
    repeatUntilYear: null,
    months: {},
    overrides: {},
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

/** ยอดโปะของเดือนนั้นตามแผน */
export function resolveMonthlyPrepay(plan: PrepayPlan, y: number, m: number): Satang {
  const override = plan.overrides[y]?.[m]
  if (override !== undefined) return override
  if (!planCoversYear(plan, y)) return ZERO_SATANG
  return plan.months[m] ?? ZERO_SATANG
}

/** ยอดโปะตามแผนที่ตกกับวันตัดยอดวันนี้ */
export function resolvePrepayOn(plan: PrepayPlan, d: ISODate): Satang {
  return resolveMonthlyPrepay(plan, getYear(d), getMonth(d))
}

/** ปุ่ม "คัดลอกไปปีถัดไป" — สร้าง override ชุดใหม่จากยอดที่ resolve ได้ของปีต้นทาง */
export function copyYearToOverrides(plan: PrepayPlan, fromYear: number, toYear: number): PrepayPlan {
  const copied: Record<number, Satang> = {}
  for (let m = 1; m <= 12; m++) {
    copied[m] = resolveMonthlyPrepay(plan, fromYear, m)
  }
  return { ...plan, overrides: { ...plan.overrides, [toYear]: copied } }
}
