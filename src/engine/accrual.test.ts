import { describe, it, expect } from 'vitest'
import { ymd, daysBetween, isLeapYear, dayOfWeek, isWeekend, addMonthsClamped, type ISODate } from './date.js'
import { accrueInterest, accrualDays, accrueInterestVariableRate } from './accrual.js'
import { baht, bps, toFixed, formatFixedBaht, roundFixed, type Fixed } from './money.js'

/**
 * สมมติฐานร่วมของทุก TV (spec ข้อ 9.1)
 *   rounding      = 'none'  ค่าทุกตัวด้านล่างเป็น exact ไม่ปัด
 *   accrual window = [d0, d1) ปลายเปิด
 *   date_roll     = 'none'
 */

const P3M = toFixed(baht(3_000_000))

describe('date: civil date ล้วน ไม่มี timezone', () => {
  it('daysBetween ปลายเปิด', () => {
    expect(daysBetween(ymd(2026, 10, 1), ymd(2026, 11, 1))).toBe(31)
    expect(daysBetween(ymd(2027, 2, 1), ymd(2027, 3, 1))).toBe(28)
    expect(daysBetween(ymd(2028, 2, 1), ymd(2028, 3, 1))).toBe(29)
  })

  it('ปีอธิกสุรทิน', () => {
    expect(isLeapYear(2028)).toBe(true)
    expect(isLeapYear(2027)).toBe(false)
    expect(isLeapYear(2100)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
  })

  it('addMonthsClamped ต้อง clamp แล้วเด้งกลับ ไม่ drift (spec 1.4.1)', () => {
    const start = ymd(2027, 1, 31)
    expect(addMonthsClamped(start, 1, 31)).toBe(ymd(2027, 2, 28))
    expect(addMonthsClamped(start, 2, 31)).toBe(ymd(2027, 3, 31))
    expect(addMonthsClamped(start, 3, 31)).toBe(ymd(2027, 4, 30))
    expect(addMonthsClamped(start, 4, 31)).toBe(ymd(2027, 5, 31))
  })

  it('dayOfWeek ตรงกับปฏิทินจริง', () => {
    expect(dayOfWeek(ymd(2026, 10, 1))).toBe(4) // พฤหัสบดี
    expect(isWeekend(ymd(2026, 10, 3))).toBe(true) // เสาร์
    expect(isWeekend(ymd(2026, 10, 4))).toBe(true) // อาทิตย์
    expect(isWeekend(ymd(2026, 10, 5))).toBe(false) // จันทร์
  })
})

describe('TV-1 ดอกเบี้ยรายวัน', () => {
  it('P=3,000,000 rate=3.00% days=31 -> 7,643.8356', () => {
    const i = accrueInterest(P3M, bps(300), ymd(2026, 10, 1), ymd(2026, 11, 1), 'ACT/365F')
    expect(formatFixedBaht(i, 4)).toBe('7,643.8356')
    expect(formatFixedBaht(i)).toBe('7,643.84')
  })

  it('ห้ามใช้ balance x rate / 12 — ต่างกัน 143.84 บาทในเดือนเดียว', () => {
    const daily = accrueInterest(P3M, bps(300), ymd(2026, 10, 1), ymd(2026, 11, 1), 'ACT/365F')
    const monthlyWrong = (P3M * 300n) / (10_000n * 12n)
    const diff = (daily - monthlyWrong) as Fixed
    expect(formatFixedBaht(monthlyWrong as Fixed)).toBe('7,500.00')
    expect(formatFixedBaht(diff)).toBe('143.84')
  })
})

describe('TV-3 negative amortization — ดอกเบี้ยตั้งต้น', () => {
  it('P=3,000,000 rate=7.00% days=31 -> 17,835.6164 มากกว่าค่างวด 17,000', () => {
    const i = accrueInterest(P3M, bps(700), ymd(2027, 1, 1), ymd(2027, 2, 1), 'ACT/365F')
    expect(formatFixedBaht(i, 4)).toBe('17,835.6164')
    expect(i > toFixed(baht(17_000))).toBe(true)
  })
})

describe('TV-5 เดือนสั้น/เดือนยาว', () => {
  it('ก.พ. 28 วัน ต้องน้อยกว่า ม.ค. 31 วัน พอดี 3 วันของดอกเบี้ย', () => {
    const jan = accrueInterest(P3M, bps(500), ymd(2027, 1, 1), ymd(2027, 2, 1), 'ACT/365F')
    const feb = accrueInterest(P3M, bps(500), ymd(2027, 2, 1), ymd(2027, 3, 1), 'ACT/365F')
    const oneDay = (P3M * 500n) / (10_000n * 365n)
    expect(jan - feb).toBe(oneDay * 3n)
  })
})

describe('TV-13 ปีปกติ ACT/365F กับ ACT/ACT ต้องแยกไม่ออก', () => {
  it('1 ม.ค. 2027 -> 1 ม.ค. 2028 เท่ากันทุกสตางค์', () => {
    const a = accrueInterest(P3M, bps(500), ymd(2027, 1, 1), ymd(2028, 1, 1), 'ACT/365F')
    const b = accrueInterest(P3M, bps(500), ymd(2027, 1, 1), ymd(2028, 1, 1), 'ACT/ACT')
    expect(a).toBe(b)
  })

  it('ทุกงวดของปีปกติก็ต้องเท่ากัน', () => {
    for (let m = 1; m <= 12; m++) {
      const d0 = ymd(2027, m, 1)
      const d1 = m === 12 ? ymd(2028, 1, 1) : ymd(2027, m + 1, 1)
      expect(accrueInterest(P3M, bps(500), d0, d1, 'ACT/365F'))
        .toBe(accrueInterest(P3M, bps(500), d0, d1, 'ACT/ACT'))
    }
  })
})

describe('TV-14 ก.พ. ปีอธิกสุรทิน', () => {
  const P = toFixed(baht(2_900_000))
  const d0 = ymd(2028, 2, 1)
  const d1 = ymd(2028, 3, 1)

  it('ACT/365F = 11,520.55', () => {
    expect(formatFixedBaht(accrueInterest(P, bps(500), d0, d1, 'ACT/365F'))).toBe('11,520.55')
  })
  it('ACT/ACT = 11,489.07', () => {
    expect(formatFixedBaht(accrueInterest(P, bps(500), d0, d1, 'ACT/ACT'))).toBe('11,489.07')
  })
  it('ACT/365_SKIP = 11,123.29', () => {
    expect(formatFixedBaht(accrueInterest(P, bps(500), d0, d1, 'ACT/365_SKIP'))).toBe('11,123.29')
  })

  it('SKIP ต้องนับ 28 วัน ส่วนอีกสองโหมดนับ 29 วัน', () => {
    expect(accrualDays(d0, d1, 'ACT/365F')).toBe(29)
    expect(accrualDays(d0, d1, 'ACT/ACT')).toBe(29)
    expect(accrualDays(d0, d1, 'ACT/365_SKIP')).toBe(28)
  })
})

describe('TV-15 ACT/ACT ต้องตัดช่วงที่ขอบปี', () => {
  const d0 = ymd(2027, 12, 15)
  const d1 = ymd(2028, 1, 15)

  it('ช่วงนี้มี 31 วัน แบ่งเป็น 17 วันในปี 2027 และ 14 วันในปี 2028', () => {
    expect(daysBetween(d0, d1)).toBe(31)
    expect(daysBetween(d0, ymd(2028, 1, 1))).toBe(17)
    expect(daysBetween(ymd(2028, 1, 1), d1)).toBe(14)
  })

  it('ต้องเป็น 17/365 + 14/366 ไม่ใช่ 31/366 หรือ 31/365', () => {
    const got = accrueInterest(P3M, bps(500), d0, d1, 'ACT/ACT')

    const num = P3M * 500n
    const expected = num * 17n / (10_000n * 365n) + num * 14n / (10_000n * 366n)
    expect(got).toBe(expected)

    const wrong366 = num * 31n / (10_000n * 366n)
    const wrong365 = num * 31n / (10_000n * 365n)
    expect(got).not.toBe(wrong366)
    expect(got).not.toBe(wrong365)
  })
})

describe('TV-7 อัตราเปลี่ยนกลางงวด', () => {
  it('เปลี่ยนวันที่ 15 -> (14 วันอัตราเก่า) + (16 วันอัตราใหม่) ห้ามใช้อัตราเดียวทั้งงวด', () => {
    const d0 = ymd(2027, 1, 1)
    const d1 = ymd(2027, 1, 31)
    const changeOn = ymd(2027, 1, 15)
    const rateAt = (x: ISODate) => (x < changeOn ? bps(250) : bps(525))

    const { interest, segments } = accrueInterestVariableRate(P3M, d0, d1, 'ACT/365F', rateAt)

    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ from: d0, to: changeOn, rateBps: 250 })
    expect(segments[1]).toMatchObject({ from: changeOn, to: d1, rateBps: 525 })
    expect(daysBetween(segments[0]!.from, segments[0]!.to)).toBe(14)
    expect(daysBetween(segments[1]!.from, segments[1]!.to)).toBe(16)

    const expected =
      accrueInterest(P3M, bps(250), d0, changeOn, 'ACT/365F') +
      accrueInterest(P3M, bps(525), changeOn, d1, 'ACT/365F')
    expect(interest).toBe(expected)

    const singleRateWrong = accrueInterest(P3M, bps(525), d0, d1, 'ACT/365F')
    expect(interest).not.toBe(singleRateWrong)
  })

  it('อัตราไม่เปลี่ยน ต้องได้ segment เดียวและตรงกับ accrueInterest', () => {
    const d0 = ymd(2027, 3, 1)
    const d1 = ymd(2027, 4, 1)
    const { interest, segments } = accrueInterestVariableRate(P3M, d0, d1, 'ACT/365F', () => bps(500))
    expect(segments).toHaveLength(1)
    expect(interest).toBe(accrueInterest(P3M, bps(500), d0, d1, 'ACT/365F'))
  })
})

describe('money: จุดที่ปัดเศษ (spec ข้อ 3.3)', () => {
  const i = accrueInterest(P3M, bps(300), ymd(2026, 10, 1), ymd(2026, 11, 1), 'ACT/365F')

  it('none ไม่แตะค่าเดิม', () => {
    expect(formatFixedBaht(roundFixed(i, 'none'), 4)).toBe('7,643.8356')
  })
  it('round_satang ปัดครึ่งขึ้น', () => {
    expect(formatFixedBaht(roundFixed(i, 'round_satang'), 4)).toBe('7,643.8400')
  })
  it('floor_satang ปัดลง', () => {
    expect(formatFixedBaht(roundFixed(i, 'floor_satang'), 4)).toBe('7,643.8300')
  })
  it('floor_baht ปัดลงเป็นจำนวนเต็มบาท', () => {
    expect(formatFixedBaht(roundFixed(i, 'floor_baht'), 4)).toBe('7,643.0000')
  })
})
