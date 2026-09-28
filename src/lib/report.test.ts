/**
 * TV-52 — รายงาน HTML ต้องปลอดภัยและครบถ้วน
 *
 * ⛔ ชื่อทรัพย์สินกับหมายเหตุเป็นข้อความที่ผู้ใช้พิมพ์เอง ต้อง escape ทุกจุด
 *    ไฟล์นี้ถูกส่งต่อทางแชทและเปิดด้วยเบราว์เซอร์ ถ้าหลุด <script> เข้าไปได้
 *    คนที่เปิดไฟล์จะโดนรันโค้ดในบริบทไฟล์นั้นทันที
 *
 * ⛔ ห้ามมีลิงก์ไปไฟล์ภายนอกเด็ดขาด — รายงานต้องเปิดได้ตอนไม่มีเน็ต
 */

import { describe, expect, it } from 'vitest'
import { buildSchedule } from '@engine/schedule.js'
import { groupSchedule } from '@engine/grouping.js'
import { makeTerms, fixedStep } from '@engine/test-helpers.js'
import { baht, toFixed, type Fixed } from '@engine/money.js'
import { isoDate } from '@engine/date.js'
import { loanReportHtml, type ReportInput } from './report'
import type { StoredPayment } from './db'

const TERMS = makeTerms({
  startDate: isoDate('2026-03-05'),
  principalBaht: 3_000_000,
  installmentBaht: 20_000,
  dueDayOfMonth: 5,
  rateSteps: [fixedStep(4, 1, null)],
})
const ROWS = buildSchedule(TERMS, []).rows
const GROUPS = groupSchedule(ROWS, 'contract_year')

function payment(note: string | null): StoredPayment {
  return {
    id: 'p1',
    paidDate: isoDate('2026-04-05'),
    amountSatang: baht(20_000),
    kind: 'installment',
    note,
  } as StoredPayment
}

function report(over: Partial<ReportInput> = {}): string {
  return loanReportHtml({
    propertyName: 'คอนโดรังสิต',
    bankLabel: 'กสิกรไทย',
    contractDate: isoDate('2026-03-01'),
    disbursedSatang: baht(3_000_000),
    installmentSatang: baht(20_000),
    rows: ROWS,
    groups: GROUPS,
    payments: [],
    scheduledOf: () => toFixed(baht(20_000)),
    settled: 12,
    today: isoDate('2027-03-05'),
    ...over,
  })
}

describe('TV-52 ความปลอดภัยของรายงาน', () => {
  const evil = '<script>alert(1)</script>'
  const note = payment(evil)

  it('ชื่อทรัพย์สินที่มีแท็กต้องถูก escape ไม่หลุดเป็น HTML', () => {
    const html = report({ propertyName: evil })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('หมายเหตุของรายการจ่ายก็ต้องถูก escape เหมือนกัน', () => {
    const html = report({ payments: [note] })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('ห้ามอ้างอิงไฟล์ภายนอก รายงานต้องเปิดได้ตอนไม่มีเน็ต', () => {
    const html = report()
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toMatch(/<(link|script|img)\b/)
  })
})

describe('TV-52 เนื้อหาของรายงาน', () => {
  it('มีครบทุกแถวของตารางผ่อนและสรุปรายปี ไม่ตัดทิ้ง', () => {
    const html = report()
    const bodies = [...html.matchAll(/<tbody>(.*?)<\/tbody>/gs)].map(
      (m) => (m[1]!.match(/<tr>/g) ?? []).length,
    )
    expect(bodies).toEqual([GROUPS.length, ROWS.length])
  })

  it('ไม่มีรายการจ่าย = ไม่ต้องมีหัวข้อบันทึกการจ่ายให้เกะกะ', () => {
    expect(report()).not.toContain('บันทึกการจ่าย')
    expect(report({ payments: [payment(null)] })).toContain('บันทึกการจ่าย')
  })

  it('ยังไม่ได้จ่ายสักงวด ยอดหนี้ต้องเป็นวงเงินเต็ม ไม่ใช่ 0', () => {
    const html = report({ settled: 0 })
    expect(html).toContain('3,000,000')
  })

  it('บอกด้วยว่างวดไหนเป็นต้นไปเป็นประมาณการ ไม่ใช่ยอดจริง', () => {
    expect(report({ settled: 12 })).toContain('งวดที่ 13 เป็นต้นไปเป็นประมาณการ')
  })
})

describe('TV-52 คอลัมน์โปะของงวดที่จ่ายจริง', () => {
  // จ่าย 500,000 ในงวดที่ค่างวดตามสัญญา 20,000 = โปะไป 480,000
  const rows = buildSchedule(TERMS, [
    { date: isoDate('2026-04-05'), amountSatang: baht(500_000), kind: 'installment' },
  ]).rows
  const html = report({
    rows,
    groups: groupSchedule(rows, 'contract_year'),
    settled: 1,
  })
  const firstRow = html.slice(html.lastIndexOf('<tbody>')).split('</tr>')[0] ?? ''

  it('ต้องแสดงส่วนที่จ่ายเกินค่างวด ไม่ใช่ขีด', () => {
    expect(firstRow).toContain('480,000.00')
  })

  /**
   * ⛔ prepayFixed นับเฉพาะยอดจากแผนกับรายการ "โปะบางส่วน"
   *    เงินที่โอนเกินค่างวดมาในรายการเดียวไม่ถูกนับ ต้องใช้ prepayOfRow เท่านั้น
   */
  it('ค่าดิบ prepayFixed ของงวดนั้นเป็น 0 — เทสต์นี้จึงจับบั๊กได้จริง', () => {
    expect(rows[0]!.prepayFixed).toBe(0n as Fixed)
    expect(rows[0]!.flags).toContain('actual_payment')
  })
})
