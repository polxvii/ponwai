/**
 * ส่งออกรายงานเป็น CSV
 *
 * ⚠️ ต้องมี BOM ของ UTF-8 นำหน้าเสมอ
 *    Excel บน Windows เปิด CSV ด้วย codepage ของระบบ (874 สำหรับไทย) ถ้าไม่มี BOM
 *    ภาษาไทยจะกลายเป็นขยะทั้งไฟล์ ซึ่งผู้ใช้แก้เองไม่ได้นอกจากรู้วิธี import ทีละขั้น
 *
 * ⚠️ ตัวเลขเงินส่งออกเป็นทศนิยม 2 ตำแหน่งแบบไม่มีคอมมา
 *    คอมมาทำให้ Excel อ่านเป็นข้อความ แล้วเอาไปคำนวณต่อไม่ได้
 */

import type { Fixed, Satang } from '@engine/money.js'
import { FIXED_SCALE } from '@engine/money.js'
import type { ScheduleRow } from '@engine/types.js'
import type { YearGroup, TaxYearSummary } from '@engine/grouping.js'
import type { ReconResult } from '@engine/reconcile.js'
import type { ISODate } from '@engine/date.js'
import { formatThaiDate } from './format'
import type { StoredPayment } from './db'

const BOM = '﻿'

/** ตัวเลขสำหรับ Excel — ไม่มีคอมมา ไม่มีสัญลักษณ์สกุลเงิน */
function num(v: Fixed | Satang | bigint, scale: bigint): string {
  const satang = scale === FIXED_SCALE ? v / FIXED_SCALE : v
  const neg = satang < 0n
  const abs = neg ? -satang : satang
  const baht = abs / 100n
  const cents = abs % 100n
  return `${neg ? '-' : ''}${baht}.${String(cents).padStart(2, '0')}`
}

const fromFixed = (v: Fixed): string => num(v, FIXED_SCALE)
const fromSatang = (v: Satang | bigint): string => num(v, 1n)

/** ห่อค่าที่มีคอมมา อัญประกาศ หรือขึ้นบรรทัดใหม่ ตาม RFC 4180 */
function cell(v: string | number): string {
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: readonly (readonly (string | number)[])[]): string {
  // CRLF เพราะ Excel รุ่นเก่าบน Windows ยังคาดหวังแบบนี้
  return BOM + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

export function downloadCsv(filename: string, rows: readonly (readonly (string | number)[])[]): void {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // ปล่อย object URL ทิ้ง ไม่งั้นค้างในหน่วยความจำจนกว่าจะปิดแท็บ
  URL.revokeObjectURL(url)
}

/** ชื่อไฟล์ที่เรียงตามเวลาได้เอง และไม่มีอักขระที่ระบบไฟล์ไม่รับ */
export function reportName(propertyName: string, kind: string, today: ISODate): string {
  const safe = propertyName.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40) || 'สินเชื่อ'
  return `ponwai_${safe}_${kind}_${today}`
}

// ---------- ตารางผ่อนรายงวด ----------

export function scheduleCsv(rows: readonly ScheduleRow[]): (string | number)[][] {
  return [
    [
      'งวดที่', 'วันตัด (ค.ศ.)', 'วันตัด (พ.ศ.)', 'วันตัดตามกฎ',
      'เริ่มคิดดอก', 'จำนวนวัน', 'อัตรา (%)',
      'ค่างวด', 'โปะ', 'ยอดจ่ายรวม', 'ดอกเบี้ย', 'เงินต้น', 'ดอกค้างยกไป', 'คงเหลือ', 'หมายเหตุ',
    ],
    ...rows.map((r) => [
      r.index,
      r.date,
      formatThaiDate(r.date, 'short'),
      r.nominalDate === r.date ? '' : formatThaiDate(r.nominalDate, 'short'),
      r.accrualFrom,
      r.accrualDays,
      (r.effectiveRateBps / 100).toFixed(4),
      fromFixed((r.paymentFixed - r.prepayFixed) as Fixed),
      fromFixed(r.prepayFixed),
      fromFixed(r.paymentFixed),
      fromFixed(r.interestFixed),
      fromFixed(r.principalFixed),
      fromFixed(r.accruedCarriedFixed),
      fromFixed(r.balanceAfterFixed),
      r.flags.join(' '),
    ]),
  ]
}

// ---------- สรุปรายปี ----------

export function yearSummaryCsv(groups: readonly YearGroup[]): (string | number)[][] {
  return [
    ['ปี', 'ช่วงเดือน', 'จำนวนงวด', 'ครบปีไหม', 'ยอดจ่ายรวม', 'ดอกเบี้ย', 'เงินต้น', 'โปะ', 'อัตราที่จ่ายจริง (%)', 'คงเหลือสิ้นปี'],
    ...groups.map((g) => [
      g.label,
      `${g.rows[0]?.date ?? ''} ถึง ${g.rows[g.rows.length - 1]?.date ?? ''}`,
      g.periodCount,
      g.isPartialYear ? 'ไม่ครบปี' : 'ครบปี',
      fromFixed(g.paymentFixed),
      fromFixed(g.interestFixed),
      fromFixed(g.principalFixed),
      fromFixed(g.prepayFixed),
      (g.effectiveRateBps / 100).toFixed(4),
      fromFixed(g.closingBalanceFixed),
    ]),
  ]
}

// ---------- การจ่ายที่บันทึกไว้ ----------

export function paymentsCsv(payments: readonly StoredPayment[]): (string | number)[][] {
  const KIND: Record<string, string> = {
    installment: 'ค่างวดปกติ',
    partial_prepay: 'โปะบางส่วน',
    full_redemption: 'ปิดบัญชี',
    fee: 'ค่าธรรมเนียม',
  }
  return [
    ['วันที่จ่าย (ค.ศ.)', 'วันที่จ่าย (พ.ศ.)', 'ประเภท', 'จำนวนเงิน', 'หมายเหตุ'],
    ...payments.map((p) => [
      p.paidDate,
      formatThaiDate(p.paidDate, 'short'),
      KIND[p.kind] ?? p.kind,
      fromSatang(p.amountSatang),
      p.note ?? '',
    ]),
  ]
}

// ---------- สรุปภาษีรายปี ----------

/**
 * ใช้ตรวจทานกับหนังสือรับรองดอกเบี้ยของธนาคารตอนยื่นภาษี
 * ⚠️ เพดานเป็นของคนหนึ่งคนต่อปี ไม่ใช่ต่อสัญญา ตัวเลขนี้จึงรวมทุกสัญญาแล้ว (ข้อ 1.9)
 */
export function taxSummaryCsv(
  summaries: readonly TaxYearSummary[],
  nameOf: (loanId: string) => string,
): (string | number)[][] {
  const rows: (string | number)[][] = [
    ['ปีภาษี (พ.ศ.)', 'สัญญา', 'ดอกเบี้ยในปีนั้น', 'รวมทุกสัญญา', 'ใช้สิทธิได้', 'เกินเพดาน'],
  ]
  for (const s of summaries) {
    for (const l of s.byLoan) {
      rows.push([
        s.taxYear + 543,
        nameOf(l.loanId),
        fromFixed(l.interestFixed),
        fromFixed(s.totalInterestFixed),
        fromFixed(s.deductibleFixed),
        fromFixed(s.excessFixed),
      ])
    }
  }
  return rows
}

// ---------- ผลกระทบยอด ----------

export function reconCsv(results: readonly ReconResult[]): (string | number)[][] {
  const ZONE: Record<string, string> = {
    green: 'ตรง',
    yellow: 'ต่างเล็กน้อย',
    red: 'ต่างมาก',
  }
  return [
    ['วันที่ในใบแจ้งยอด', 'วันที่ (พ.ศ.)', 'งวดที่', 'จับคู่ได้ไหม', 'Δ ดอกเบี้ย', 'Δ คงเหลือ', 'สถานะ'],
    ...results.map((r) => [
      r.stmtDate,
      formatThaiDate(r.stmtDate, 'short'),
      r.periodIndex ?? '',
      r.matched ? 'ใช่' : 'ไม่',
      r.interestDeltaSatang === null ? '' : fromSatang(r.interestDeltaSatang),
      r.balanceDeltaSatang === null ? '' : fromSatang(r.balanceDeltaSatang),
      ZONE[r.zone] ?? r.zone,
    ]),
  ]
}
