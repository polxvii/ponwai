import { describe, it, expect } from 'vitest'
import { toCsv, reportName } from './export'
import { isoDate } from '@engine/date.js'

describe('CSV ส่งออก', () => {
  it('⚠️ ต้องมี BOM ของ UTF-8 ไม่งั้น Excel บน Windows อ่านภาษาไทยเป็นขยะ', () => {
    const csv = toCsv([['ดอกเบี้ย'], ['1234.56']])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('ใช้ CRLF ตาม RFC 4180', () => {
    expect(toCsv([['a'], ['b']])).toBe('﻿a\r\nb\r\n')
  })

  it('ห่อค่าที่มีคอมมา และ escape อัญประกาศ', () => {
    const csv = toCsv([['ปกติ', 'มี,คอมมา', 'มี"อัญประกาศ']])
    expect(csv).toContain('ปกติ,"มี,คอมมา","มี""อัญประกาศ"')
  })

  it('ห่อค่าที่มีการขึ้นบรรทัดใหม่ ไม่ให้แถวแตก', () => {
    expect(toCsv([['บรรทัด1\nบรรทัด2']])).toContain('"บรรทัด1\nบรรทัด2"')
  })

  it('ชื่อไฟล์ตัดอักขระที่ระบบไฟล์ไม่รับออก', () => {
    const n = reportName('บ้าน/ซอย:9*', 'schedule', isoDate('2026-09-23'))
    expect(n).toBe('ponwai_บ้านซอย9_schedule_2026-09-23')
    expect(n).not.toMatch(/[\/:*?"<>|]/)
  })

  it('ชื่อทรัพย์สินว่างเปล่าไม่ทำให้ชื่อไฟล์พัง', () => {
    expect(reportName('   ', 'x', isoDate('2026-01-01'))).toBe('ponwai_สินเชื่อ_x_2026-01-01')
  })
})
