/**
 * TV-37 — ยอดรวมใน tooltip ของกราฟแท่งซ้อน
 *
 * แท่งซ้อนอ่านความสูงรวมด้วยตาไม่ได้ เพราะฐานของท่อนบนไม่ได้อยู่ที่ 0
 * ตัวเลข "รวมจ่ายทั้งปี" จึงเป็นสิ่งเดียวที่ตอบคำถามหลักของกราฟนี้ได้
 */

import { describe, expect, it } from 'vitest'
import { tooltipTotals, type TipItem } from './charts'

describe('tooltipTotals', () => {
  it('รวมดอกกับต้นเป็นยอดจ่ายทั้งปี', () => {
    const payload: TipItem[] = [
      { dataKey: 'interest', value: 329_495 },
      { dataKey: 'principal', value: 114_505 },
    ]
    expect(tooltipTotals(payload)).toEqual({
      interest: 329_495,
      principal: 114_505,
      total: 444_000,
    })
  })

  it('อ่านตาม dataKey ไม่ใช่ลำดับ — สลับลำดับแล้วต้องได้เท่าเดิม', () => {
    const swapped: TipItem[] = [
      { dataKey: 'principal', value: 114_505 },
      { dataKey: 'interest', value: 329_495 },
    ]
    expect(tooltipTotals(swapped)).toEqual({
      interest: 329_495,
      principal: 114_505,
      total: 444_000,
    })
  })

  it('ซ่อน series ที่ legend แล้วยังรวมเฉพาะตัวที่เหลือ ไม่พัง', () => {
    expect(tooltipTotals([{ dataKey: 'interest', value: 329_495 }])).toEqual({
      interest: 329_495,
      principal: 0,
      total: 329_495,
    })
  })

  it('payload ว่างหรือค่าเพี้ยน ให้ 0 ไม่ใช่ NaN — NaN จะโชว์เป็น "NaN บาท"', () => {
    expect(tooltipTotals(undefined)).toEqual({ interest: 0, principal: 0, total: 0 })
    expect(tooltipTotals([])).toEqual({ interest: 0, principal: 0, total: 0 })
    expect(
      tooltipTotals([
        { dataKey: 'interest', value: Number.NaN },
        { dataKey: 'principal', value: '114505' },
      ]),
    ).toEqual({ interest: 0, principal: 0, total: 0 })
  })
})
