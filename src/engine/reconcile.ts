/**
 * กระทบยอดกับใบแจ้งยอดธนาคาร (spec ข้อ 3.3)
 *
 * ฟีเจอร์ที่แอพอื่นไม่มี และเป็นเหตุผลทั้งหมดที่ engine ต้องแม่นระดับสตางค์
 * ถ้าไม่ตรง ต้องบอกว่าต่างเท่าไหร่และสงสัยว่าเพราะอะไร — ไม่ปัดตกเงียบ ๆ (ข้อ 0)
 *
 * Inference ทำ 2 ขั้น ห้ามยำรวมเป็น brute force ก้อนเดียว:
 *   ขั้น 1  วันตัด   จับคู่จาก "คอลัมน์วันที่" ในใบแจ้งยอด — เทียบตรงตัว ไม่ใช่ fit
 *   ขั้น 2  จำนวนเงิน ตรึงวันตัดจากขั้น 1 แล้วค่อย brute force 24 แบบ
 *
 * ถ้าโยนทุกมิติเข้าไปพร้อมกัน (120 แบบ) กับ statement 12 แถว จะเป็นการ fit noise
 */

import type { ISODate } from './date.js'
import { type Satang, type Fixed, type RoundingMode, toFixed } from './money.js'
import { ALL_DAY_COUNT_BASES, type DayCountBasis } from './accrual.js'
import { buildSchedule } from './schedule.js'
import { buildDueDates, type DateRuleConfig } from './schedule-dates.js'
import type {
  LoanTerms, PaymentEvent, ScheduleRow, DateRoll, RollCalendar, LoanConvention,
} from './types.js'

// ---------- เทียบรายงวด ----------

export type StatementEntry = {
  stmtDate: ISODate
  interestSatang?: Satang
  principalSatang?: Satang
  balanceSatang?: Satang
}

/** เขียว = ปัดเศษ | เหลือง = น่าจะเป็นนโยบายปัดเศษหรือ day-count ต่างกัน | แดง = ผิดจริง */
export type ReconZone = 'green' | 'yellow' | 'red'

export const ZONE_GREEN_MAX_SATANG = 100n      // 1 บาท
export const ZONE_YELLOW_MAX_SATANG = 5_000n   // 50 บาท

export function zoneOf(deltaSatang: bigint): ReconZone {
  const abs = deltaSatang < 0n ? -deltaSatang : deltaSatang
  if (abs <= ZONE_GREEN_MAX_SATANG) return 'green'
  if (abs <= ZONE_YELLOW_MAX_SATANG) return 'yellow'
  return 'red'
}

export type ReconResult = {
  stmtDate: ISODate
  periodIndex: number | null
  /** เราคำนวณได้ − ธนาคารแจ้ง (บวก = เราคิดมากกว่าธนาคาร) */
  interestDeltaSatang: bigint | null
  balanceDeltaSatang: bigint | null
  zone: ReconZone
  matched: boolean
}

function fixedToSatangTrunc(v: Fixed): bigint {
  return v / 1_000_000_000_000n
}

export function reconcile(
  computed: readonly ScheduleRow[],
  stmt: readonly StatementEntry[],
): ReconResult[] {
  const byDate = new Map(computed.map((r) => [r.date, r]))

  return stmt.map((entry) => {
    const row = byDate.get(entry.stmtDate)
    if (!row) {
      return {
        stmtDate: entry.stmtDate,
        periodIndex: null,
        interestDeltaSatang: null,
        balanceDeltaSatang: null,
        zone: 'red' as const,
        matched: false,
      }
    }

    const iDelta = entry.interestSatang !== undefined
      ? fixedToSatangTrunc(row.interestFixed) - entry.interestSatang
      : null
    const bDelta = entry.balanceSatang !== undefined
      ? fixedToSatangTrunc(row.balanceAfterFixed) - entry.balanceSatang
      : null

    const worst = [iDelta, bDelta].filter((x): x is bigint => x !== null)
    const zone = worst.length === 0
      ? ('green' as const)
      : worst.map(zoneOf).reduce((a, b) => (rank(b) > rank(a) ? b : a))

    return {
      stmtDate: entry.stmtDate,
      periodIndex: row.index,
      interestDeltaSatang: iDelta,
      balanceDeltaSatang: bDelta,
      zone,
      matched: true,
    }
  })
}

function rank(z: ReconZone): number {
  return z === 'green' ? 0 : z === 'yellow' ? 1 : 2
}

/** ค่าเฉลี่ยความคลาดเคลื่อนสัมบูรณ์ หน่วยสตางค์ */
export function meanAbsErrorSatang(results: readonly ReconResult[]): number {
  const vals = results
    .map((r) => r.interestDeltaSatang)
    .filter((x): x is bigint => x !== null)
  if (vals.length === 0) return Number.POSITIVE_INFINITY
  const sum = vals.reduce((a, b) => a + (b < 0n ? -b : b), 0n)
  return Number(sum) / vals.length
}

/**
 * ตรวจ pattern ที่บ่งชี้ว่า day-count basis ตั้งผิด (ข้อ 1.1.2 ข้อสังเกตที่ 3)
 *
 * ผลต่างของ ACT/365F กับ ACT/ACT คือ "1 วันของดอกเบี้ยกระจายทั้งปีอธิกสุรทิน"
 * ไม่ใช่กระจุกที่เดือน ก.พ. → เดือนละ ~31 บาทต่อเนื่อง 12 เดือน
 * ซึ่งตกในโซนเหลืองพอดี ต้องตรวจจาก drift สะสม ไม่ใช่ดูทีละงวด
 */
export function detectPersistentDrift(results: readonly ReconResult[]): {
  detected: boolean
  runLength: number
  direction: 'we_higher' | 'we_lower' | null
  hint: string | null
} {
  let best = 0
  let bestDir: 'we_higher' | 'we_lower' | null = null
  let run = 0
  let dir: 'we_higher' | 'we_lower' | null = null

  for (const r of results) {
    const d = r.interestDeltaSatang
    if (d === null || r.zone === 'green') { run = 0; dir = null; continue }
    const cur = d > 0n ? 'we_higher' as const : 'we_lower' as const
    if (cur === dir) run++
    else { dir = cur; run = 1 }
    if (run > best) { best = run; bestDir = dir }
  }

  const detected = best >= 6
  return {
    detected,
    runLength: best,
    direction: bestDir,
    hint: detected
      ? bestDir === 'we_higher'
        ? 'เราคิดดอกเบี้ยสูงกว่าธนาคารต่อเนื่องหลายงวด — ธนาคารน่าจะใช้ฐาน 366 วันในปีอธิกสุรทิน ลองเปลี่ยนเป็น ACT/ACT'
        : 'เราคิดดอกเบี้ยต่ำกว่าธนาคารต่อเนื่องหลายงวด — ลองตรวจวิธีนับวันและจุดที่ปัดเศษ'
      : null,
  }
}

// ---------- ขั้น 1: หาวันตัด ----------

export type DateRuleCandidate = { dateRoll: DateRoll; rollCalendar: RollCalendar }

export const DATE_RULE_CANDIDATES: readonly DateRuleCandidate[] = [
  { dateRoll: 'none', rollCalendar: 'weekend_only' },
  { dateRoll: 'preceding', rollCalendar: 'weekend_only' },
  { dateRoll: 'preceding', rollCalendar: 'weekend_and_bank_holidays' },
  { dateRoll: 'following', rollCalendar: 'weekend_only' },
  { dateRoll: 'following', rollCalendar: 'weekend_and_bank_holidays' },
] as const

export type DateRuleInference = {
  best: DateRuleCandidate
  /** จำนวนวันที่ตรงกับใบแจ้งยอด */
  matched: number
  total: number
  /** งวดที่ไม่มีกฎไหนอธิบายได้ — ควรเสนอเป็น override รายงวด (ข้อ 1.4.3) */
  unmatchedDates: ISODate[]
  allCandidates: { candidate: DateRuleCandidate; matched: number }[]
}

/**
 * จับคู่วันที่ในใบแจ้งยอดกับกฎทั้ง 5 แบบ — เทียบตรงตัว ไม่ใช่ fit ตัวเลข
 * วันที่ที่ธนาคารแจ้งมาคือความจริงอยู่แล้ว จึงแทบไม่มีโอกาสผิด
 */
export function inferDateRule(
  terms: LoanTerms,
  stmt: readonly StatementEntry[],
): DateRuleInference {
  const stmtDates = new Set(stmt.map((s) => s.stmtDate))
  const horizon = stmt.length + 12

  const scored = DATE_RULE_CANDIDATES.map((candidate) => {
    const cfg: DateRuleConfig = {
      startDate: terms.startDate,
      dueDayOfMonth: terms.dueDayOfMonth,
      dateRoll: candidate.dateRoll,
      rollCalendar: candidate.rollCalendar,
      bankHolidays: new Set(terms.bankHolidays),
      overrides: terms.scheduleOverrides,
    }
    const generated = new Set(buildDueDates(cfg, horizon).map((x) => x.actual))
    let matched = 0
    for (const d of stmtDates) if (generated.has(d)) matched++
    return { candidate, matched, generated }
  })

  const best = scored.reduce((a, b) => (b.matched > a.matched ? b : a))
  return {
    best: best.candidate,
    matched: best.matched,
    total: stmtDates.size,
    unmatchedDates: [...stmtDates].filter((d) => !best.generated.has(d)).sort(),
    allCandidates: scored.map(({ candidate, matched }) => ({ candidate, matched })),
  }
}

// ---------- ขั้น 2: หาวิธีคิดจำนวนเงิน ----------

export const ALL_ROUNDING_MODES: readonly RoundingMode[] = [
  'none', 'round_satang', 'floor_satang', 'floor_baht',
] as const

export type AmountConventionCandidate = {
  dayCountBasis: DayCountBasis
  rounding: RoundingMode
  capitaliseUnpaidInterest: boolean
}

export type InferResult = {
  candidate: AmountConventionCandidate
  maeSatang: number
  worstZone: ReconZone
  results: ReconResult[]
}

/**
 * brute force 24 แบบ (4 ปัดเศษ × 3 basis × 2 capitalise) โดยตรึงวันตัดไว้แล้ว
 *
 * คืน "ทุกตัวที่ MAE ต่างกันไม่ถึง 1 บาท" ไม่ใช่ตัวเดียว เพื่อกัน overfit
 * เช่นปีปกติ ACT/365F กับ ACT/ACT แยกไม่ออกโดยหลักการ (ข้อ 1.1.1)
 */
export function inferAmountConventions(
  terms: LoanTerms,
  events: readonly PaymentEvent[],
  stmt: readonly StatementEntry[],
  dateRule?: DateRuleCandidate,
): InferResult[] {
  const out: InferResult[] = []

  for (const dayCountBasis of ALL_DAY_COUNT_BASES) {
    for (const rounding of ALL_ROUNDING_MODES) {
      for (const capitaliseUnpaidInterest of [false, true]) {
        const conventions: LoanConvention[] = [{
          effectiveFrom: terms.conventions[0]?.effectiveFrom ?? terms.startDate,
          dayCountBasis,
          rounding,
          capitaliseUnpaidInterest,
        }]
        const trial: LoanTerms = {
          ...terms,
          conventions,
          ...(dateRule ? { dateRoll: dateRule.dateRoll, rollCalendar: dateRule.rollCalendar } : {}),
        }
        const { rows } = buildSchedule(trial, events)
        const results = reconcile(rows, stmt)
        out.push({
          candidate: { dayCountBasis, rounding, capitaliseUnpaidInterest },
          maeSatang: meanAbsErrorSatang(results),
          worstZone: results.map((r) => r.zone).reduce<ReconZone>(
            (a, b) => (rank(b) > rank(a) ? b : a), 'green',
          ),
          results,
        })
      }
    }
  }

  return out.sort((a, b) => a.maeSatang - b.maeSatang)
}

/** ตัวที่เข้าข่ายทั้งหมด — ถ้ามีมากกว่า 1 ต้องแสดงทุกตัวพร้อมบอกว่าแยกไม่ออก */
export function indistinguishableTop(
  results: readonly InferResult[],
  toleranceSatang = 100,
): InferResult[] {
  const best = results[0]
  if (!best) return []
  return results.filter((r) => r.maeSatang - best.maeSatang <= toleranceSatang)
}

/** สร้างใบแจ้งยอดจำลองจาก convention ที่กำหนด — ใช้ใน test และโหมดสาธิต */
export function synthesiseStatement(
  terms: LoanTerms,
  events: readonly PaymentEvent[],
  count: number,
): StatementEntry[] {
  const { rows } = buildSchedule(terms, events)
  return rows.slice(0, count).map((r) => ({
    stmtDate: r.date,
    interestSatang: fixedToSatangTrunc(r.interestFixed) as Satang,
    principalSatang: fixedToSatangTrunc(r.principalFixed) as Satang,
    balanceSatang: fixedToSatangTrunc(r.balanceAfterFixed) as Satang,
  }))
}

export { toFixed }
