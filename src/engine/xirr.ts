/**
 * XIRR — อัตราผลตอบแทนภายในของกระแสเงินสดที่ไม่ได้ห่างเท่ากัน (spec ข้อ 2.3)
 *
 * ใช้คำนวณ EIR ของข้อเสนอสินเชื่อจากกระแสเงินสดจริง:
 *   t0      = +เงินกู้ − ค่าธรรมเนียมที่จ่ายสด
 *   t1..tn  = −ค่างวด
 *   tn      = −เงินต้นคงเหลือ
 *
 * ค่าธรรมเนียมและเบี้ยประกันต้องเข้าที่ "เวลาของมันเอง" ไม่ใช่ยุบมากองที่ t0 (TV-20)
 *
 * ใช้ float ได้เพราะเป็นอัตราผลตอบแทน ไม่ใช่จำนวนเงินที่ต้องตรงระดับสตางค์
 * แต่ input ต้องมาจาก Satang ที่ exact แล้ว
 */

import { type ISODate, daysBetween } from './date.js'

export type DatedFlow = {
  date: ISODate
  /** บวก = เงินเข้า  ลบ = เงินออก */
  amount: number
}

export type XirrResult =
  | { ok: true; rate: number; iterations: number }
  | { ok: false; reason: 'no_sign_change' | 'not_converged' | 'empty' }

const DAY_BASIS = 365

function npv(flows: readonly DatedFlow[], rate: number, t0: ISODate): number {
  let sum = 0
  for (const f of flows) {
    const years = daysBetween(t0, f.date) / DAY_BASIS
    sum += f.amount / Math.pow(1 + rate, years)
  }
  return sum
}

/**
 * หาอัตราที่ทำให้ NPV = 0
 * ใช้ bisection ล้วน ไม่ใช่ Newton-Raphson เพราะ
 *   - กระแสเงินสดของสินเชื่อมี sign change ครั้งเดียว รากจึงมีตัวเดียวและ bisection ลู่เข้าแน่นอน
 *   - Newton พังง่ายเมื่ออนุพันธ์ใกล้ศูนย์ ซึ่งเกิดได้กับสัญญา 30 ปี
 * 200 รอบบน bracket [-0.9999, 10] ให้ความละเอียดดีกว่า 1e-9 ซึ่งเกินพอสำหรับแสดงเป็น %
 */
export function xirr(flows: readonly DatedFlow[]): XirrResult {
  if (flows.length === 0) return { ok: false, reason: 'empty' }

  const sorted = [...flows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const t0 = sorted[0]!.date

  const hasPositive = sorted.some((f) => f.amount > 0)
  const hasNegative = sorted.some((f) => f.amount < 0)
  if (!hasPositive || !hasNegative) return { ok: false, reason: 'no_sign_change' }

  let lo = -0.9999
  let hi = 10
  let fLo = npv(sorted, lo, t0)
  let fHi = npv(sorted, hi, t0)
  if (fLo * fHi > 0) return { ok: false, reason: 'no_sign_change' }

  let mid = 0
  for (let i = 0; i < 200; i++) {
    mid = (lo + hi) / 2
    const fMid = npv(sorted, mid, t0)
    if (Math.abs(fMid) < 1e-7 || (hi - lo) / 2 < 1e-10) {
      return { ok: true, rate: mid, iterations: i + 1 }
    }
    if (fLo * fMid < 0) { hi = mid; fHi = fMid } else { lo = mid; fLo = fMid }
  }
  return { ok: true, rate: mid, iterations: 200 }
}

/** แปลงผลเป็น bps เพื่อให้เข้ากับหน่วยที่ใช้ทั้งระบบ */
export function xirrBps(flows: readonly DatedFlow[]): number | null {
  const r = xirr(flows)
  return r.ok ? r.rate * 10_000 : null
}
