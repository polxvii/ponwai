/**
 * Dashboard (spec ข้อ 4 + 5.4)
 *
 * ⛔ ห้ามทำเป็น "ตัวเลขใหญ่ + gradient" — hero คือ Split Ribbon
 *    ยกขึ้นแผงหมึกเข้ม เพราะบนพื้นกระดาษทั้งจอ สีทองจมหายและไม่มีลำดับสายตา (ข้อ 5.4)
 *
 * ⚠️ เพดานลดหย่อนภาษีคิดรวมทุกสัญญา ไม่ใช่รายสัญญา (ข้อ 1.9)
 *    จึงต้องโหลดทุกสัญญาเข้ามาพร้อมกัน ไม่ใช่แค่หลังที่กำลังดู
 */

import { useMemo, useState } from 'react'
import { buildSchedule } from '@engine/schedule.js'
import {
  summariseTaxYears, TAX_DEDUCTION_CAP_SATANG, type GroupAxis,
} from '@engine/grouping.js'
import { FIXED_SCALE, type Fixed } from '@engine/money.js'
import type { ScheduleRow } from '@engine/types.js'
import { daysBetween, year as yearOf, type ISODate } from '@engine/date.js'
import { SplitRibbon } from '@/components/SplitRibbon'
import { SplitBar, CapMeter } from '@/components/SplitBar'
import { Field, SelectField } from '@/components/Field'
import { baht, bahtRounded, formatDuration, formatThaiDate } from '@/lib/format'
import { toLoanTerms, toPaymentEvents, type LoanFull, type LoanListItem } from '@/lib/db'
import { BalanceChart, TaxChart, YearBarsChart } from './charts'

export type LoanBundle = { item: LoanListItem; full: LoanFull }

const ZERO = 0n as Fixed
const CAP_BAHT = Number(TAX_DEDUCTION_CAP_SATANG) / 100

/**
 * ความกว้างของหน้าต่างที่กราฟแสดง — null = ทั้งสัญญา
 *
 * ⚠️ เป็น "ความกว้าง" ไม่ใช่ "นับไปข้างหน้าจากวันนี้"
 *    รอบแรกทำเป็นแบบหลัง เลือก 5 ปีแล้วยังเห็น 7 ปีเพราะอดีตถูกเก็บไว้ทั้งหมด
 *    ซึ่งขัดกับสิ่งที่ปุ่มบอก ตอนนี้เลือก 5 = เห็น 5 ปีเป๊ะ แล้วเลื่อนหน้าต่างเอาเอง
 */
const WINDOWS: readonly { years: number | null; label: string }[] = [
  { years: 3, label: '3 ปี' },
  { years: 5, label: '5 ปี' },
  { years: 10, label: '10 ปี' },
  { years: null, label: 'ทั้งหมด' },
]

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function DashboardPage({
  bundles,
  today,
  onOpenLoan,
}: {
  bundles: readonly LoanBundle[]
  today: ISODate
  onOpenLoan: (item: LoanListItem) => void
}) {
  const [selectedId, setSelectedId] = useState<string>(() => bundles[0]?.item.loanId ?? '')
  const [axis, setAxis] = useState<GroupAxis>('contract_year')
  const [windowYears, setWindowYears] = useState<number | null>(5)
  /** หน้าต่างเริ่มที่ปีไหน — null = ตามปีปัจจุบัน ไม่ใช่ปีแรกของสัญญา */
  const [windowStart, setWindowStart] = useState<number | null>(null)

  const computed = useMemo(
    () =>
      bundles.map((b) => {
        const terms = toLoanTerms(b.full)
        const events = toPaymentEvents(b.full)
        return {
          ...b,
          // "ถ้าไม่โปะ" = ตารางที่ไม่ใส่เหตุการณ์จ่ายเลย ใช้เป็นฐานวัดว่าการโปะช่วยได้แค่ไหน
          actual: buildSchedule(terms, events),
          noPrepay: buildSchedule(terms),
        }
      }),
    [bundles],
  )

  const taxYears = useMemo(
    () =>
      summariseTaxYears(
        computed.map((c) => ({ loanId: c.item.loanId, rows: c.actual.rows })),
      ),
    [computed],
  )

  const selected = computed.find((c) => c.item.loanId === selectedId) ?? computed[0]
  if (!selected) return null

  const thisYear = Number(today.slice(0, 4))
  const taxThisYear = taxYears.find((t) => t.taxYear === thisYear)

  // รวมทุกหลัง (ข้อ 11 ข้อ 2)
  const totalDebt = computed.reduce(
    (a, c) => (a + balanceAt(c.actual.rows, today, c.item)) as Fixed,
    ZERO,
  )
  const interestThisYear = computed.reduce(
    (a, c) =>
      (a +
        c.actual.rows
          .filter((r) => r.date.startsWith(String(thisYear)))
          .reduce((x, r) => (x + r.interestFixed) as Fixed, ZERO)) as Fixed,
    ZERO,
  )

  const rows = selected.actual.rows
  const currentIndex = periodsElapsed(rows, today)

  /**
   * โปะจริงหรือยัง — เทียบตารางเต็มสองชุด ไม่ใช่ชุดที่ถูกกรองตามช่วงปีที่เลือก
   * ยอดคงเหลือต่างกันแม้งวดเดียวก็ถือว่าโปะแล้ว เพราะจำนวนงวดอาจเท่าเดิมได้
   */
  const hasPrepay =
    rows.length !== selected.noPrepay.rows.length ||
    rows.some((r, i) => r.balanceAfterFixed !== selected.noPrepay.rows[i]?.balanceAfterFixed)

  // ---------- หน้าต่างที่กราฟแสดง ----------
  const firstYear = yearOf(rows[0]?.date ?? today)
  const finalYear = yearOf(rows[rows.length - 1]?.date ?? today)
  const defaultStart = clamp(yearOf(today), firstYear, finalYear)
  const winFrom =
    windowYears === null ? firstYear : clamp(windowStart ?? defaultStart, firstYear, finalYear)
  const winTo = windowYears === null ? finalYear : winFrom + windowYears - 1

  const inRange = (r: ScheduleRow): boolean => {
    const y = yearOf(r.date)
    return y >= winFrom && y <= winTo
  }
  const viewRows = windowYears === null ? rows : rows.filter(inRange)
  const viewNoPrepay =
    windowYears === null ? selected.noPrepay.rows : selected.noPrepay.rows.filter(inRange)
  const viewTax =
    windowYears === null
      ? taxYears
      : taxYears.filter((t) => t.taxYear >= winFrom && t.taxYear <= winTo)
  const shift = (delta: number) => setWindowStart(clamp(winFrom + delta, firstYear, finalYear))
  const currentRow = currentIndex > 0 ? rows[currentIndex - 1] : undefined
  const nextRow = rows[currentIndex]
  const balance = balanceAt(rows, today, selected.item)
  const principalPaid = ((selected.item.disbursedSatang * FIXED_SCALE) - balance) as Fixed
  const interestPaid = rows
    .slice(0, currentIndex)
    .reduce((a, r) => (a + r.interestPaidFixed) as Fixed, ZERO)
  const cashPaid = rows
    .slice(0, currentIndex)
    .reduce((a, r) => (a + r.paymentFixed) as Fixed, ZERO)
  const savedPeriods = selected.noPrepay.rows.length - rows.length
  const payoff = rows[rows.length - 1]

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
      {/* ---------- รวมทุกหลัง ---------- */}
      {computed.length > 1 && (
        <section className="mb-6 flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <div>
            <p className="text-meta text-[var(--color-ink-2)]">
              หนี้รวมทุกหลัง ({computed.length} สัญญา)
            </p>
            <p className="num text-figure">{bahtRounded(totalDebt)}</p>
          </div>
          <div>
            <p className="text-meta text-[var(--color-ink-2)]">
              ดอกเบี้ยรวมปี {thisYear + 543}
            </p>
            <p className="num text-figure">{bahtRounded(interestThisYear)}</p>
          </div>
        </section>
      )}

      {computed.length > 1 && (
        <div className="mb-4 max-w-[380px]">
          <Field label="กำลังดูหลัง">
            <SelectField
              value={selectedId === '' ? selected.item.loanId : selectedId}
              onChange={setSelectedId}
              options={computed.map((c) => ({
                value: c.item.loanId,
                label: `${c.item.propertyName} · ${c.item.bankLabel}`,
              }))}
            />
          </Field>
        </div>
      )}

      {/* ---------- hero บนแผงหมึกเข้ม (ข้อ 5.4) ---------- */}
      <section className="rounded-lg bg-[var(--color-panel)] p-5 text-[var(--color-panel-ink)] sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-meta text-[var(--color-panel-ink-2)]">
            งวด {currentIndex} จาก {rows.length}
          </p>
          <p className="text-meta text-[var(--color-panel-ink-2)]">
            {nextRow
              ? `งวดถัดไป ${formatThaiDate(nextRow.date, 'long')}`
              : 'ปิดหนี้ครบแล้ว'}
          </p>
        </div>

        <p className="mt-3 num text-hero">{bahtRounded(balance)}</p>
        <p className="text-meta text-[var(--color-panel-ink-2)]">
          ยังเป็นหนี้อยู่เท่านี้
        </p>

        <div className="mt-5">
          <SplitRibbon rows={rows} currentIndex={currentIndex} />
        </div>
      </section>

      {/* ---------- งวดล่าสุดเป็นประโยคเดียว ภาษาคน (ข้อ 4.1) ---------- */}
      {currentRow && (
        <section className="mt-6">
          <p className="text-lead">
            งวดที่ {currentRow.index} จ่าย {bahtRounded(currentRow.paymentFixed)}
          </p>
          <SplitBar
            className="mt-2 max-w-[520px]"
            interest={currentRow.interestFixed}
            principal={currentRow.principalFixed}
            height={10}
          />
          <p className="mt-1 text-meta text-[var(--color-ink-2)]">
            เป็นดอกเบี้ย {bahtRounded(currentRow.interestFixed)} เข้าเงินต้น{' '}
            {bahtRounded(currentRow.principalFixed)} · คิดดอก {currentRow.accrualDays} วัน
          </p>
        </section>
      )}

      {/* ---------- ตัวเลขสรุป ---------- */}
      <section className="mt-6 max-w-[520px] divide-y divide-[var(--color-rule)]">
        <Line k={`จ่ายไปแล้ว ${currentIndex} งวด`} v={bahtRounded(cashPaid)} />
        <Line k="หายไปกับดอกเบี้ย" v={bahtRounded(interestPaid)} tone="interest" />
        <Line k="กลายเป็นของเราแล้ว" v={bahtRounded(principalPaid)} tone="principal" />
        <Line
          k="ปิดหนี้"
          v={payoff ? formatThaiDate(payoff.date, 'monthYear') : '—'}
          sub={savedPeriods > 0 ? `เร็วขึ้น ${formatDuration(savedPeriods)}` : 'ตามแผน'}
        />
      </section>

      {/* ---------- สิทธิลดหย่อนภาษี ---------- */}
      <section className="mt-8 max-w-[520px]">
        <h2 className="text-row">สิทธิลดหย่อนภาษีปี {thisYear + 543}</h2>
        <p className="mt-1 text-meta text-[var(--color-ink-2)]">
          {computed.length > 1
            ? `รวมดอกเบี้ยจากทั้ง ${computed.length} สัญญา เพราะเพดานเป็นของคนหนึ่งคน ไม่ใช่ต่อสัญญา`
            : 'ดอกเบี้ยบ้านใช้ลดหย่อนได้ตามจริง ไม่เกินเพดาน'}
        </p>

        {taxThisYear ? (
          <>
            <p className="mt-3 num text-figure">
              {bahtRounded(taxThisYear.deductibleFixed)}
            </p>
            <CapMeter
              used={taxThisYear.deductibleFixed}
              cap={(TAX_DEDUCTION_CAP_SATANG * FIXED_SCALE) as Fixed}
            />
            <p className="mt-1 text-meta text-[var(--color-ink-2)]">
              {taxThisYear.excessFixed > 0n
                ? `เต็มเพดานแล้ว ส่วนที่เกิน ${bahtRounded(taxThisYear.excessFixed)} ใช้สิทธิไม่ได้`
                : `เหลือสิทธิอีก ${bahtRounded(((TAX_DEDUCTION_CAP_SATANG * FIXED_SCALE) - taxThisYear.deductibleFixed) as Fixed)}`}
            </p>
          </>
        ) : (
          <p className="mt-3 text-[var(--color-ink-2)]">ยังไม่มีดอกเบี้ยในปีภาษีนี้</p>
        )}
      </section>

      {/* ---------- กราฟ ---------- */}
      <div className="mt-2">
        <div className="mt-8 flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="max-w-[240px] min-w-[180px] flex-1">
            <Field label="นับปีแบบ">
              <SelectField
                value={axis}
                onChange={setAxis}
                options={[
                  { value: 'contract_year' as const, label: 'ปีสัญญา' },
                  { value: 'calendar_year' as const, label: 'ปีปฏิทิน' },
                ]}
              />
            </Field>
          </div>

          <div>
            <span className="block text-meta text-[var(--color-ink-2)]">
              ช่วงที่แสดง
            </span>
            <div className="mt-1 flex gap-1">
              {WINDOWS.map((h) => (
                <button
                  key={h.label}
                  onClick={() => {
                    setWindowYears(h.years)
                    setWindowStart(null)
                  }}
                  aria-pressed={windowYears === h.years}
                  className={`tap rounded-md border px-3 py-2 text-meta whitespace-nowrap ${
                    windowYears === h.years
                      ? 'border-[var(--color-interest)] bg-[var(--color-interest-tint)] text-[var(--color-interest)]'
                      : 'border-[var(--color-rule)] text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>

          {/* เลื่อนหน้าต่างทีละปี เพื่อโฟกัสช่วงที่อยากดู */}
          {windowYears !== null && (
            <div>
              <span className="block text-meta text-[var(--color-ink-2)]">
                โฟกัสปี
              </span>
              <div className="mt-1 flex items-center gap-2">
                <button
                  onClick={() => shift(-1)}
                  disabled={winFrom <= firstYear}
                  aria-label="ย้อนกลับหนึ่งปี"
                  className="tap rounded-md border border-[var(--color-rule)] px-3 py-2 disabled:opacity-40"
                >
                  ←
                </button>
                <span className="num min-w-[112px] text-center text-meta">
                  {winFrom + 543} – {Math.min(winTo, finalYear) + 543}
                </span>
                <button
                  onClick={() => shift(1)}
                  disabled={winTo >= finalYear}
                  aria-label="ถัดไปหนึ่งปี"
                  className="tap rounded-md border border-[var(--color-rule)] px-3 py-2 disabled:opacity-40"
                >
                  →
                </button>
              </div>
            </div>
          )}
        </div>

        {windowYears !== null && (
          <p className="mt-2 text-meta text-[var(--color-ink-3)]">
            แสดง {viewRows.length} งวด จากทั้งหมด {rows.length} งวด · สัญญาถึงปี{' '}
            {finalYear + 543}
          </p>
        )}

        <YearBarsChart rows={viewRows} axis={axis} />
        <BalanceChart actual={viewRows} noPrepay={viewNoPrepay} hasPrepay={hasPrepay} />
        <TaxChart summaries={viewTax} capBaht={CAP_BAHT} />
      </div>

      <button
        onClick={() => onOpenLoan(selected.item)}
        className="tap mt-8 text-meta text-[var(--color-interest)] hover:underline"
      >
        ดูตารางผ่อนของ {selected.item.propertyName} →
      </button>
    </div>
  )
}

function Line({
  k,
  v,
  sub,
  tone,
}: {
  k: string
  v: string
  sub?: string
  tone?: 'interest' | 'principal'
}) {
  const color =
    tone === 'interest'
      ? 'text-[var(--color-interest)]'
      : tone === 'principal'
        ? 'text-[var(--color-principal-text)]'
        : ''
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-[var(--color-ink-2)]">{k}</span>
      <span className="text-right">
        <span className={`num text-row ${color}`}>{v}</span>
        {sub && (
          <span className="block text-micro text-[var(--color-ink-3)]">{sub}</span>
        )}
      </span>
    </div>
  )
}

/** จำนวนงวดที่ถึงกำหนดแล้ว ณ วันที่ให้มา */
function periodsElapsed(rows: readonly ScheduleRow[], date: ISODate): number {
  let n = 0
  for (const r of rows) {
    if (daysBetween(r.date, date) >= 0) n = r.index
    else break
  }
  return n
}

function balanceAt(
  rows: readonly ScheduleRow[],
  date: ISODate,
  item: LoanListItem,
): Fixed {
  const n = periodsElapsed(rows, date)
  if (n === 0) return (item.disbursedSatang * FIXED_SCALE) as Fixed
  return rows[n - 1]!.balanceAfterFixed
}
