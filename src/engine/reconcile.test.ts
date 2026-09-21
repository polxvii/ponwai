import { describe, it, expect } from 'vitest'
import { baht, type Satang } from './money.js'
import { isoDate } from './date.js'
import { buildSchedule } from './schedule.js'
import { makeTerms, fixedStep, defaultConventions } from './test-helpers.js'
import {
  reconcile, zoneOf, meanAbsErrorSatang, detectPersistentDrift,
  inferDateRule, inferAmountConventions, indistinguishableTop,
  synthesiseStatement, DATE_RULE_CANDIDATES,
} from './reconcile.js'

const s = (n: number): Satang => baht(n)

describe('โซนกระทบยอด (spec ข้อ 3.3)', () => {
  it('|Δ| <= 1 บาท เขียว, 1-50 เหลือง, > 50 แดง', () => {
    expect(zoneOf(0n)).toBe('green')
    expect(zoneOf(100n)).toBe('green')       // 1.00 บาท
    expect(zoneOf(101n)).toBe('yellow')
    expect(zoneOf(5_000n)).toBe('yellow')    // 50.00 บาท
    expect(zoneOf(5_001n)).toBe('red')
    expect(zoneOf(-5_001n)).toBe('red')      // ติดลบก็ต้องดูค่าสัมบูรณ์
  })
})

describe('TV-12 Reconciliation inference', () => {
  const terms = makeTerms({
    startDate: isoDate('2026-10-01'),
    rateSteps: [fixedStep(5.0)],
    installmentBaht: 20_000,
    conventions: [{
      ...defaultConventions('2026-10-01')[0]!,
      dayCountBasis: 'ACT/365F',
      rounding: 'floor_baht',
    }],
  })

  // ใบแจ้งยอด 12 งวดที่สร้างจาก ACT/365F + floor_baht
  const stmt = synthesiseStatement(terms, [], 12)

  it('ใบแจ้งยอดจำลองต้องมี 12 งวดพร้อมตัวเลขครบ', () => {
    expect(stmt).toHaveLength(12)
    expect(stmt[0]!.interestSatang).toBeDefined()
    expect(stmt[0]!.balanceSatang).toBeDefined()
  })

  it('เดาถูก: ACT/365F + floor_baht ต้องอยู่ในกลุ่มที่ MAE ต่ำสุด และ MAE < 1 บาท', () => {
    // จงใจตั้ง convention ผิดเป็น ACT/ACT + none แล้วให้ engine หาเอง
    const wrong = { ...terms, conventions: defaultConventions('2026-10-01') }
    const ranked = inferAmountConventions(wrong, [], stmt)

    expect(ranked[0]!.maeSatang).toBeLessThan(100)   // < 1 บาท

    const top = indistinguishableTop(ranked)
    expect(top.some((r) =>
      r.candidate.dayCountBasis === 'ACT/365F' && r.candidate.rounding === 'floor_baht',
    )).toBe(true)
  })

  it('ลองครบ 24 แบบ (4 ปัดเศษ x 3 basis x 2 capitalise)', () => {
    const ranked = inferAmountConventions(terms, [], stmt)
    expect(ranked).toHaveLength(24)
  })

  it('convention ที่ผิดจริงต้องมี MAE สูงกว่ามาก', () => {
    const ranked = inferAmountConventions(terms, [], stmt)
    const skip = ranked.find((r) => r.candidate.dayCountBasis === 'ACT/365_SKIP'
      && r.candidate.rounding === 'none')!
    expect(skip.maeSatang).toBeGreaterThan(ranked[0]!.maeSatang)
  })

  it('ปีปกติ ACT/365F กับ ACT/ACT แยกไม่ออก — ต้องคืนทั้งคู่ ไม่ใช่เลือกให้เงียบ ๆ', () => {
    const ranked = inferAmountConventions(terms, [], stmt)
    const top = indistinguishableTop(ranked)
    const bases = new Set(top.map((r) => r.candidate.dayCountBasis))
    expect(bases.has('ACT/365F')).toBe(true)
    expect(bases.has('ACT/ACT')).toBe(true)
    expect(top.length).toBeGreaterThan(1)
  })
})

describe('inference ขั้น 1: หาวันตัดจากคอลัมน์วันที่', () => {
  const base = {
    startDate: isoDate('2026-10-05'),
    dueDayOfMonth: 5,
    rateSteps: [fixedStep(5.0)],
    installmentBaht: 20_000,
  }

  it('ลอง 5 แบบ ไม่ใช่ยำรวมกับจำนวนเงิน', () => {
    expect(DATE_RULE_CANDIDATES).toHaveLength(5)
  })

  it('statement ที่สร้างจาก preceding + weekend -> ต้องเดาถูก', () => {
    const real = makeTerms({ ...base, dateRoll: 'preceding', rollCalendar: 'weekend_only' })
    const stmt = synthesiseStatement(real, [], 24)

    // ให้ engine เริ่มจากสมมติฐาน none แล้วหาเอง
    const guessFrom = makeTerms({ ...base, dateRoll: 'none' })
    const inferred = inferDateRule(guessFrom, stmt)

    expect(inferred.best.dateRoll).toBe('preceding')
    expect(inferred.matched).toBe(inferred.total)
    expect(inferred.unmatchedDates).toHaveLength(0)
  })

  it('statement ที่สร้างจาก none -> ต้องเดาเป็น none', () => {
    const real = makeTerms({ ...base, dateRoll: 'none' })
    const stmt = synthesiseStatement(real, [], 24)
    expect(inferDateRule(real, stmt).best.dateRoll).toBe('none')
  })

  it('วันที่ที่ไม่มีกฎไหนอธิบายได้ ต้องรายงานออกมาเพื่อเสนอเป็น override รายงวด', () => {
    const real = makeTerms({ ...base, dateRoll: 'none' })
    const stmt = synthesiseStatement(real, [], 12)
    stmt[5]!.stmtDate = isoDate('2027-04-17')   // วันประหลาดที่ไม่ตรงกฎไหน

    const inferred = inferDateRule(real, stmt)
    expect(inferred.unmatchedDates).toContain(isoDate('2027-04-17'))
    expect(inferred.matched).toBeLessThan(inferred.total)
  })
})

describe('reconcile รายงวด', () => {
  const terms = makeTerms({ startDate: isoDate('2026-10-01'), installmentBaht: 20_000 })
  const { rows } = buildSchedule(terms)

  it('ตรงเป๊ะ -> เขียวทุกงวด', () => {
    const stmt = synthesiseStatement(terms, [], 12)
    const results = reconcile(rows, stmt)
    expect(results.every((r) => r.zone === 'green')).toBe(true)
    expect(meanAbsErrorSatang(results)).toBeLessThan(1)
  })

  it('ธนาคารแจ้งต่างไป 200 บาท -> แดง', () => {
    const stmt = synthesiseStatement(terms, [], 3)
    stmt[1]!.interestSatang = (stmt[1]!.interestSatang! - 20_000n) as Satang
    const results = reconcile(rows, stmt)
    expect(results[1]!.zone).toBe('red')
    expect(results[1]!.interestDeltaSatang).toBe(20_000n)
  })

  it('วันที่ในใบแจ้งยอดไม่ตรงกับตารางเลย -> matched = false ไม่ใช่เงียบ', () => {
    const results = reconcile(rows, [{ stmtDate: isoDate('2030-07-17'), interestSatang: s(1_000) }])
    expect(results[0]!.matched).toBe(false)
    expect(results[0]!.zone).toBe('red')
  })
})

describe('ตรวจ drift ต่อเนื่องในปีอธิกสุรทิน (ข้อ 1.1.2)', () => {
  it('ACT/365F vs ACT/ACT ในปีอธิกฯ = เหลืองต่อเนื่อง ต้องจับ pattern ได้', () => {
    // ธนาคารใช้ ACT/ACT แต่เราตั้ง ACT/365F -> เราจะคิดสูงกว่าเล็กน้อยตลอดปี 2028
    const bankTerms = makeTerms({
      startDate: isoDate('2027-12-01'),
      rateSteps: [fixedStep(5.0)],
      installmentBaht: 20_000,
      conventions: [{ ...defaultConventions('2027-12-01')[0]!, dayCountBasis: 'ACT/ACT' }],
    })
    const stmt = synthesiseStatement(bankTerms, [], 14)

    const ourTerms = makeTerms({
      startDate: isoDate('2027-12-01'),
      rateSteps: [fixedStep(5.0)],
      installmentBaht: 20_000,
    })
    const { rows } = buildSchedule(ourTerms)
    const results = reconcile(rows, stmt)

    const drift = detectPersistentDrift(results)
    expect(drift.detected).toBe(true)
    expect(drift.direction).toBe('we_higher')
    expect(drift.hint).toMatch(/ACT\/ACT/)
  })

  it('ตรงกันหมด -> ไม่ต้องเตือน', () => {
    const terms = makeTerms({ startDate: isoDate('2026-10-01'), installmentBaht: 20_000 })
    const { rows } = buildSchedule(terms)
    const drift = detectPersistentDrift(reconcile(rows, synthesiseStatement(terms, [], 12)))
    expect(drift.detected).toBe(false)
    expect(drift.hint).toBeNull()
  })
})
