/**
 * ปิดสัญญา — สัญญาที่ "จบแล้ว" ไม่ใช่สัญญาที่ "ไม่เคยมี"
 *
 * ⛔ ปิดสัญญาต้องเป็นแค่ป้ายสถานะ ห้ามแตะข้อมูลอื่นเลยแม้แต่แถวเดียว
 *    ไม่ลบรายการจ่าย ไม่ลบแผนโปะ ไม่ลบตารางผ่อน ไม่แก้ origin ของสัญญาใหม่
 *    เพราะปุ่มนี้ต้องกดกลับได้ และการกดกลับคืนได้เฉพาะสิ่งที่ไม่ได้ลบทิ้ง
 *
 * ⛔ ห้ามใช้ "ลบสัญญา" แทนการปิด payments ผูกด้วย on delete cascade
 *    ลบแล้วประวัติการจ่ายหายหมด ซึ่งเป็นข้อมูลที่ผู้ใช้กรอกเองทีละงวดและหาคืนไม่ได้
 *    และหนังสือรับรองดอกเบี้ยของปีที่ปิดยังต้องใช้ยื่นภาษีอยู่
 *
 * ⚠️ สัญญาที่ปิดแล้วยังต้องนับดอกเบี้ยที่ "จ่ายไปจริงก่อนวันปิด" เข้าสิทธิลดหย่อนปีนั้น
 *    แต่ต้องไม่นับงวดในอนาคตที่ไม่มีวันเกิดขึ้น — ตัดตารางที่วันปิดด้วย rowsUntilClose
 */

import type { ISODate } from '@engine/date.js'
import type { ScheduleRow } from '@engine/types.js'
import { formatThaiDate } from './format'

export type ClosingReason = 'refinanced' | 'paid_off'

export const CLOSING_REASONS: readonly { value: ClosingReason; label: string }[] = [
  { value: 'refinanced', label: 'รีไฟแนนซ์ไปสัญญาใหม่' },
  { value: 'paid_off', label: 'ผ่อนหมด / ปิดยอดเอง' },
]

export const CLOSING_REASON_LABELS: Record<ClosingReason, string> = {
  refinanced: 'รีไฟแนนซ์',
  paid_off: 'ปิดยอดแล้ว',
}

/**
 * ตารางผ่อนของสัญญาที่ปิดไปแล้ว — งวดหลังวันปิดไม่เกิดขึ้นจริง
 *
 * ⚠️ ตัดด้วยวันตัดงวด (r.date) ไม่ใช่เลขงวด เพราะวันปิดเป็นวันที่ ไม่ใช่งวด
 * ⚠️ งวดที่วันตัดตรงกับวันปิดพอดีต้องเก็บไว้ ดอกช่วงนั้นเกิดขึ้นจริงแล้ว
 */
export function rowsUntilClose(
  rows: readonly ScheduleRow[],
  closedDate: ISODate | null,
): readonly ScheduleRow[] {
  if (closedDate === null) return rows
  return rows.filter((r) => r.date <= closedDate)
}

export type CloseCheck = {
  closedDate: ISODate
  /** วันเริ่มคิดดอกงวดแรก — ปิดก่อนวันนี้ไม่ได้ สัญญายังไม่เริ่มด้วยซ้ำ */
  firstAccrualDate: ISODate
  today: ISODate
  payments: readonly { paidDate: ISODate }[]
}

/**
 * ข้อที่ยังไม่ผ่าน — อาร์เรย์ว่าง = ปิดได้
 *
 * ⛔ ห้ามปล่อยให้ปิดล่วงหน้า ทั้งแอพคิด "ยอดวันนี้" จากตารางที่ตัดด้วยวันปิด
 *    ปิดวันที่ยังไม่ถึง = ยอดคงเหลือวันนี้กลายเป็นยอดของอนาคตที่ยังไม่เกิด
 * ⛔ ห้ามปล่อยให้มีรายการจ่ายหลังวันปิด เป็นข้อขัดแย้งในตัวเอง
 *    และเงินก้อนนั้นจะถูกตัดหายไปจากตารางเงียบ ๆ ทั้งที่จ่ายไปจริง
 */
export function validateClose(x: CloseCheck): string[] {
  const errors: string[] = []

  if (x.closedDate < x.firstAccrualDate) {
    errors.push(
      `วันปิดต้องไม่ก่อนวันเบิกเงินกู้ (${formatThaiDate(x.firstAccrualDate, 'long')})`,
    )
  }
  if (x.closedDate > x.today) {
    errors.push('ปิดสัญญาล่วงหน้าไม่ได้ — รอให้ถึงวันปิดจริงก่อนแล้วค่อยกด')
  }

  const after = x.payments
    .filter((p) => p.paidDate > x.closedDate)
    .sort((a, b) => (a.paidDate < b.paidDate ? -1 : 1))
  if (after.length > 0) {
    const first = after[0]!.paidDate
    errors.push(
      after.length === 1
        ? `มีรายการจ่ายวันที่ ${formatThaiDate(first, 'long')} ซึ่งหลังวันปิด — แก้วันปิดหรือลบรายการนั้นก่อน`
        : `มีรายการจ่าย ${after.length} รายการหลังวันปิด รายการแรกวันที่ ${formatThaiDate(first, 'long')} — แก้วันปิดหรือลบรายการเหล่านั้นก่อน`,
    )
  }

  return errors
}
