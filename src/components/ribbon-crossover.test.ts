import { describe, it, expect } from 'vitest'
import { durableCrossover } from './SplitRibbon'
import type { ScheduleRow } from '@engine/types.js'

/** แถวปลอมที่สนใจแค่ 2 ฟิลด์ที่ durableCrossover ใช้ */
const rows = (pairs: readonly [number, number][]): ScheduleRow[] =>
  pairs.map(([interest, principal], i) =>
    ({
      index: i + 1,
      interestFixed: BigInt(interest),
      principalFixed: BigInt(principal),
    }) as unknown as ScheduleRow,
  )

describe('งวดที่เงินต้นแซงดอกเบี้ยแล้วไม่กลับ', () => {
  it('ไม่มีแถว -> null', () => {
    expect(durableCrossover([])).toBeNull()
  })

  it('งวดสุดท้ายดอกเบี้ยยังชนะ -> null ไม่ใช่เลขมั่ว', () => {
    expect(durableCrossover(rows([[10, 1], [10, 2], [10, 3]]))).toBeNull()
  })

  it('แซงครั้งเดียวแล้วอยู่ยาว -> งวดที่เริ่มแซง', () => {
    expect(durableCrossover(rows([[10, 1], [10, 5], [5, 10], [4, 11]]))).toBe(3)
  })

  it('⛔ แซงตอนโปรแล้วกลับ -> ต้องได้จุดที่แซงรอบหลัง ไม่ใช่รอบแรก', () => {
    // โปร 2 งวดแรกเงินต้นชนะ พ้นโปรดอกเบี้ยกลับมาชนะ 2 งวด แล้วเงินต้นชนะถาวร
    const r = rows([
      [8, 14], [8, 14],      // โปร เงินต้นชนะ
      [15, 7], [15, 7],      // พ้นโปร ดอกเบี้ยกลับมาชนะ
      [11, 11],              // เท่ากัน ยังไม่นับว่าแซง
      [10, 12], [9, 13],     // แซงถาวร
    ])
    expect(durableCrossover(r)).toBe(6)
  })

  it('เท่ากันพอดีไม่นับว่าแซง เพราะยังไม่ได้มากกว่า', () => {
    expect(durableCrossover(rows([[10, 10], [9, 11]]))).toBe(2)
  })

  it('แซงตั้งแต่งวดแรกและไม่เคยกลับ -> งวด 1', () => {
    expect(durableCrossover(rows([[1, 20], [1, 21]]))).toBe(1)
  })
})
