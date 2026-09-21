/**
 * สร้างวันครบกำหนด (spec ข้อ 1.4.1 + 1.4.3)
 *
 *   nominal(n) = addMonths(startDate, n, dueDayOfMonth)   clamp สิ้นเดือน
 *   rolled(n)  = roll(nominal(n), dateRoll, rollCalendar)
 *   actual(n)  = overrides[n] ?? rolled(n)
 *
 * ⛔ กฎเหล็ก: nominal(n) นับจาก startDate เสมอ ห้ามนับต่อจาก actual(n−1)
 * ถ้า anchor เลื่อนตาม วันตัดจะไหลจากวันที่ 5 ไปถึงวันที่ 1 ภายใน 30 ปี (TV-32)
 */

import {
  type ISODate, addMonthsClamped, addDays, isWeekend, daysBetween,
} from './date.js'
import type { DateRoll, RollCalendar } from './types.js'

export type DateRuleConfig = {
  startDate: ISODate
  dueDayOfMonth: number
  dateRoll: DateRoll
  rollCalendar: RollCalendar
  bankHolidays: ReadonlySet<ISODate>
  overrides: Readonly<Record<number, ISODate>>
}

export function isNonBusinessDay(
  d: ISODate,
  calendar: RollCalendar,
  holidays: ReadonlySet<ISODate>,
): boolean {
  if (isWeekend(d)) return true
  return calendar === 'weekend_and_bank_holidays' && holidays.has(d)
}

/**
 * เลื่อนวันตามกฎ
 *   preceding = ขยับมา "เร็วขึ้น" เป็นวันทำการก่อนหน้า — มีอยู่จริงในสัญญาไทย [SOURCE: ผู้ใช้]
 *   following = เลื่อนออกไปเป็นวันทำการถัดไป
 * ระวังอย่าสลับทิศ ผลต่างเป็นคนละเครื่องหมายกัน
 */
export function rollDate(
  d: ISODate,
  roll: DateRoll,
  calendar: RollCalendar,
  holidays: ReadonlySet<ISODate>,
): ISODate {
  if (roll === 'none') return d
  const step = roll === 'preceding' ? -1 : 1
  let cur = d
  // กันลูปไม่รู้จบถ้าปฏิทินวันหยุดถูกกรอกผิดจนทั้งสัปดาห์เป็นวันหยุด
  for (let guard = 0; guard < 30; guard++) {
    if (!isNonBusinessDay(cur, calendar, holidays)) return cur
    cur = addDays(cur, step)
  }
  throw new Error(`หาวันทำการไม่เจอภายใน 30 วันจาก ${d} — ปฏิทินวันหยุดน่าจะผิด`)
}

/** วันตัดตามกฎ ยังไม่รวม override */
export function nominalDueDate(cfg: DateRuleConfig, period: number): ISODate {
  return addMonthsClamped(cfg.startDate, period, cfg.dueDayOfMonth)
}

/** วันตัดจริง = override ?? rolled(nominal) */
export function actualDueDate(cfg: DateRuleConfig, period: number): ISODate {
  const override = cfg.overrides[period]
  if (override !== undefined) return override
  return rollDate(nominalDueDate(cfg, period), cfg.dateRoll, cfg.rollCalendar, cfg.bankHolidays)
}

/**
 * ตรวจ override ทุกตัวว่าไม่ทำให้ accrual ติดลบ (spec TV-33)
 * ต้องเรียกตอน validate ฟอร์ม ไม่ใช่ปล่อยให้ engine คำนวณแล้วออกเลขประหลาด
 */
export function validateOverrides(cfg: DateRuleConfig, termMonths: number): OverrideProblem[] {
  const problems: OverrideProblem[] = []
  for (const key of Object.keys(cfg.overrides)) {
    const n = Number(key)
    const value = cfg.overrides[n]
    if (value === undefined) continue

    if (!Number.isInteger(n) || n < 1 || n > termMonths) {
      problems.push({ period: n, date: value, reason: 'period_out_of_range' })
      continue
    }
    const prev = n === 1 ? cfg.startDate : actualDueDate(cfg, n - 1)
    if (value <= prev) {
      problems.push({ period: n, date: value, reason: 'not_after_previous', comparedTo: prev })
    }
    if (n < termMonths) {
      const nextNominal = nominalDueDate(cfg, n + 1)
      if (value >= nextNominal) {
        problems.push({ period: n, date: value, reason: 'not_before_next', comparedTo: nextNominal })
      }
    }
  }
  return problems
}

export type OverrideProblem = {
  period: number
  date: ISODate
  reason: 'period_out_of_range' | 'not_after_previous' | 'not_before_next'
  comparedTo?: ISODate
}

/** สร้างวันตัดทั้งตาราง พร้อมจำนวนวันของแต่ละงวด ใช้ตรวจว่าไม่มีวันหายหรือนับซ้ำ */
export function buildDueDates(
  cfg: DateRuleConfig,
  count: number,
): { period: number; nominal: ISODate; actual: ISODate; from: ISODate; days: number }[] {
  const out = []
  let prev = cfg.startDate
  for (let n = 1; n <= count; n++) {
    const nominal = nominalDueDate(cfg, n)
    const actual = actualDueDate(cfg, n)
    out.push({ period: n, nominal, actual, from: prev, days: daysBetween(prev, actual) })
    prev = actual
  }
  return out
}
