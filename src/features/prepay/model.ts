/**
 * State ของ Prepay Planner (spec ข้อ 3.4)
 *
 * UI กรอกเป็นบาท (number) engine รับเป็นสตางค์ (bigint) แปลงที่ชั้นนี้ที่เดียว
 *
 * ⚠️ 0 กับ "ไม่ได้ตั้ง" ไม่เหมือนกัน
 *    override ที่เป็น 0 = เดือนนั้นไม่โปะ แม้แผนฐานจะบอกให้โปะ
 *    ไม่มี override = ใช้แผนฐาน
 *    เก็บเป็น Record ที่ไม่มีคีย์ ไม่ใช่เก็บ 0 ทุกช่อง
 */

import { baht, type Satang } from '@engine/money.js'
import { isoDate, type ISODate } from '@engine/date.js'
import type { PrepayPlan, PrepayRepeatMode } from '@engine/prepay.js'

export type LumpDraft = {
  id: string
  payDate: ISODate
  amount: number | ''
  label: string
}

export type PrepayDraft = {
  baseYear: number
  repeatMode: PrepayRepeatMode
  repeatUntilYear: number | ''
  /** เดือน 1-12 -> บาท ของปีฐาน */
  months: Record<number, number>
  /** ปี -> เดือน -> บาท เฉพาะปีที่ต่างจากปีฐาน */
  overrides: Record<number, Record<number, number>>
  lumps: LumpDraft[]
}

export function emptyDraft(baseYear: number): PrepayDraft {
  return {
    baseYear,
    repeatMode: 'repeat_forever',
    repeatUntilYear: '',
    months: {},
    overrides: {},
    lumps: [],
  }
}

export const MONTH_NAMES = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
] as const

/** ชิปค่าสำเร็จรูป (ข้อ 3.4) — ยิงค่าเดียวลงทั้งช่วงที่เลือก */
export const PRESET_CHIPS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'ไม่โปะ' },
  { value: 3_000, label: '3,000' },
  { value: 4_000, label: '4,000' },
  { value: 5_000, label: '5,000' },
  { value: 10_000, label: '10,000' },
]

/** ยอดของเดือนหนึ่งในปีที่กำลังแก้ — ยังไม่รวม lumps */
export function amountAt(d: PrepayDraft, year: number, month: number): number {
  const override = d.overrides[year]?.[month]
  if (override !== undefined) return override
  if (year === d.baseYear || coversYear(d, year)) return d.months[month] ?? 0
  return 0
}

/**
 * ปีนี้กำลังแสดงยอดที่ทำซ้ำมาจากปีฐาน ไม่ใช่ยอดที่ผู้ใช้ตั้งไว้เองในปีนี้
 *
 * ⚠️ ต้องบอกผู้ใช้ตรงที่ปฏิทิน ไม่ใช่ให้เดาเอง
 *    ค่าตั้งต้นคือทำซ้ำทุกปีจนปิดหนี้ ใส่ยอดใน ต.ค.–ธ.ค. ปีเดียว
 *    แล้วเลื่อนไปปีหน้าเห็นยอดเดิมโผล่มาเองโดยไม่มีอะไรอธิบาย
 */
export function isRepeatedFromBase(d: PrepayDraft, year: number): boolean {
  if (year === d.baseYear) return false
  if (d.overrides[year] !== undefined) return false
  return coversYear(d, year) && Object.values(d.months).some((v) => v > 0)
}

/** ปีฐานมียอดที่จะถูกทำซ้ำไปปีอื่นหรือยัง */
export function baseRepeatsForward(d: PrepayDraft): boolean {
  return d.repeatMode !== 'single_year' && Object.values(d.months).some((v) => v > 0)
}

function coversYear(d: PrepayDraft, y: number): boolean {
  if (y < d.baseYear) return false
  switch (d.repeatMode) {
    case 'single_year': return y === d.baseYear
    case 'repeat_forever': return true
    case 'repeat_until':
      return typeof d.repeatUntilYear === 'number' && y <= d.repeatUntilYear
  }
}

/**
 * ตั้งยอดให้หลายเดือนพร้อมกัน
 * ปีฐานแก้ที่ months ปีอื่นแก้ที่ overrides — คนละที่กันโดยตั้งใจ
 * ไม่งั้นแก้ปีอื่นแล้วปีฐานเปลี่ยนตาม ซึ่งไม่ใช่สิ่งที่ผู้ใช้สั่ง
 */
export function setMonths(
  d: PrepayDraft,
  year: number,
  months: readonly number[],
  amount: number,
): PrepayDraft {
  if (year === d.baseYear) {
    const next = { ...d.months }
    for (const m of months) next[m] = amount
    return { ...d, months: next }
  }
  const forYear = { ...(d.overrides[year] ?? {}) }
  for (const m of months) forYear[m] = amount
  return { ...d, overrides: { ...d.overrides, [year]: forYear } }
}

/** ปุ่ม ±500 ปรับทั้งช่วง ไม่ให้ต่ำกว่า 0 */
export function bumpMonths(
  d: PrepayDraft,
  year: number,
  months: readonly number[],
  delta: number,
): PrepayDraft {
  let next = d
  for (const m of months) {
    next = setMonths(next, year, [m], Math.max(0, amountAt(d, year, m) + delta))
  }
  return next
}

/** คัดลอกยอดทั้งปีไปปีถัดไปเป็น override ชุดใหม่ (ข้อ 3.4) */
export function copyYear(d: PrepayDraft, fromYear: number, toYear: number): PrepayDraft {
  const copied: Record<number, number> = {}
  for (let m = 1; m <= 12; m++) copied[m] = amountAt(d, fromYear, m)
  return { ...d, overrides: { ...d.overrides, [toYear]: copied } }
}

/** ล้าง override ของปีนั้นทิ้ง กลับไปใช้แผนฐาน */
export function clearYearOverride(d: PrepayDraft, year: number): PrepayDraft {
  const next = { ...d.overrides }
  delete next[year]
  return { ...d, overrides: next }
}

const toSatang = (n: number): Satang => baht(Math.round(n * 100) / 100)

export function toPlan(d: PrepayDraft): PrepayPlan {
  const months: Record<number, Satang> = {}
  for (const [m, v] of Object.entries(d.months)) {
    if (v > 0) months[Number(m)] = toSatang(v)
  }

  const overrides: Record<number, Record<number, Satang>> = {}
  for (const [y, byMonth] of Object.entries(d.overrides)) {
    const forYear: Record<number, Satang> = {}
    // ⚠️ เก็บ 0 ไว้ด้วย เพราะ override ที่เป็น 0 แปลว่า "ปีนี้เดือนนี้ไม่โปะ"
    //    ซึ่งต่างจากไม่มี override ที่แปลว่า "ใช้แผนฐาน"
    for (const [m, v] of Object.entries(byMonth)) forYear[Number(m)] = toSatang(v)
    overrides[Number(y)] = forYear
  }

  return {
    baseYear: d.baseYear,
    repeatMode: d.repeatMode,
    repeatUntilYear: typeof d.repeatUntilYear === 'number' ? d.repeatUntilYear : null,
    months,
    overrides,
    lumps: d.lumps
      .filter((l) => typeof l.amount === 'number' && l.amount > 0)
      .map((l) => ({
        payDate: l.payDate,
        amountSatang: toSatang(l.amount as number),
        ...(l.label.trim() !== '' ? { label: l.label.trim() } : {}),
      })),
  }
}

export function fromPlan(p: PrepayPlan): PrepayDraft {
  const months: Record<number, number> = {}
  for (const [m, v] of Object.entries(p.months)) months[Number(m)] = Number(v) / 100

  const overrides: Record<number, Record<number, number>> = {}
  for (const [y, byMonth] of Object.entries(p.overrides)) {
    const forYear: Record<number, number> = {}
    for (const [m, v] of Object.entries(byMonth)) forYear[Number(m)] = Number(v) / 100
    overrides[Number(y)] = forYear
  }

  return {
    baseYear: p.baseYear,
    repeatMode: p.repeatMode,
    repeatUntilYear: p.repeatUntilYear ?? '',
    months,
    overrides,
    lumps: p.lumps.map((l, i) => ({
      id: `l${i}`,
      payDate: l.payDate,
      amount: Number(l.amountSatang) / 100,
      label: l.label ?? '',
    })),
  }
}

export function newLump(today: ISODate): LumpDraft {
  return {
    id: `l${Date.now().toString(36)}`,
    payDate: isoDate(today),
    amount: '',
    label: '',
  }
}

/** เดือนทั้งหมดระหว่าง 2 จุดที่แตะ รวมปลายทั้งสองข้าง */
export function monthRange(a: number, b: number): number[] {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
}
