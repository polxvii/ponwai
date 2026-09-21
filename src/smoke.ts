/**
 * Smoke test หน้าเว็บสำหรับ M1
 *
 * ไม่ใช่ UI จริง — มีไว้พิสูจน์ 2 อย่างเท่านั้น:
 *   1. engine ที่ใช้ bigint ทำงานในเบราว์เซอร์ได้ (ไม่ใช่แค่ใน Node)
 *   2. pipeline build -> deploy ต่อกันครบตั้งแต่ commit แรก
 *
 * จะถูกแทนที่ด้วย React app ใน M3
 */

import { buildSchedule } from './engine/schedule.js'
import { formatFixedBaht, baht, bps, type Fixed } from './engine/money.js'
import { isoDate } from './engine/date.js'
import type { LoanTerms } from './engine/types.js'

const startDate = isoDate('2026-10-01')

const terms: LoanTerms = {
  principalSatang: baht(3_000_000),
  startDate,
  termMonths: 360,
  dueDayOfMonth: 1,
  dateRoll: 'none',
  rollCalendar: 'weekend_only',
  bankHolidays: [],
  scheduleOverrides: {},
  rateSteps: [{ fromMonth: 1, toMonth: null, kind: 'fixed', fixedRateBps: bps(500) }],
  referenceRates: [],
  conventions: [{
    effectiveFrom: startDate,
    dayCountBasis: 'ACT/365F',
    rounding: 'none',
    capitaliseUnpaidInterest: false,
  }],
  installmentSatang: baht(16_200),
  prepayMode: 'shorten_term',
}

const result = buildSchedule(terms)
const first = result.rows[0]!

const interest = Number(first.interestFixed)
const principal = Number(first.principalFixed)
const total = interest + principal
const interestPct = (interest / total) * 100

const el = document.getElementById('app')
if (el) {
  el.innerHTML = `
    <div class="panel">
      <h2>งวดแรก · เงินกู้ 3,000,000 @ 5.00% ค่างวด 16,200</h2>
      <div class="ribbon">
        <span class="i" style="width:${interestPct.toFixed(2)}%"></span>
        <span class="p" style="width:${(100 - interestPct).toFixed(2)}%"></span>
      </div>
      <div class="legend">
        <span>ดอกเบี้ย <strong class="num i-tx">${fmt(first.interestFixed)}</strong></span>
        <span>เงินต้น <strong class="num p-tx">${fmt(first.principalFixed)}</strong></span>
      </div>
    </div>
    <dl>
      <dt>จำนวนวันที่คิดดอก</dt><dd>${first.accrualDays} วัน</dd>
      <dt>ยอดคงเหลือหลังงวดแรก</dt><dd>${fmt(first.balanceAfterFixed)}</dd>
      <dt>ผ่อนทั้งหมด</dt><dd>${result.rows.length} งวด</dd>
      <dt>ดอกเบี้ยรวมตลอดสัญญา</dt><dd>${fmt(result.totalInterestFixed)}</dd>
      <dt>ปิดหนี้ครบ</dt><dd>${result.paidOff ? 'ใช่' : 'ไม่'}</dd>
    </dl>
    <p style="font-size:13px;color:var(--ink-2);margin-top:14px">
      ค่าที่ควรได้ตาม spec TV-16: <code>356 งวด</code> · <code>2,758,560.20</code>
      ${check(result.rows.length === 356 && fmt(result.totalInterestFixed) === '2,758,560.20')}
    </p>
  `
}

function fmt(v: Fixed): string {
  return formatFixedBaht(v)
}

function check(ok: boolean): string {
  return ok
    ? '<strong style="color:#2F6B4F">✓ ตรง</strong>'
    : '<strong style="color:#A8431F">✗ ไม่ตรง</strong>'
}
