/**
 * TV-40 — ป้ายแกน x ของกราฟยอดหนี้ต้องไม่ทับกัน
 *
 * ค่างวดที่ไม่พอดอกทำให้แผน "ถ้าไม่โปะ" วิ่งถึงเพดาน 1,200 งวดของ engine
 * ถ้าติดป้ายทุก 12 งวดจะได้ 100 ป้ายซ้อนกันจนอ่านไม่ออกบนมือถือ
 */

import { describe, expect, it } from 'vitest'
import { yearTicks } from './charts'

const months = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i)

describe('yearTicks', () => {
  it('ไม่มีข้อมูลก็ไม่มีป้าย', () => {
    expect(yearTicks([])).toEqual([])
  })

  it('ช่วง 5 ปี ติดป้ายทุกปี', () => {
    expect(yearTicks(months(60))).toEqual([12, 24, 36, 48, 60])
  })

  it('ช่วง 30 ปี ไม่เกิน 6 ป้าย', () => {
    const t = yearTicks(months(360))
    expect(t.length).toBeLessThanOrEqual(6)
    expect(t).toEqual([60, 120, 180, 240, 300, 360])
  })

  it('ชนเพดาน 1,200 งวด ต้องยังไม่เกิน 6 ป้าย (เคสที่ทำให้ป้ายทับกัน)', () => {
    const t = yearTicks(months(1200))
    expect(t.length).toBeLessThanOrEqual(6)
    expect(t).toEqual([300, 600, 900, 1200])
  })

  it('ทุกช่วงความยาวตั้งแต่ 1 ถึง 1,200 งวด ต้องไม่เกิน 6 ป้ายเสมอ', () => {
    for (let n = 1; n <= 1200; n++) {
      expect(yearTicks(months(n)).length).toBeLessThanOrEqual(6)
    }
  })

  it('ป้ายต้องตกบนปีพอดีเสมอ ไม่ใช่กลางปี', () => {
    for (const n of [7, 60, 145, 360, 700, 1200]) {
      for (const m of yearTicks(months(n))) expect(m % 12).toBe(0)
    }
  })

  it('เริ่มนับจากงวดจริง ไม่ใช่ตำแหน่งในอาร์เรย์ — เลือกช่วงปีแล้วยังถูก', () => {
    // หน้าต่าง 5 ปีที่เริ่มกลางสัญญา งวด 97-156
    expect(yearTicks(months(60, 97))).toEqual([108, 120, 132, 144, 156])
  })
})
