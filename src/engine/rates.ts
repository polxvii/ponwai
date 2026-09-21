/**
 * แก้อัตราดอกเบี้ยจาก 2 ชั้น (spec ข้อ 1.3)
 *
 * อัตราจริง ณ วันใด ๆ = RateStep ของ "งวดนั้น" + ReferenceRate ที่ effective "ณ วันนั้น"
 * สองมิตินี้แยกกัน: step เลือกด้วยเลขงวด ส่วน reference rate เลือกด้วยวันที่
 * จึงเป็นเหตุผลว่าทำไม MRR เปลี่ยนกลางงวดถึงทำให้ดอกเบี้ยงวดนั้นแบ่งเป็นสองท่อน (TV-7)
 */

import type { ISODate } from './date.js'
import { bps, type Bps } from './money.js'
import type { RateStep, ReferenceRate, IndexCode, LoanConvention } from './types.js'

export function findRateStep(steps: readonly RateStep[], period: number): RateStep {
  for (const s of steps) {
    if (period >= s.fromMonth && (s.toMonth === null || period <= s.toMonth)) return s
  }
  const last = steps[steps.length - 1]
  if (!last) throw new Error('ต้องมี RateStep อย่างน้อย 1 ตัว')
  return last
}

/**
 * อัตราอ้างอิงที่มีผล ณ วันนั้น = แถวล่าสุดที่ effectiveDate <= d
 * ถ้ายังไม่มีแถวไหนมีผล ถือว่าผิดพลาดของข้อมูล ไม่ใช่ 0 — เงียบไปจะได้ดอกเบี้ย 0 ทั้งงวด
 */
export function resolveReferenceRate(
  rates: readonly ReferenceRate[],
  indexCode: IndexCode,
  d: ISODate,
): Bps {
  let best: ReferenceRate | undefined
  for (const r of rates) {
    if (r.indexCode !== indexCode) continue
    if (r.effectiveDate > d) continue
    if (!best || r.effectiveDate > best.effectiveDate) best = r
  }
  if (!best) throw new Error(`ไม่มีอัตรา ${indexCode} ที่มีผล ณ ${d} — ต้องกรอกอัตราอ้างอิงก่อน`)
  return best.rateBps
}

/** อัตราที่ใช้จริงของงวด `period` ณ วันที่ `d` */
export function resolveRate(
  step: RateStep,
  refRates: readonly ReferenceRate[],
  d: ISODate,
): Bps {
  if (step.kind === 'fixed') return step.fixedRateBps
  const base = resolveReferenceRate(refRates, step.indexCode, d)
  const delta = step.kind === 'index_minus' ? -step.spreadBps : step.spreadBps
  const out = base + delta
  if (out < 0) return bps(0)
  return bps(out)
}

/** convention ที่มีผล ณ วันนั้น — แถวล่าสุดที่ effectiveFrom <= d */
export function resolveConvention(
  conventions: readonly LoanConvention[],
  d: ISODate,
): LoanConvention {
  let best: LoanConvention | undefined
  for (const c of conventions) {
    if (c.effectiveFrom > d) continue
    if (!best || c.effectiveFrom > best.effectiveFrom) best = c
  }
  if (!best) {
    throw new Error(`ไม่มี LoanConvention ที่มีผล ณ ${d} — แถวแรกต้องครอบ startDate`)
  }
  return best
}

/**
 * วันที่ที่อัตราหรือ convention เปลี่ยนภายในช่วง (d0, d1)
 * ใช้ตัดช่วง accrual ให้ถูกต้อง ไม่ต้องวนทีละวัน
 */
export function changePointsWithin(
  d0: ISODate,
  d1: ISODate,
  refRates: readonly ReferenceRate[],
  conventions: readonly LoanConvention[],
  step: RateStep,
): ISODate[] {
  const pts = new Set<ISODate>()
  if (step.kind !== 'fixed') {
    for (const r of refRates) {
      if (r.indexCode === step.indexCode && r.effectiveDate > d0 && r.effectiveDate < d1) {
        pts.add(r.effectiveDate)
      }
    }
  }
  for (const c of conventions) {
    if (c.effectiveFrom > d0 && c.effectiveFrom < d1) pts.add(c.effectiveFrom)
  }
  return [...pts].sort()
}
