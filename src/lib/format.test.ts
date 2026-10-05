/**
 * TV-54 — เงินต้องแสดงสตางค์เสมอ
 *
 * ⛔ ทั้งแอพมีไว้เพื่อให้ตัวเลขตรงกับใบแจ้งยอดธนาคาร "ระดับสตางค์"
 *    ตัวจับผิดของผู้ใช้คือสองหลักท้าย ถ้าซ่อนไว้ แอพก็ไม่เหลือเหตุผลที่จะมีอยู่
 *    และยอดเดียวกันบนคนละหน้าจะดูเหมือนไม่ตรงกัน เพราะแต่ละหน้าปัดคนละรอบ
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { baht, bahtFixed, bahtNumber } from './format'
import { toFixed, baht as toSatang } from '@engine/money.js'

describe('TV-54 ตัวแปลงเงินต้องมีทศนิยมโดยไม่ต้องสั่ง', () => {
  const satang = toSatang(1_234_567.89)

  it('baht จาก Satang', () => {
    expect(baht(satang)).toBe('1,234,567.89')
  })

  it('bahtFixed จาก Fixed ที่ engine คืนมา', () => {
    expect(bahtFixed(toFixed(satang))).toBe('1,234,567.89')
  })

  it('bahtNumber จากตัวเลขที่ผู้ใช้กรอก', () => {
    expect(bahtNumber(1_234_567.89)).toBe('1,234,567.89')
  })

  it('เลขกลมก็ยังต้องมี .00 ไม่ใช่หายไป — ไม่งั้นคอลัมน์ตัวเลขเหลื่อมกันทั้งตาราง', () => {
    expect(baht(toSatang(80_000))).toBe('80,000.00')
    expect(bahtNumber(80_000)).toBe('80,000.00')
  })

  it('หนึ่งสตางค์ต้องไม่หาย — ผลต่าง 0.01 คือสิ่งที่คนเอามาถามว่าทำไมไม่ตรง', () => {
    expect(baht(toSatang(0.01))).toBe('0.01')
    expect(bahtFixed(toFixed(toSatang(0.01)))).toBe('0.01')
  })
})

/**
 * ⛔ เทสต์นี้สแกนซอร์สจริง ไม่ใช่เรียกฟังก์ชัน
 *    เพราะบั๊กที่เกิดคือ "เรียกถูกตัว แต่สั่งให้ปัดทิ้ง" ซึ่งเรียกทดสอบตรง ๆ ไม่เจอ
 *    เคสจริง: หน้าภาพรวมทั้งหน้าใช้ bahtRounded แล้วไม่มีสตางค์ให้เทียบเลยสักช่อง
 */
describe('TV-54 ห้ามมีที่ไหนสั่งซ่อนสตางค์', () => {
  function sources(dir: string): string[] {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) out.push(...sources(full))
      else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) out.push(full)
    }
    return out
  }

  const files = sources('src').map((f) => ({ f, text: readFileSync(f, 'utf8') }))

  it('มีไฟล์ให้สแกนจริง ไม่ใช่ผ่านเพราะหาไม่เจอ', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('ไม่มีใครส่ง 0 ทศนิยมเข้าตัวแปลงเงิน', () => {
    const bad = files.filter((x) =>
      /\b(baht|bahtFixed|bahtNumber)\([^()]*,\s*0\s*\)/.test(x.text),
    )
    expect(bad.map((x) => x.f)).toEqual([])
  })

  it('bahtRounded ต้องไม่กลับมา', () => {
    // ยกเว้น format.ts ที่เก็บคำอธิบายไว้ว่าทำไมถึงเอาออก
    const bad = files.filter(
      (x) => x.text.includes('bahtRounded(') && !x.f.endsWith('format.ts'),
    )
    expect(bad.map((x) => x.f)).toEqual([])
  })
})
