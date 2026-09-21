/**
 * วันที่แบบ civil date ล้วน — ไม่มีเวลา ไม่มี timezone (spec ข้อ 8)
 *
 * ห้ามใช้ `Date` ของ JavaScript ในโฟลเดอร์นี้เด็ดขาด
 * เพราะ `new Date('2026-10-01')` ตีความเป็น UTC midnight แล้วพอ toLocaleDateString
 * ในเขตเวลา UTC+7 จะกลายเป็นวันที่ถูกต้อง แต่ในเขตเวลาติดลบจะเลื่อนไปวันก่อนหน้า
 * ดอกเบี้ยทั้งงวดจะผิดทันทีโดยที่ test บนเครื่อง dev (ที่ tz ตรงกันพอดี) ไม่เจอ
 */

/** 'YYYY-MM-DD' เท่านั้น */
export type ISODate = string & { readonly __brand: 'ISODate' }

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isoDate(s: string): ISODate {
  const m = ISO_RE.exec(s)
  if (!m) throw new Error(`ISODate ต้องเป็นรูปแบบ YYYY-MM-DD ได้ '${s}'`)
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (mo < 1 || mo > 12) throw new Error(`เดือนไม่ถูกต้อง: ${s}`)
  if (d < 1 || d > daysInMonth(y, mo)) throw new Error(`วันไม่ถูกต้อง: ${s}`)
  return s as ISODate
}

export function ymd(y: number, m: number, d: number): ISODate {
  return isoDate(
    `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  )
}

export function year(d: ISODate): number { return Number(d.slice(0, 4)) }
export function month(d: ISODate): number { return Number(d.slice(5, 7)) }
export function day(d: ISODate): number { return Number(d.slice(8, 10)) }

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

/** จำนวนวันในปีนั้น 365 หรือ 366 */
export function daysInYear(y: number): number {
  return isLeapYear(y) ? 366 : 365
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!
}

/**
 * เลขวันต่อเนื่องแบบ proleptic Gregorian (Rata Die)
 * ใช้สำหรับลบกันหาจำนวนวัน — ไม่พึ่ง Date จึงไม่มีปัญหา timezone
 */
export function toDayNumber(d: ISODate): number {
  let y = year(d)
  const m = month(d)
  const day_ = day(d)
  // เลื่อนให้ปีเริ่มเดือนมีนาคม เพื่อให้วันอธิกสุรทินไปอยู่ท้ายปี
  const a = Math.floor((14 - m) / 12)
  y = y + 4800 - a
  const mm = m + 12 * a - 3
  return (
    day_ +
    Math.floor((153 * mm + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  )
}

export function fromDayNumber(n: number): ISODate {
  const a = n + 32044
  const b = Math.floor((4 * a + 3) / 146097)
  const c = a - Math.floor((146097 * b) / 4)
  const d2 = Math.floor((4 * c + 3) / 1461)
  const e = c - Math.floor((1461 * d2) / 4)
  const m2 = Math.floor((5 * e + 2) / 153)
  const dd = e - Math.floor((153 * m2 + 2) / 5) + 1
  const mm = m2 + 3 - 12 * Math.floor(m2 / 10)
  const yy = 100 * b + d2 - 4800 + Math.floor(m2 / 10)
  return ymd(yy, mm, dd)
}

/** จำนวนวันจาก a ถึง b แบบปลายเปิด [a, b) — ค่าลบได้ถ้า b มาก่อน a */
export function daysBetween(a: ISODate, b: ISODate): number {
  return toDayNumber(b) - toDayNumber(a)
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromDayNumber(toDayNumber(d) + n)
}

/**
 * บวกเดือนโดย clamp วันที่ให้ไม่เกินวันสุดท้ายของเดือนปลายทาง
 * ใช้ `anchorDay` เป็นวันที่ตั้งต้นเสมอ ไม่ใช่วันของ d — กฎ anchor ต้องไม่ไหล (spec ข้อ 1.4.3)
 */
export function addMonthsClamped(d: ISODate, n: number, anchorDay: number): ISODate {
  const total = (year(d) * 12 + (month(d) - 1)) + n
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return ymd(y, m, Math.min(anchorDay, daysInMonth(y, m)))
}

export function compare(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function isBefore(a: ISODate, b: ISODate): boolean { return a < b }
export function isAfter(a: ISODate, b: ISODate): boolean { return a > b }
export function minDate(a: ISODate, b: ISODate): ISODate { return a <= b ? a : b }
export function maxDate(a: ISODate, b: ISODate): ISODate { return a >= b ? a : b }

/** 0 = อาทิตย์ ... 6 = เสาร์ */
export function dayOfWeek(d: ISODate): number {
  // 1970-01-01 (dayNumber 2440588) เป็นวันพฤหัสบดี = 4
  return (((toDayNumber(d) - 2440588 + 4) % 7) + 7) % 7
}

export function isWeekend(d: ISODate): boolean {
  const w = dayOfWeek(d)
  return w === 0 || w === 6
}

/** วันแรกของปีถัดไป ใช้ตัดช่วง accrual ที่ขอบปีในโหมด ACT/ACT (spec ข้อ 1.1.1) */
export function startOfNextYear(d: ISODate): ISODate {
  return ymd(year(d) + 1, 1, 1)
}
