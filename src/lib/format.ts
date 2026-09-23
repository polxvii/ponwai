/**
 * การแสดงผลตัวเลขและวันที่ (spec ข้อ 5.3)
 *
 * ⛔ ชั้นนี้เท่านั้นที่แปลง ค.ศ. เป็น พ.ศ.
 *    DB / engine / test ใช้ ISO ค.ศ. เสมอ ห้ามเก็บ พ.ศ. ลง DB เด็ดขาด
 *    ห้ามบวก 543 กระจายตามไฟล์ ให้เรียกจากที่นี่ที่เดียว
 */

import { type ISODate, addDays, daysBetween } from '@engine/date.js'
import type { Satang, Fixed } from '@engine/money.js'
import { formatSatangBaht, formatFixedBaht } from '@engine/money.js'

// ---------- วันที่ ----------

const TH_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
] as const

const TH_MONTHS_LONG = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
] as const

/** ปี พ.ศ. จากวันที่ ISO ค.ศ. */
export function thaiYear(iso: ISODate): number {
  return Number(iso.slice(0, 4)) + 543
}

export type DateStyle = 'short' | 'long' | 'monthYear' | 'yearOnly'

/**
 * แปลงวันที่ ISO เป็นข้อความไทย พ.ศ.
 * ไม่ใช้ Intl เพราะต้องการผลลัพธ์ที่คงที่ข้ามเบราว์เซอร์และข้าม locale ของเครื่อง
 * (Intl th-TH-u-ca-buddhist ให้รูปแบบต่างกันตาม runtime ซึ่งทำให้ snapshot test เพี้ยน)
 */
export function formatThaiDate(iso: ISODate, style: DateStyle = 'short'): string {
  const y = thaiYear(iso)
  const m = Number(iso.slice(5, 7))
  const d = Number(iso.slice(8, 10))

  switch (style) {
    case 'yearOnly':  return String(y)
    case 'monthYear': return `${TH_MONTHS_SHORT[m - 1]} ${y}`
    case 'long':      return `${d} ${TH_MONTHS_LONG[m - 1]} ${y}`
    case 'short':     return `${d} ${TH_MONTHS_SHORT[m - 1]} ${y}`
  }
}

/** ช่วงวันที่คิดดอกเบี้ย — แสดงตามรูปแบบที่ใบแจ้งยอดธนาคารใช้ (ข้อ 1.4.3) */
export function formatAccrualRange(
  from: ISODate,
  to: ISODate,
  display: 'start_inclusive' | 'end_inclusive' = 'start_inclusive',
): string {
  if (display === 'start_inclusive') {
    return `${formatThaiDate(from)} – ${formatThaiDate(addDays(to, -1))}`
  }
  return `${formatThaiDate(addDays(from, 1))} – ${formatThaiDate(to)}`
}

// ---------- เงิน ----------

/** 1,234,567.89 */
export function baht(v: Satang, decimals = 2): string {
  return formatSatangBaht(v, decimals)
}

/** จาก Fixed ที่ engine คืนมา */
export function bahtFixed(v: Fixed, decimals = 2): string {
  return formatFixedBaht(v, decimals)
}

/** ตัดสตางค์ทิ้ง ใช้กับตัวเลขใหญ่ที่สตางค์ไม่มีความหมาย เช่น ดอกเบี้ยรวม 30 ปี */
export function bahtRounded(v: Fixed): string {
  return formatFixedBaht(v, 0)
}

/** ย่อเป็นหน่วยล้าน/แสน สำหรับแกนกราฟที่พื้นที่จำกัด */
export function bahtCompact(v: Fixed): string {
  const n = Number(v / 1_000_000_000_000n) / 100
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} ล้าน`
  if (abs >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(Math.round(n))
}

// ---------- อัตราดอกเบี้ย ----------

/** bps -> '3.14%' */
export function pct(bps: number, decimals = 2): string {
  return `${(bps / 100).toFixed(decimals)}%`
}

/** bps -> '3.14' โดยไม่มีเครื่องหมาย % สำหรับใส่ในตารางที่มีหัวคอลัมน์บอกหน่วยแล้ว */
export function pctValue(bps: number, decimals = 2): string {
  return (bps / 100).toFixed(decimals)
}

// ---------- จำนวนงวด / ระยะเวลา ----------

/** 226 -> '18 ปี 10 เดือน' */
export function formatDuration(months: number): string {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} เดือน`
  if (m === 0) return `${y} ปี`
  return `${y} ปี ${m} เดือน`
}

export function formatPeriods(n: number): string {
  return `${n.toLocaleString('en-US')} งวด`
}

// ---------- ป้ายกำกับ ----------

/** ป้ายที่บอกว่าข้อมูลเก่าแค่ไหน ถ้าเกิน 90 วันให้เตือน (ข้อ 2.5) */
export function freshnessLabel(
  asOf: ISODate,
  today: ISODate,
): { text: string; stale: boolean } {
  const days = daysBetween(asOf, today)
  if (days < 0) return { text: 'วันที่ในอนาคต', stale: true }
  if (days === 0) return { text: 'อัปเดตวันนี้', stale: false }
  if (days < 30) return { text: `อัปเดต ${days} วันที่แล้ว`, stale: false }
  const months = Math.floor(days / 30)
  return { text: `อัปเดต ${months} เดือนที่แล้ว`, stale: days > 90 }
}

/**
 * ช่วงเดือนของกลุ่มงวด เช่น "ม.ค. 2570 – ธ.ค. 2570"
 * "ปีสัญญาที่ 3" อย่างเดียวไม่บอกว่าเป็นเดือนไหนของปีไหน ต้องกางปฏิทินในหัวเอง
 */
export function formatMonthSpan(from: ISODate, to: ISODate): string {
  const a = formatThaiDate(from, 'monthYear')
  const b = formatThaiDate(to, 'monthYear')
  return a === b ? a : `${a} – ${b}`
}
