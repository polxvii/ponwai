/**
 * "ถึงวันนี้ผ่อนไปกี่งวดแล้ว" และ "เหลือหนี้เท่าไหร่"
 *
 * ⛔ ห้ามตัดสินจากวันครบกำหนดอย่างเดียว
 *    ถ้าผู้ใช้บันทึกยอดจ่ายจริงไว้ เงินออกจากบัญชีไปแล้วจริง ๆ
 *    การรอให้ถึงวันครบกำหนดก่อนค่อยนับ ทำให้การ์ด "ยอดคงเหลือวันนี้" ค้างที่ยอดเก่า
 *    ทั้งที่ตารางผ่อนข้างล่างในหน้าเดียวกันแสดงยอดใหม่ไปแล้ว
 *
 *    เคสจริงที่เจอ: โปะ 3,737,000 บันทึกวันที่ 5 ก.ย. ส่วนวันครบกำหนดคือ 5 ต.ค.
 *    วันที่ 23 ก.ย. การ์ดโชว์ 9,671,301 แต่ตารางโชว์ 5,950,199 — ขัดกันเองบนจอเดียว
 */

import { FIXED_SCALE, type Fixed, type Satang } from '@engine/money.js'
import type { ISODate } from '@engine/date.js'
import type { PaymentEvent, ScheduleRow } from '@engine/types.js'

/**
 * จำนวนงวดที่จบแล้ว ณ วันที่กำหนด
 *
 * งวดหนึ่งถือว่าจบเมื่อ "ถึงวันครบกำหนดแล้ว" หรือ "จ่ายจริงไปแล้ว" อย่างใดอย่างหนึ่ง
 * ⚠️ ช่วงของงวดเป็นแบบเปิดหัวปิดท้าย (accrualFrom, date] ต้องตรงกับที่ buildSchedule
 *    ใช้จับเหตุการณ์เข้างวด ไม่งั้นยอดจ่ายก้อนเดียวจะถูกนับคนละงวดกับที่ตารางแสดง
 */
export function settledPeriods(
  rows: readonly ScheduleRow[],
  events: readonly PaymentEvent[],
  today: ISODate,
): number {
  // เฉพาะที่จ่ายไปแล้วจริง — บันทึกล่วงหน้าไว้ยังไม่นับ เงินยังไม่ออกจากบัญชี
  const paid = events.filter((e) => e.date <= today).map((e) => e.date)

  let n = 0
  for (const r of rows) {
    const duePassed = r.date <= today
    const paidAlready = paid.some((d) => d > r.accrualFrom && d <= r.date)
    if (duePassed || paidAlready) n = r.index
    else break
  }
  return n
}

/** ยอดหนี้คงเหลือ ณ วันที่กำหนด — ยังไม่ได้จ่ายงวดไหนเลยก็คือวงเงินเต็ม */
export function balanceOn(
  rows: readonly ScheduleRow[],
  events: readonly PaymentEvent[],
  today: ISODate,
  disbursedSatang: Satang,
): Fixed {
  const n = settledPeriods(rows, events, today)
  if (n === 0) return (disbursedSatang * FIXED_SCALE) as Fixed

  // ⛔ ห้ามใช้ rows[n - 1] — ถูกเฉพาะตอนอาร์เรย์เริ่มที่งวด 1 พอดี
  //    ถ้ามีใครส่งตารางที่ถูกตัดช่วงมา ตำแหน่งกับเลขงวดจะเพี้ยนจากกันทันที
  const hit = rows.find((r) => r.index === n)
  return hit?.balanceAfterFixed ?? ((disbursedSatang * FIXED_SCALE) as Fixed)
}

/**
 * ดอกเบี้ยรวมของ n งวดแรก
 *
 * ⚠️ มีไว้เพื่อเทียบสองตารางที่ "ยาวไม่เท่ากัน" โดยตัดที่จุดเดียวกัน
 *    ถามว่า "ที่โปะมาประหยัดดอกไปแล้วเท่าไหร่" ต้องเทียบเฉพาะงวดที่ผ่านมาจริง
 *    ไม่ใช่เอายอดรวมทั้งสัญญามาลบกัน
 *
 * ⛔ ยอดรวมทั้งสัญญาใช้ไม่ได้เมื่อค่างวดตามสัญญาไม่พอจ่ายดอกเบี้ย
 *    ตารางฝั่งนั้นจะวิ่งไปชนเพดานจำนวนงวด ยอดรวมกลายเป็นค่าของเพดาน
 *    ผลต่างจะอ่านได้ว่า "ประหยัดไป 40 ล้าน" ซึ่งไม่ใช่ความจริง
 *    แต่ n งวดแรกมีอยู่จริงทั้งสองฝั่งเสมอ จึงเทียบได้ทุกสัญญา
 */
export function interestUpTo(rows: readonly ScheduleRow[], n: number): Fixed {
  return rows
    .slice(0, Math.max(0, Math.min(n, rows.length)))
    .reduce((a, r) => (a + r.interestFixed) as Fixed, 0n as Fixed)
}
