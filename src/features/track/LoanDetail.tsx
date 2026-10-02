/**
 * หน้าสัญญาเดียว — ตารางผ่อนที่คิดจากการจ่ายจริง
 *
 * แนวคิด: ตารางนี้ต้องตรงกับใบแจ้งยอดธนาคารระดับสตางค์ ถ้าไม่ตรงคือมีอะไรผิด
 * จึงแสดง "ช่วงวันที่คิดดอก" กับ "จำนวนวัน" ไว้ด้วย เพราะนั่นคือจุดที่มักไม่ตรง
 * ไม่ใช่ตัวเลขดอกเบี้ยเอง
 */

import { useEffect, useMemo, useState } from 'react'
import { buildSchedule } from '@engine/schedule.js'
import { groupSchedule, summariseTaxYears, type GroupAxis } from '@engine/grouping.js'
import { findInstallment } from '@engine/rates.js'
import { daysBetween, type ISODate } from '@engine/date.js'
import { toFixed, type Fixed, type Satang } from '@engine/money.js'
import type { PaymentEvent, PaymentKind, ScheduleRow } from '@engine/types.js'
import { Field, NumberField, SelectField, TextField, DateField } from '@/components/Field'
import { SplitBar } from '@/components/SplitBar'
import {
  baht, bahtFixed, bahtRounded, formatAccrualRange, formatDuration, formatMonthSpan,
  formatThaiDate, pct,
} from '@/lib/format'
import { downloadCsv, paymentsCsv, reportName, scheduleCsv, yearSummaryCsv } from '@/lib/export'
import { downloadHtml, loanReportHtml } from '@/lib/report'
import {
  addPayment, closeLoan, getLoanFull, getMarginalTaxRateBps, getPlan, removePayment,
  reopenLoan, setScheduleOverride, toLoanTerms,
  toPaymentEvents, updatePayment,
  type LoanFull, type LoanListItem, type StoredPayment,
} from '@/lib/db'
import {
  CLOSING_REASONS, CLOSING_REASON_LABELS, rowsUntilClose, validateClose,
  type ClosingReason,
} from '@/lib/closing'
import type { PrepayPlan } from '@engine/prepay.js'
import { isoDate } from '@engine/date.js'
import { todayISO } from './model'
import { balanceOn, prepayOfRow, settledPeriods } from '@/lib/progress'
import { BankMark } from '@/components/BankMark'

const FIXED = 1_000_000_000_000n

export function LoanDetail({
  item,
  onBack,
  onPlanPrepay,
  onReconcile,
  onEdit,
  onClosedChanged,
  otherLoans = [],
  allLoans = [],
}: {
  item: LoanListItem
  /**
   * สัญญาทั้งหมดของคนเดียวกัน ใช้ผูกโซ่รีไฟแนนซ์ตอนปิดสัญญา
   * และใช้บอกว่าสัญญาที่ปิดไปแล้วถูกแทนด้วยหลังไหน
   */
  allLoans?: readonly LoanListItem[]
  /**
   * สัญญาอื่นของคนเดียวกัน ใช้คิดเพดานลดหย่อนร่วมในรายงานที่ส่งออก
   * ⛔ เพดาน 100,000 เป็นของ "คน" ไม่ใช่ของ "สัญญา" (ข้อ 1.9)
   */
  otherLoans?: readonly { loanId: string; rows: readonly ScheduleRow[] }[]
  onBack: () => void
  onPlanPrepay: () => void
  onReconcile: () => void
  /** ส่งสัญญาที่โหลดมาแล้วกลับไป จะได้ไม่ต้องยิงซ้ำเพื่อเติมฟอร์ม */
  onEdit: (full: LoanFull) => void
  /** ปิด/เปิดสัญญาแล้ว ต้องให้หน้าแม่โหลดรายการใหม่ ไม่งั้น item ที่ถืออยู่ยังเป็นของเก่า */
  onClosedChanged: () => void
}) {
  const [full, setFull] = useState<LoanFull | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** แผนโปะของสัญญานี้ — null = ยังไม่เคยวางแผน */
  const [prepayPlan, setPrepayPlan] = useState<PrepayPlan | null>(null)
  const [axis, setAxis] = useState<GroupAxis>('contract_year')
  const [reloadKey, setReloadKey] = useState(0)
  /** เปิดแผงยืนยันปิดสัญญาอยู่หรือไม่ — ปิดสัญญาเป็นงานที่ต้องเห็นผลลัพธ์ก่อนกด */
  const [closeOpen, setCloseOpen] = useState(false)

  useEffect(() => {
    let alive = true
    setFull(null)
    getLoanFull(item.loanId)
      .then((f) => alive && setFull(f))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [item.loanId, reloadKey])

  /**
   * โหลดแผนโปะมาใช้เลย ไม่ต้องให้เลือก
   *
   * ⚠️ ต้องโหลดใหม่ทุกครั้งที่ reloadKey ขยับ ไม่งั้นกลับจากหน้าวางแผนโปะ
   *    ตารางยังคิดจากแผนเก่าอยู่ ทั้งที่เพิ่งกดบันทึกไป
   * ⛔ แผนโหลดไม่ได้ต้องไม่ทำให้ทั้งหน้าพัง ตารางที่คิดจากการจ่ายจริงยังถูกต้องอยู่
   */
  useEffect(() => {
    let alive = true
    getPlan(item.loanId)
      .then((p) => alive && setPrepayPlan(p))
      .catch(() => alive && setPrepayPlan(null))
    return () => {
      alive = false
    }
  }, [item.loanId, reloadKey])

  const today = todayISO()
  /** อัตราภาษีที่ผู้ใช้กรอกไว้ — ใช้แสดงมูลค่าภาษีที่ประหยัดได้ในรายงาน */
  const [taxRateBps, setTaxRateBps] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    getMarginalTaxRateBps()
      .then((v) => { if (alive) setTaxRateBps(v) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [])

  const computed = useMemo(() => {
    if (!full) return null
    const terms = toLoanTerms(full)
    // ตารางจากการจ่ายจริง เทียบกับตารางที่ควรเป็นถ้าจ่ายตามสัญญาเป๊ะ ๆ
    const events = toPaymentEvents(full)
    // เลือกแผนไว้ = ทั้งหน้าคิดแบบทำตามแผน ไม่ใช่เฉพาะตาราง
    // ไม่งั้นการ์ดข้างบนกับตารางข้างล่างจะบอกวันปิดหนี้คนละวันบนจอเดียวกัน
    const actual = buildSchedule(terms, events, prepayPlan ?? undefined)
    const plan = buildSchedule(terms)
    return { terms, events, actual, plan }
  }, [full, prepayPlan])

  if (error) {
    return (
      <Wrapper onBack={onBack}>
        <p className="rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-[var(--color-warn)]">
          {error}
        </p>
      </Wrapper>
    )
  }

  if (!full || !computed) {
    return (
      <Wrapper onBack={onBack}>
        <p className="text-[var(--color-ink-2)]">กำลังโหลด…</p>
      </Wrapper>
    )
  }

  const { actual, plan, events, terms } = computed

  const isClosed = item.status === 'closed'
  /**
   * null = ยังผ่อนอยู่ หรือปิดแล้วแต่ไม่มีวันปิดบันทึกไว้
   *
   * ⚠️ แยกจาก isClosed โดยตั้งใจ — ปุ่ม "เปิดสัญญากลับมา" ต้องขึ้นจาก status เท่านั้น
   *    ถ้าผูกกับวันปิด สัญญาที่ status = closed แต่ closed_date หายไป (แก้มือใน DB)
   *    จะกลายเป็นสัญญาที่เปิดกลับไม่ได้เลย ไม่มีทางออกนอกจากลบทิ้งทั้งประวัติ
   */
  const closedDate = isClosed ? item.closedDate : null
  /**
   * ⛔ งวดหลังวันปิดไม่เกิดขึ้นจริง ต้องตัดก่อนเอาไปคิดสรุปรายปี สรุปภาษี และรายงาน
   *    ไม่งั้นสัญญาที่รีไฟแนนซ์ไปแล้วจะยังกินเพดานลดหย่อนของปีหน้าอยู่
   */
  const rows = rowsUntilClose(actual.rows, closedDate)
  /** "ตอนนี้" ของสัญญานี้ — สัญญาที่ปิดแล้วหยุดอยู่ที่วันปิด ไม่เดินต่อถึงวันนี้ */
  const asOf = closedDate ?? today
  /** สัญญาใหม่ที่มารับช่วงต่อ — ลิงก์เก็บไว้ฝั่งสัญญาใหม่ ต้องหาย้อนกลับมา */
  const supersededBy = allLoans.find((l) => l.supersedesLoanId === item.loanId) ?? null

  /**
   * ค่างวดตามสัญญาของงวดที่วันนั้นตกอยู่
   *
   * อ่านจากตารางตามสัญญา ไม่ใช่ตารางจริง — ตารางจริงถูกยอดที่บันทึกไว้ทับไปแล้ว
   * ถามว่า "งวดนี้ควรจ่ายเท่าไหร่" กับตารางที่มีคำตอบเป็นยอดที่จ่ายไปจริง จะได้ตัวเองกลับมา
   */
  const scheduledOn = (d: ISODate): number => {
    const last = plan.rows[plan.rows.length - 1]
    const hit =
      plan.rows.find((r) => d > r.accrualFrom && d <= r.date) ??
      (last && d > last.date ? last : plan.rows[0])
    return Number(findInstallment(terms.installmentSteps, hit?.index ?? 1, terms.installmentSatang)) / 100
  }
  // นับจาก "จ่ายจริงไปแล้วหรือยัง" ด้วย ไม่ใช่รอวันครบกำหนดอย่างเดียว
  const paidPeriods = settledPeriods(rows, events, asOf)
  const balanceNow = balanceOn(rows, events, asOf, item.disbursedSatang)
  const interestPaid = rows
    .slice(0, paidPeriods)
    .reduce((a, r) => (a + r.interestPaidFixed) as Fixed, 0n as Fixed)
  const principalPaid = ((item.disbursedSatang * FIXED) - balanceNow) as Fixed
  const payoff = rows[rows.length - 1]
  const savedPeriods = plan.rows.length - rows.length
  // แถวปีที่ครบอายุสัญญาของตารางตามสัญญา — มีก็ต่อเมื่อตารางนั้นยังไม่จบ
  const contractAtTerm = plan.paidOff
    ? undefined
    : plan.rows.find((r) => r.index === item.termMonths)
  const installmentNext = findInstallment(
    terms.installmentSteps,
    Math.min(paidPeriods + 1, Math.max(1, plan.rows.length)),
    terms.installmentSatang,
  )

  return (
    <Wrapper onBack={onBack}>
      <header className="mb-6 flex items-start gap-3">
        <BankMark code={item.bankCode} name={item.bankLabel} size={36} />
        <div className="min-w-0">
          <h1 className="text-hero">{item.propertyName}</h1>
          <p className="mt-1 text-meta text-[var(--color-ink-2)]">
            {item.bankLabel} · ทำสัญญา {formatThaiDate(item.contractDate, 'long')} ·{' '}
            {formatDuration(item.termMonths)}
          </p>
        </div>
      </header>

      {isClosed && (
        <ClosedBanner
          closedDate={item.closedDate}
          reason={item.closingReason}
          supersededBy={supersededBy}
          onReopened={onClosedChanged}
          loanId={item.loanId}
        />
      )}

      {full.conventionAssumed && (
        <p className="mb-4 rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-meta text-[var(--color-warn)]">
          ⚠️ วิธีนับวันและการปัดเศษยังเป็นค่าสมมติ ตัวเลขอาจต่างจากใบแจ้งยอดเล็กน้อย —
          เอาใบแจ้งยอด 1 ใบมาเทียบแล้วยืนยันได้
        </p>
      )}

      {/* ⚠️ สัญญาที่จ่ายตามค่างวดแล้วไม่มีวันปิดหนี้ เกือบทั้งหมดคือข้อมูลที่กรอกผิด
          ไม่ใช่สัญญาจริง — ธนาคารเขียนสัญญาแบบนั้นไม่ได้
          ต้องเตือนที่หน้าสัญญา ไม่ใช่ให้ไปเจอตอนวางแผนโปะ
          และต้องบอกว่าไปตรวจช่องไหน ไม่ใช่แค่บอกว่าผิด */}
      {/* สัญญาที่ปิดไปแล้วไม่ต้องเตือนเรื่องอนาคตที่ไม่มีวันมาถึง */}
      {!plan.paidOff && !isClosed && (
        <p className="mb-4 rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-meta text-[var(--color-warn)]">
          ⚠️ ค่างวดที่กรอกไว้ไม่พอจ่ายดอกเบี้ยหลังพ้นโปร จ่ายตามนี้อย่างเดียวหนี้จะไม่มีวันหมด
          {contractAtTerm && (
            <>
              {' '}— ครบ {formatDuration(item.termMonths)} แล้วยังเหลือหนี้{' '}
              {bahtRounded(contractAtTerm.balanceAfterFixed)} เพราะดอกเบี้ยงวดละ{' '}
              {bahtRounded(contractAtTerm.interestFixed)} มากกว่าค่างวด{' '}
              {baht(installmentNext, 0)}
            </>
          )}
          {' '}ลองตรวจช่อง &quot;ค่างวดหลังพ้นโปร&quot; กับอัตราลอยตัวอีกครั้ง
          ธนาคารมักขึ้นค่างวดหลังหมดโปร ถ้าปล่อยว่างไว้ระบบจะใช้ค่างวดเดิมยาวทั้งสัญญา
        </p>
      )}

      {actual.totalCapitalisedFixed > 0n && (
        <p className="mb-4 rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-meta text-[var(--color-warn)]">
          ⚠️ มีงวดที่จ่ายไม่พอดอกเบี้ย ดอกที่เหลือถูกทบเข้าเงินต้นรวม{' '}
          {bahtRounded(actual.totalCapitalisedFixed)} บาท
        </p>
      )}

      {/* ---------- สรุป ---------- */}
      <section className="rounded-lg bg-[var(--color-panel)] p-5 text-[var(--color-panel-ink)]">
        <p className="text-meta text-[var(--color-panel-ink-2)]">
          {isClosed ? 'ยอดที่เหลือตอนปิดสัญญา' : 'ยอดคงเหลือวันนี้'}
        </p>
        <p className="mt-1 num text-hero">{bahtRounded(balanceNow)}</p>

        <SplitBar
          className="mt-4"
          interest={balanceNow}
          principal={principalPaid}
          height={10}
          onPanel
        />
        <p className="mt-1 text-micro text-[var(--color-panel-ink-3)]">
          {isClosed
            ? `ตัดเงินต้นไปได้เอง ${bahtRounded(principalPaid)} · ปิดยอดที่เหลือ ${bahtRounded(balanceNow)}`
            : `เป็นของเราแล้ว ${bahtRounded(principalPaid)} · ยังเป็นหนี้ ${bahtRounded(balanceNow)}`}
        </p>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1 text-meta sm:grid-cols-3">
          <PanelRow k="ผ่อนมาแล้ว" v={`${paidPeriods} งวด`} />
          <PanelRow k="ดอกเบี้ยที่จ่ายไป" v={bahtRounded(interestPaid)} />
          {/* ค่างวดของงวดที่กำลังจะถึง ไม่ใช่ค่างวดตั้งต้นของสัญญา
              สัญญาที่ค่างวดต่างกันตามช่วง ค่าตั้งต้นจะเป็นของปีแรกตลอดไป ซึ่งผิดตั้งแต่พ้นโปร */}
          {!isClosed && <PanelRow k="ค่างวดงวดถัดไป" v={baht(installmentNext, 0)} />}
          <PanelRow
            k={isClosed ? 'วันปิดสัญญา' : 'ปิดหนี้'}
            v={
              isClosed
                ? closedDate !== null
                  ? formatThaiDate(closedDate, 'long')
                  : 'ไม่ได้ระบุ'
                : payoff
                  ? formatThaiDate(payoff.date, 'monthYear')
                  : '—'
            }
          />
          <PanelRow k="ผ่อนทั้งหมด" v={formatDuration(rows.length)} />
          {isClosed ? (
            /* เทียบกับอายุสัญญาที่เซ็นไว้ ไม่ใช่กับแผนฐาน — คนที่รีไฟแนนซ์อยากรู้ว่า
               อยู่กับแบงก์เก่าไปกี่งวดจากกี่งวด ไม่ใช่ว่า "เร็วกว่าแผน" ซึ่งไม่จริง
               เพราะหนี้ที่เหลือถูกย้ายไปสัญญาใหม่ ไม่ได้หายไป */
            <PanelRow
              k="จากอายุสัญญา"
              v={`${rows.length} จาก ${item.termMonths} งวด`}
            />
          ) : (
            <PanelRow
              k="เทียบกับจ่ายตามสัญญา"
              /* ⚠️ แผนฐานชนเพดานจำนวนงวด = จ่ายตามสัญญาแล้วไม่มีวันปิดหนี้
                 ผลต่างจะกลายเป็น "เร็วขึ้น 73 ปี" ซึ่งเทียบกับเพดาน ไม่ใช่กับความจริง */
              v={
                !plan.paidOff
                  ? 'จ่ายตามสัญญาอย่างเดียวไม่มีวันปิดหนี้'
                  : savedPeriods > 0
                    ? `เร็วขึ้น ${formatDuration(savedPeriods)}`
                    : 'ตามแผน'
              }
            />
          )}
        </dl>
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        {/* วางแผนโปะสัญญาที่ปิดไปแล้วไม่มีความหมาย — ไม่เหลืออะไรให้โปะ */}
        {!isClosed && (
          <button
            onClick={onPlanPrepay}
            className="tap rounded-md bg-[var(--color-principal)] px-4 py-2.5 text-[var(--color-ink)]"
          >
            วางแผนโปะ →
          </button>
        )}
        <button
          onClick={onReconcile}
          className="tap rounded-md border border-[var(--color-rule)] px-4 py-2.5"
        >
          กระทบยอดกับใบแจ้งยอด →
        </button>
        <button
          onClick={() => onEdit(full)}
          className="tap rounded-md border border-[var(--color-rule)] px-4 py-2.5"
        >
          แก้ไขสัญญา
        </button>
        {/* รายงานอ่านเอง ส่วน CSV มีไว้เอาไปคำนวณต่อ — คนละงานกัน ต้องมีทั้งคู่ */}
        <button
          title="ไฟล์เดียวจบ มีตัวเลขสรุป กราฟ สรุปรายปี และตารางผ่อนครบ เปิดด้วยเบราว์เซอร์แล้วสั่งพิมพ์เป็น PDF ได้"
          onClick={() =>
            downloadHtml(
              reportName(item.propertyName, 'report', today),
              loanReportHtml({
                propertyName: item.propertyName,
                bankLabel: item.bankLabel,
                contractDate: item.contractDate,
                disbursedSatang: item.disbursedSatang,
                installmentSatang: item.installmentSatang,
                rows,
                groups: groupSchedule(rows, 'contract_year'),
                groupsCalendar: groupSchedule(rows, 'calendar_year'),
                taxYears: summariseTaxYears([
                  { loanId: item.loanId, rows },
                  ...otherLoans,
                ]),
                marginalTaxRateBps: taxRateBps,
                payments: full.payments,
                scheduledOf: (period) =>
                  toFixed(findInstallment(terms.installmentSteps, period, terms.installmentSatang)),
                settled: paidPeriods,
                today,
                closed:
                  closedDate !== null
                    ? { date: closedDate, reason: item.closingReason }
                    : null,
              }),
            )
          }
          className="tap rounded-md border border-[var(--color-rule)] px-4 py-2.5"
        >
          รายงานฉบับเต็ม
        </button>
        <button
          onClick={() =>
            downloadCsv(reportName(item.propertyName, 'schedule', today), scheduleCsv(rows))
          }
          className="tap rounded-md border border-[var(--color-rule)] px-4 py-2.5"
        >
          ตารางผ่อน (CSV)
        </button>
        <button
          onClick={() =>
            downloadCsv(
              reportName(item.propertyName, 'yearly', today),
              yearSummaryCsv(groupSchedule(rows, axis)),
            )
          }
          className="tap rounded-md border border-[var(--color-rule)] px-4 py-2.5"
        >
          สรุปรายปี (CSV)
        </button>
        {full.payments.length > 0 && (
          <button
            onClick={() =>
              downloadCsv(
                reportName(item.propertyName, 'payments', today),
                paymentsCsv(full.payments),
              )
            }
            className="tap rounded-md border border-[var(--color-rule)] px-4 py-2.5"
          >
            บันทึกการจ่าย (CSV)
          </button>
        )}
        {!isClosed && (
          <button
            onClick={() => setCloseOpen((v) => !v)}
            className="tap rounded-md border border-[var(--color-rule)] px-4 py-2.5 text-[var(--color-ink-2)] hover:text-[var(--color-warn)]"
          >
            ปิดสัญญา
          </button>
        )}
      </div>

      {closeOpen && !isClosed && (
        <CloseSection
          item={item}
          full={full}
          rows={rows}
          events={events}
          today={today}
          allLoans={allLoans}
          onCancel={() => setCloseOpen(false)}
          onClosed={() => {
            setCloseOpen(false)
            onClosedChanged()
          }}
        />
      )}

      {/* ---------- การจ่าย ---------- */}
      <PaymentSection
        full={full}
        scheduledOn={scheduledOn}
        onChanged={() => setReloadKey((k) => k + 1)}
      />

      {/* ---------- สรุปรายปี ---------- */}
      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between gap-4">
          <h2 className="text-row">สรุปรายปี</h2>
          <div className="w-[220px]">
            <Field label="นับปีแบบ">
              <SelectField
                value={axis}
                onChange={setAxis}
                options={[
                  { value: 'contract_year' as const, label: 'ปีสัญญา (ปีที่ 1, 2, 3…)' },
                  { value: 'calendar_year' as const, label: 'ปีปฏิทิน (สำหรับลดหย่อนภาษี)' },
                ]}
              />
            </Field>
          </div>
        </div>
        <YearTable rows={rows} axis={axis} />
      </section>

      {/* ---------- ตารางผ่อน ---------- */}
      <section className="mt-8">
        <h2 className="mb-1 text-row">ตารางผ่อน</h2>
        <p className="mb-3 text-meta text-[var(--color-ink-2)]">
          ถ้าตัวเลขไม่ตรงใบแจ้งยอด ให้ดู &quot;ช่วงคิดดอก&quot; กับ &quot;วัน&quot; ก่อน —
          ปัญหาเกือบทั้งหมดมาจากวันที่ ไม่ใช่สูตร
        </p>
        {/* ⚠️ สัญญาที่ปิดแล้วไม่มีปุ่ม "วางแผนโปะ" ให้กด ข้อความนี้จะชี้ไปที่ที่ไม่มีอยู่
            และแผนที่เหลือเป็นแผนของงวดที่ถูกตัดทิ้งไปแล้ว ไม่มีผลกับตัวเลขใด ๆ */}
        {prepayPlan !== null && rows.some((r) => r.prepayFixed > 0n) && (
          <p className="mb-3 rounded-md bg-[var(--color-principal-tint)] px-3 py-2 text-meta">
            {isClosed
              ? 'ตารางนี้คิดรวมแผนโปะที่เคยบันทึกไว้ เฉพาะงวดก่อนวันปิดสัญญา — ยอดโปะที่วางไว้หลังวันปิดถูกตัดทิ้งทั้งหมด'
              : 'ตารางนี้กับสรุปรายปีคิดรวมแผนโปะที่บันทึกไว้แล้ว — แก้แผนได้ที่ปุ่ม "วางแผนโปะ" ด้านบน'}
          </p>
        )}
        <ScheduleTable
          rows={rows}
          events={events}
          today={today}
          loanId={item.loanId}
          overrides={full.scheduleOverrides}
          scheduledOf={(period) =>
            toFixed(findInstallment(terms.installmentSteps, period, terms.installmentSatang))
          }
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      </section>
    </Wrapper>
  )
}

function Wrapper({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
      <button
        onClick={onBack}
        className="tap mb-4 text-meta text-[var(--color-interest)] hover:underline"
      >
        ← กลับไปรายการสัญญา
      </button>
      {children}
    </div>
  )
}

function PanelRow({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[var(--color-panel-ink-2)]">{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  )
}

// ---------- ปิดสัญญา ----------

/**
 * ⛔ ปุ่ม "เปิดสัญญากลับมา" ต้องอยู่ตรงนี้เสมอ ไม่ใช่ซ่อนในเมนูแก้ไข
 *    คนที่กดปิดผิดจะมาหาทางแก้ที่หน้านี้ก่อนเป็นอันดับแรก
 *    ถ้าหาไม่เจอ ทางออกที่เหลือคือ "ลบแล้วกรอกใหม่" ซึ่งทำให้ประวัติการจ่ายหายทั้งหมด
 */
function ClosedBanner({
  loanId,
  closedDate,
  reason,
  supersededBy,
  onReopened,
}: {
  loanId: string
  /** null = ปิดแล้วแต่ไม่มีวันปิดบันทึกไว้ — ยังต้องเปิดกลับได้ */
  closedDate: ISODate | null
  reason: ClosingReason | null
  supersededBy: LoanListItem | null
  onReopened: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reopen() {
    setBusy(true)
    setError(null)
    try {
      await reopenLoan(loanId)
      onReopened()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-row">ปิดสัญญาแล้ว</p>
          <p className="mt-1 text-meta text-[var(--color-ink-2)]">
            {closedDate !== null ? formatThaiDate(closedDate, 'long') : 'ไม่ได้ระบุวันปิด'}
            {reason !== null && ` · ${CLOSING_REASON_LABELS[reason]}`}
            {supersededBy !== null &&
              ` · ย้ายไป ${supersededBy.propertyName} (${supersededBy.bankLabel})`}
          </p>
          <p className="mt-1 text-micro text-[var(--color-ink-3)]">
            ตัวเลขทั้งหน้าหยุดอยู่ที่วันปิด งวดหลังจากนั้นไม่ถูกนับในสรุปรายปีและสิทธิลดหย่อน —
            รายการจ่าย แผนโปะ และประวัติทั้งหมดยังอยู่ครบ
          </p>
        </div>
        <button
          onClick={() => void reopen()}
          disabled={busy}
          className="tap shrink-0 rounded-md border border-[var(--color-rule)] px-4 py-2 text-meta disabled:opacity-50"
        >
          {busy ? 'กำลังเปิด…' : 'เปิดสัญญากลับมา'}
        </button>
      </div>
      {error && <p className="mt-2 text-meta text-[var(--color-warn)]">{error}</p>}
    </div>
  )
}

/**
 * แผงยืนยันปิดสัญญา
 *
 * ⛔ ห้ามทำเป็น confirm() บรรทัดเดียว ผลของการปิดคือตัวเลขทั้งหน้าเปลี่ยน
 *    ผู้ใช้ต้องเห็นก่อนว่าปิดแล้วจะเหลืออะไร ไม่ใช่เห็นหลังกด
 * ⚠️ วันปิดเลือกย้อนหลังได้ เพราะคนมักกรอกหลังรีไฟแนนซ์เสร็จไปแล้วหลายวัน
 *    ตัวเลขสรุปจึงต้องคิดใหม่ตามวันที่เลือก ไม่ใช่ตามวันนี้
 */
function CloseSection({
  item,
  full,
  rows,
  events,
  today,
  allLoans,
  onCancel,
  onClosed,
}: {
  item: LoanListItem
  full: LoanFull
  rows: readonly ScheduleRow[]
  events: readonly PaymentEvent[]
  today: ISODate
  allLoans: readonly LoanListItem[]
  onCancel: () => void
  onClosed: () => void
}) {
  const [closedDate, setClosedDate] = useState<ISODate>(today)
  const [reason, setReason] = useState<ClosingReason>('refinanced')
  /** ค่าว่าง = ไม่ผูกกับสัญญาไหน */
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * ⛔ สัญญาที่แทนสัญญาอื่นไปแล้วต้องไม่อยู่ในรายการ
   *    supersedes_loan_id มีช่องเดียว ถ้าเลือกซ้ำจะทับลิงก์เดิมเงียบ ๆ
   *    แล้วโซ่รีไฟแนนซ์ของสัญญาที่ปิดไปก่อนหน้าจะขาดโดยไม่มีใครรู้
   */
  const candidates = allLoans.filter(
    (l) => l.status === 'active' && l.loanId !== item.loanId && l.supersedesLoanId === null,
  )

  const kept = rowsUntilClose(rows, closedDate)
  const periods = settledPeriods(rows, events, closedDate)
  const balanceAtClose = balanceOn(rows, events, closedDate, item.disbursedSatang)
  const interestPaid = rows
    .slice(0, periods)
    .reduce((a, r) => (a + r.interestPaidFixed) as Fixed, 0n as Fixed)
  const dropped = rows.length - kept.length

  /** บันทึกยอดปิดบัญชีไว้แล้วหรือยัง — ถ้ายัง ดอกช่วงสุดท้ายจะขาดไปจากสิทธิลดหย่อนปีนี้ */
  const hasRedemption = full.payments.some(
    (p) => p.kind === 'full_redemption' && p.paidDate <= closedDate,
  )

  const errors = validateClose({
    closedDate,
    firstAccrualDate: isoDate(full.loan.first_accrual_date),
    today,
    payments: full.payments,
  })

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await closeLoan(item.loanId, {
        closedDate,
        reason,
        supersededByLoanId: reason === 'refinanced' && picked !== '' ? picked : null,
      })
      onClosed()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-4">
      <h2 className="text-row">ปิดสัญญานี้</h2>
      <p className="mt-1 text-meta text-[var(--color-ink-2)]">
        ปิดสัญญาไม่ใช่การลบ — ประวัติการจ่าย แผนโปะ และดอกเบี้ยที่ใช้ลดหย่อนไปแล้วยังอยู่ครบ
        และกดเปิดกลับมาได้ทุกเมื่อ
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="วันที่ปิดสัญญา" hint={formatThaiDate(closedDate, 'long')}>
          <DateField value={closedDate} onChange={(v) => setClosedDate(isoDate(v))} />
        </Field>
        <Field label="เหตุผล">
          <SelectField value={reason} onChange={setReason} options={CLOSING_REASONS} />
        </Field>
        {reason === 'refinanced' && candidates.length > 0 && (
          <Field
            label="ย้ายไปสัญญาไหน"
            hint="ผูกไว้เพื่อให้อ่านโซ่รีไฟแนนซ์ย้อนหลังได้ ไม่ผูกก็ปิดได้"
          >
            <SelectField
              value={picked}
              onChange={setPicked}
              options={[
                { value: '', label: 'ยังไม่ผูก / ยังไม่ได้กรอกสัญญาใหม่' },
                ...candidates.map((l) => ({
                  value: l.loanId,
                  label: `${l.propertyName} · ${l.bankLabel}`,
                })),
              ]}
            />
          </Field>
        )}
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-1 border-t border-[var(--color-rule)] pt-3 text-meta sm:grid-cols-2">
        <SumRow k="ผ่อนไปแล้ว" v={`${periods} งวด จาก ${item.termMonths} งวดตามสัญญา`} />
        <SumRow k="ดอกเบี้ยที่จ่ายไปทั้งหมด" v={bahtRounded(interestPaid)} />
        <SumRow k="ยอดที่เหลือ ณ วันปิด" v={bahtRounded(balanceAtClose)} />
        <SumRow
          k="งวดที่จะไม่ถูกนับอีก"
          v={dropped > 0 ? `${dropped} งวด (${formatDuration(dropped)})` : 'ไม่มี'}
        />
      </dl>

      {/* ⚠️ ดอกช่วง "วันตัดงวดล่าสุด → วันปิด" เป็นดอกที่จ่ายจริงและใช้ลดหย่อนได้
          แต่จะไม่มีงวดไหนรองรับถ้าไม่บันทึกยอดปิดบัญชี ต้องบอกตรงนี้
          ไม่ใช่ให้ไปเจอตอนยื่นภาษีแล้วตัวเลขไม่ตรงหนังสือรับรองของธนาคาร */}
      {balanceAtClose > 0n && !hasRedemption && (
        <p className="mt-3 rounded-md bg-[var(--color-principal-tint)] px-3 py-2 text-meta">
          ยังไม่ได้บันทึกยอดปิดบัญชี {bahtRounded(balanceAtClose)} เป็นรายการจ่าย — ปิดสัญญาได้เลย
          แต่ถ้าอยากให้ดอกเบี้ยช่วงสุดท้าย (ตั้งแต่วันตัดงวดล่าสุดถึงวันปิด)
          เข้าสรุปรายปีและสิทธิลดหย่อนของปีนี้ด้วย ให้บันทึกรายการจ่ายประเภท
          &quot;ปิดบัญชี&quot; ที่หัวข้อด้านล่างก่อน
        </p>
      )}

      {errors.map((e) => (
        <p key={e} className="mt-2 text-meta text-[var(--color-warn)]">
          {e}
        </p>
      ))}
      {error && <p className="mt-2 text-meta text-[var(--color-warn)]">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => void submit()}
          disabled={busy || errors.length > 0}
          className="tap rounded-md bg-[var(--color-interest)] px-4 py-2 text-[var(--color-panel-ink)] disabled:opacity-50"
        >
          {busy ? 'กำลังปิด…' : 'ยืนยันปิดสัญญา'}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="tap text-meta text-[var(--color-ink-3)] hover:underline"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  )
}

function SumRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-[var(--color-ink-2)]">{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  )
}

// ---------- การจ่าย ----------

/**
 * ประเภทเป็นตัวบอกว่า "ธนาคารเอาเงินก้อนนี้ไปทำอะไร" ไม่ใช่ว่าเราตั้งใจอะไร
 *
 * เครื่องคิดคนละแบบ ณ วันที่โอน:
 *   'installment'    ตัดดอกที่ค้างถึงวันนั้นก่อน ที่เหลือจึงเข้าเงินต้น
 *   'partial_prepay' ตัดเงินต้นเต็มจำนวน ไม่หักดอกก่อน
 *
 * ⚠️ แต่ละธนาคารไม่เหมือนกัน และบางแห่งไม่เหมือนกันระหว่างช่องทางโอนด้วย
 *    ดูสลิปเป็นหลัก ถ้ามีบรรทัด "ยอดดอกเบี้ยที่ชำระ" มากกว่า 0 แปลว่าโดนหักดอกก่อน
 *    ต่อให้เราเรียกมันว่าโปะก็ต้องลงเป็น 'installment'
 *
 * ⛔ โอนรวมค่างวดกับเงินโปะมาก้อนเดียวให้ลงรายการเดียวเป็น 'installment'
 *    บันทึกซ้ำสองรายการจะตัดหนี้เกินจริง
 */
const KIND_HINTS: Record<PaymentKind | 'fee', string> = {
  installment:
    'ตัดดอกที่ค้างถึงวันที่โอนก่อน ที่เหลือเข้าเงินต้น — สลิปมีช่อง "ยอดดอกเบี้ยที่ชำระ" ให้เลือกอันนี้ แม้จะโอนเกินค่างวด',
  partial_prepay:
    'ตัดเงินต้นเต็มจำนวน ไม่หักดอกก่อน — ใช้เมื่อแจ้งธนาคารว่าชำระเพื่อลดเงินต้น และสลิปลงเป็นเงินต้นทั้งก้อน',
  full_redemption: 'ยอดปิดหนี้ทั้งก้อน ตารางจะจบที่งวดนี้',
  fee: 'เช่น ค่าประเมิน ค่าจดจำนอง ไม่ถูกนำไปตัดหนี้',
}

const KIND_LABELS: readonly { value: PaymentKind | 'fee'; label: string }[] = [
  { value: 'installment', label: 'ค่างวดปกติ' },
  { value: 'partial_prepay', label: 'โปะบางส่วน' },
  { value: 'full_redemption', label: 'ปิดบัญชี' },
  { value: 'fee', label: 'ค่าธรรมเนียม (ไม่ตัดหนี้)' },
]

function PaymentSection({
  full,
  scheduledOn,
  onChanged,
}: {
  full: LoanFull
  /** ค่างวดตามสัญญา (บาท) ของงวดที่วันนั้นตกอยู่ — ใช้บอกผู้ใช้ว่าส่วนไหนคือเงินโปะ */
  scheduledOn: (d: ISODate) => number
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  /** null = กำลังเพิ่มรายการใหม่ ไม่ใช่แก้ของเดิม */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [paidDate, setPaidDate] = useState<ISODate>(todayISO())
  const [amount, setAmount] = useState<number | ''>(
    Number(full.loan.installment_satang) / 100,
  )
  const [kind, setKind] = useState<PaymentKind | 'fee'>('installment')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** ค่างวดตามสัญญาของงวดที่วันที่จ่ายนี้ตกอยู่ — ส่วนที่เกินคือเงินโปะ */
  const overDue = scheduledOn(paidDate)

  function startAdd() {
    setEditingId(null)
    setPaidDate(todayISO())
    setAmount(Number(full.loan.installment_satang) / 100)
    setKind('installment')
    setNote('')
    setError(null)
    setOpen(true)
  }

  function startEdit(p: StoredPayment) {
    setEditingId(p.id)
    setPaidDate(p.paidDate)
    setAmount(Number(p.amountSatang) / 100)
    setKind(p.kind)
    setNote(p.note ?? '')
    setError(null)
    setOpen(true)
  }

  async function submit() {
    if (typeof amount !== 'number' || amount <= 0) return setError('กรอกจำนวนเงินที่จ่าย')
    setBusy(true)
    setError(null)
    const body = {
      paidDate,
      amountSatang: BigInt(Math.round(amount * 100)) as Satang,
      kind,
      ...(note.trim() !== '' ? { note: note.trim() } : {}),
    }
    try {
      if (editingId === null) await addPayment(full.loan.id, body)
      else await updatePayment(editingId, body)
      setNote('')
      setEditingId(null)
      setOpen(false)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function drop(id: string) {
    setBusy(true)
    try {
      await removePayment(id)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-row">การจ่ายที่บันทึกไว้ ({full.payments.length})</h2>
        <button
          onClick={() => (open ? setOpen(false) : startAdd())}
          className="tap text-meta text-[var(--color-interest)] hover:underline"
        >
          {open ? 'ปิด' : '+ บันทึกการจ่าย'}
        </button>
      </div>

      {open && (
        <div className="mb-4 rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="วันที่จ่าย" hint={formatThaiDate(paidDate, 'long')}>
              <DateField value={paidDate} onChange={(v) => setPaidDate(isoDate(v))} />
            </Field>
            <Field label="จำนวนเงิน" suffix="บาท">
              <NumberField value={amount} onChange={setAmount} />
            </Field>
            <Field label="ประเภท" hint={KIND_HINTS[kind]}>
              <SelectField value={kind} onChange={setKind} options={KIND_LABELS} />
            </Field>
            <Field label="หมายเหตุ">
              <TextField value={note} onChange={setNote} placeholder="เช่น โบนัสกลางปี" />
            </Field>
          </div>

          {/* ⚠️ เงินโปะที่โอนรวมมากับค่างวดเป็นยอดเดียว ไม่ต้องแยกบันทึกอีกรายการ
              ส่วนที่เกินค่างวดถูกตัดเงินต้นให้อยู่แล้ว แต่ไม่มีอะไรบนจอบอกผู้ใช้
              จึงต้องยืนยันตรงนี้ ไม่งั้นผู้ใช้จะบันทึก "โปะบางส่วน" ซ้ำแล้วยอดหนี้หายไปสองเท่า */}
          {kind === 'installment' && typeof amount === 'number' && amount > overDue && (
            <p className="mt-3 text-meta text-[var(--color-principal-dark)]">
              เกินค่างวด {Math.round(amount - overDue).toLocaleString('en-US')} บาท —
              ส่วนนี้ตัดเงินต้นให้อัตโนมัติ ไม่ต้องบันทึกเป็น &quot;โปะบางส่วน&quot; ซ้ำอีกรายการ
            </p>
          )}

          {error && (
            <p className="mt-3 text-meta text-[var(--color-warn)]">{error}</p>
          )}

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => void submit()}
              disabled={busy}
              className="tap rounded-md bg-[var(--color-interest)] px-4 py-2 text-[var(--color-panel-ink)] disabled:opacity-50"
            >
              {busy ? 'กำลังบันทึก…' : editingId === null ? 'บันทึก' : 'บันทึกการแก้ไข'}
            </button>
            {editingId !== null && (
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="tap text-meta text-[var(--color-ink-3)] hover:underline"
              >
                ยกเลิก
              </button>
            )}
          </div>
        </div>
      )}

      {full.payments.length === 0 ? (
        <p className="text-meta text-[var(--color-ink-2)]">
          ยังไม่มีการจ่ายที่บันทึกไว้ — ตารางด้านล่างคิดจากค่างวดตามสัญญา
          พอบันทึกการจ่ายจริงแล้วตารางจะปรับตาม
        </p>
      ) : (
        /* รายการยาวได้ไม่จำกัด ถ้าปล่อยไหลจะดันตารางผ่อนหลุดจอไปเรื่อย ๆ
           กันความสูงไว้แล้วให้เลื่อนในกล่องตัวเอง */
        <ul
          className={`divide-y divide-[var(--color-rule)] ${
            full.payments.length > 6
              ? 'max-h-[19rem] overflow-y-auto rounded-md border border-[var(--color-rule)] px-3'
              : ''
          }`}
        >
          {/* ใหม่สุดอยู่บน — รายการที่เพิ่งบันทึกคือสิ่งที่ผู้ใช้กำลังตรวจ
              ห้าม sort ทับ full.payments เพราะ engine ต้องได้ลำดับตามเวลา */}
          {[...full.payments]
            .sort((a, b) => (a.paidDate < b.paidDate ? 1 : a.paidDate > b.paidDate ? -1 : 0))
            .map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-4 py-2">
              <span className="text-meta">
                {formatThaiDate(p.paidDate)} ·{' '}
                {KIND_LABELS.find((k) => k.value === p.kind)?.label ?? p.kind}
                {p.note && <span className="text-[var(--color-ink-3)]"> · {p.note}</span>}
              </span>
              <span className="flex items-center gap-3">
                <span className="num">{baht(p.amountSatang)}</span>
                <button
                  onClick={() => startEdit(p)}
                  disabled={busy}
                  className={`tap text-meta hover:underline ${
                    editingId === p.id
                      ? 'font-medium text-[var(--color-interest)]'
                      : 'text-[var(--color-interest)]'
                  }`}
                >
                  แก้ไข
                </button>
                {/* ⛔ ไม่ลบจริง — ประวัติการจ่ายต้องตามรอยได้ ใช้ soft delete */}
                <button
                  onClick={() => void drop(p.id)}
                  disabled={busy}
                  className="tap text-meta text-[var(--color-ink-3)] hover:text-[var(--color-warn)]"
                >
                  ลบ
                </button>
              </span>
            </li>
            ))}
        </ul>
      )}
    </section>
  )
}

// ---------- ตาราง ----------

function YearTable({ rows, axis }: { rows: readonly ScheduleRow[]; axis: GroupAxis }) {
  const groups = useMemo(() => groupSchedule(rows, axis), [rows, axis])

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-row">
        <thead>
          <tr className="border-b border-[var(--color-rule)] text-left">
            <th className="py-2 pr-4 text-meta font-medium text-[var(--color-ink-2)]">
              ปี
            </th>
            <ThRight>งวด</ThRight>
            <ThRight>ดอกเบี้ย</ThRight>
            <ThRight>เงินต้น</ThRight>
            {/* เงินที่ออกจากบัญชีจริงทั้งปี = ดอกเบี้ย + เงินต้น (รวมยอดที่โปะแล้ว)
                มีใน CSV มาตั้งแต่แรกแต่ไม่เคยโชว์บนจอ */}
            <ThRight title="ดอกเบี้ย + เงินต้น รวมยอดที่โปะด้วย">ยอดจ่ายจริง</ThRight>
            <ThRight title="ถ่วงน้ำหนักด้วยยอดหนี้และจำนวนวัน ไม่ใช่ค่าเฉลี่ยเลขคณิต">
              อัตราที่จ่ายจริง
            </ThRight>
            <ThRight>คงเหลือสิ้นปี</ThRight>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key} className="border-b border-[var(--color-rule)]">
              <td className="py-2 pr-4">
                <span className="whitespace-nowrap">
                  {g.label}
                  {/* ปีแรกกับปีสุดท้ายมักไม่ครบ 12 งวด ถ้าไม่ติดป้ายจะเอาไปเทียบกับปีเต็มแล้วสรุปผิด */}
                  {g.isPartialYear && (
                    <span className="ml-2 text-micro text-[var(--color-ink-3)]">
                      ไม่ครบปี
                    </span>
                  )}
                </span>
                {/* ปีสัญญาไม่ตรงปีปฏิทิน ถ้าไม่บอกเดือนต้องกางปฏิทินในหัวเอง */}
                <span className="block text-micro whitespace-nowrap text-[var(--color-ink-3)]">
                  {formatMonthSpan(g.rows[0]!.date, g.rows[g.rows.length - 1]!.date)}
                </span>
              </td>
              <TdRight>{g.periodCount}</TdRight>
              <TdRight>{bahtRounded(g.interestFixed)}</TdRight>
              <TdRight>{bahtRounded(g.principalFixed)}</TdRight>
              <TdRight>
                <span className="font-medium">{bahtRounded(g.paymentFixed)}</span>
              </TdRight>
              <TdRight>{pct(g.effectiveRateBps)}</TdRight>
              <TdRight>{bahtRounded(g.closingBalanceFixed)}</TdRight>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const FLAG_LABELS: Record<string, string> = {
  actual_payment: 'ยอดจริง',
  negative_amortization: 'จ่ายไม่พอดอก',
  below_minimum: 'ต่ำกว่าขั้นต่ำ',
  rate_changed: 'เรตเปลี่ยน',
  prepay: 'มีโปะ',
  final_payment: 'งวดสุดท้าย',
  date_overridden: 'แก้วันตัด',
  early_payment: 'จ่ายก่อนวันตัด',
  convention_changed: 'เปลี่ยนวิธีคิด',
}

function ScheduleTable({
  rows,
  events,
  today,
  loanId,
  overrides,
  scheduledOf,
  onChanged,
}: {
  rows: readonly ScheduleRow[]
  events: readonly PaymentEvent[]
  today: ISODate
  loanId: string
  overrides: Readonly<Record<number, ISODate>>
  /** ค่างวดตามสัญญาของงวดนั้น ใช้แยกว่าส่วนไหนของยอดที่จ่ายคือเงินโปะ */
  scheduledOf: (period: number) => Fixed
  onChanged: () => void
}) {
  /** งวดที่กำลังแก้วันตัด — null = ไม่ได้แก้อะไรอยู่ */
  const [editDate, setEditDate] = useState<{ period: number; value: ISODate } | null>(null)
  const [dateBusy, setDateBusy] = useState(false)
  const [dateError, setDateError] = useState<string | null>(null)

  async function saveDate(period: number, value: ISODate | null) {
    // ⛔ ต้องอยู่หลังวันตัดงวดก่อนหน้า ไม่งั้นช่วงคิดดอกติดลบแล้ว engine จะ throw
    const prev = rows.find((r) => r.index === period - 1)
    if (value !== null && prev && value <= prev.date) {
      setDateError(`ต้องเป็นวันหลัง ${formatThaiDate(prev.date)} ซึ่งเป็นวันตัดงวดก่อนหน้า`)
      return
    }
    setDateBusy(true)
    setDateError(null)
    try {
      await setScheduleOverride(loanId, period, value)
      setEditDate(null)
      onChanged()
    } catch (e) {
      setDateError((e as Error).message)
    } finally {
      setDateBusy(false)
    }
  }
  /* คอลัมน์โปะโผล่เฉพาะตอนมีของให้โชว์ — สัญญาที่ไม่เคยโปะไม่ต้องแบกคอลัมน์ว่าง
     บนจอ 380px ทุกคอลัมน์ที่เพิ่มคือการดันคอลัมน์อื่นออกนอกจอ */
  const prepayAt = (r: ScheduleRow) => prepayOfRow(r, scheduledOf(r.index))
  /**
   * รายการโอนที่ตกอยู่ในงวดนี้ — ช่วง (accrualFrom, date] ช่วงเดียวกับที่ engine ใช้
   *
   * ⚠️ ต้องโชว์เมื่อไม่ได้โอนก้อนเดียวตรงวันตัด ไม่งั้นแถวบอกแค่ยอดรวม
   *    เงินที่ตั้งใจโปะของเดือนก่อนแต่โอนหลังวันตัดไปแล้ว จะไปโผล่ในแถวเดือนถัดไป
   *    โดยไม่มีอะไรบนจออธิบาย ผู้ใช้จะนึกว่าแอพจับยอดผิดงวด
   */
  const paymentsIn = (r: ScheduleRow) =>
    events.filter((e) => e.date > r.accrualFrom && e.date <= r.date)
  const showPrepay = rows.some((r) => prepayAt(r) > 0n)
  const [showAll, setShowAll] = useState(false)
  // ใช้เกณฑ์เดียวกับการ์ดด้านบน ไม่งั้นแถวที่ไฮไลต์กับยอดคงเหลือชี้คนละงวด
  const currentIndex = settledPeriods(rows, events, today)
  // ค่าตั้งต้นโชว์รอบ ๆ งวดปัจจุบัน ไม่ใช่ 360 แถวรวดเดียว
  const view = showAll
    ? rows
    : rows.slice(Math.max(0, currentIndex - 6), currentIndex + 6)

  return (
    <>
      {editDate !== null && (
        <div className="mb-3 rounded-lg border border-[var(--color-interest)] bg-[var(--color-paper-raised)] p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px]">
              <Field
                label={`วันตัดงวดที่ ${editDate.period}`}
                hint={formatThaiDate(editDate.value, 'long')}
              >
                <DateField
                  value={editDate.value}
                  onChange={(v) => setEditDate({ ...editDate, value: isoDate(v) })}
                />
              </Field>
            </div>
            <button
              onClick={() => void saveDate(editDate.period, editDate.value)}
              disabled={dateBusy}
              className="tap rounded-md bg-[var(--color-interest)] px-4 py-2 text-meta text-[var(--color-panel-ink)] disabled:opacity-50"
            >
              {dateBusy ? 'กำลังบันทึก…' : 'ใช้วันนี้'}
            </button>
            {overrides[editDate.period] !== undefined && (
              <button
                onClick={() => void saveDate(editDate.period, null)}
                disabled={dateBusy}
                className="tap text-meta text-[var(--color-ink-2)] hover:underline disabled:opacity-50"
              >
                คืนค่าตามกฎ
              </button>
            )}
            <button
              onClick={() => setEditDate(null)}
              className="tap text-meta text-[var(--color-ink-3)] hover:underline"
            >
              ยกเลิก
            </button>
          </div>
          <p className="mt-2 text-micro text-[var(--color-ink-3)]">
            เปลี่ยนวันตัดจะเปลี่ยนจำนวนวันคิดดอกของงวดนี้และงวดถัดไป —
            ใช้เมื่อใบแจ้งยอดตัดคนละวันกับที่ระบบคำนวณ
          </p>
          {dateError && (
            <p className="mt-2 text-meta text-[var(--color-warn)]">{dateError}</p>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-meta">
          {/* เรียงคอลัมน์ตามที่คนติดตามสินเชื่อใน Excel คุ้นเคย
              งวด → เดือน → อัตรา → ต้น → ดอก → ยอดชำระ → คงเหลือ
              คอลัมน์วันที่/จำนวนวันเป็นของไว้ไล่หาสาเหตุตอนกระทบยอด จึงย้ายไปท้าย */}
          <thead>
            <tr className="border-b border-[var(--color-rule)] text-left">
              <ThRight>งวด</ThRight>
              <th className="py-2 pr-4 font-medium text-[var(--color-ink-2)]">เดือน</th>
              <ThRight>อัตรา</ThRight>
              <ThRight>ชำระเงินต้น</ThRight>
              <ThRight>ชำระดอกเบี้ย</ThRight>
              {showPrepay && <ThRight>โปะ</ThRight>}
              <ThRight>ยอดชำระ</ThRight>
              <ThRight>ยอดหนี้คงเหลือ</ThRight>
              <th className="py-2 pr-4 font-medium text-[var(--color-ink-2)]">ช่วงคิดดอก</th>
              <ThRight>วัน</ThRight>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => {
              const isActual = r.flags.includes('actual_payment')
              // งวดที่ผ่านไปแล้วและไม่มีบันทึก ไม่ใช่ "คาด" — เป็นข้อเท็จจริงว่าไม่ได้จ่าย
              const noRecord = r.flags.includes('no_payment_recorded')
              // โอนก้อนเดียวตรงวันตัดคือกรณีปกติ ไม่ต้องอธิบายอะไรเพิ่ม
              const paid = paymentsIn(r)
              const paidDetail =
                paid.length === 0 || (paid.length === 1 && paid[0]!.date === r.date)
                  ? null
                  : paid
                      .map((e) => `${formatThaiDate(e.date, 'dayMonth')} ${baht(e.amountSatang, 0)}`)
                      .join(' · ')
              // 'prepay' ไม่ต้องติดป้าย — คอลัมน์โปะบอกยอดอยู่แล้ว ป้ายซ้ำเปลืองที่บนจอแคบ
              const otherFlags = r.flags.filter(
                (f) => f !== 'actual_payment' && f !== 'no_payment_recorded' && f !== 'prepay',
              )
              return (
                <tr
                  key={r.index}
                  className={`border-b border-[var(--color-rule)] ${
                    r.index === currentIndex ? 'bg-[var(--color-principal-tint)]' : ''
                  }`}
                >
                  <TdRight>{r.index}</TdRight>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {/* แก้วันตัดได้ทีละงวด — กฎอัตโนมัติไม่มีวันครอบคลุมทุกธนาคาร */}
                    <button
                      onClick={() => {
                        setDateError(null)
                        setEditDate({ period: r.index, value: r.date })
                      }}
                      title={`วันตัดจริง ${formatThaiDate(r.date)} — กดเพื่อแก้`}
                      className="tap hover:underline"
                    >
                      {formatThaiDate(r.date, 'monthYear')}
                    </button>
                    {overrides[r.index] !== undefined ? (
                      <span
                        className="ml-1 text-[var(--color-interest)]"
                        title={`แก้เองเป็น ${formatThaiDate(r.date)} ตามกฎคือ ${formatThaiDate(r.nominalDate)}`}
                      >
                        ✎
                      </span>
                    ) : (
                      r.date !== r.nominalDate && (
                        <span
                          className="ml-1 text-[var(--color-ink-3)]"
                          title={`ตัดจริง ${formatThaiDate(r.date)} ตามกฎคือ ${formatThaiDate(r.nominalDate)}`}
                        >
                          *
                        </span>
                      )
                    )}
                  </td>
                  <TdRight>{pct(r.effectiveRateBps)}</TdRight>
                  <TdRight>{bahtFixed(r.principalFixed)}</TdRight>
                  <TdRight>{bahtFixed(r.interestFixed)}</TdRight>
                  {showPrepay && (
                    <TdRight>
                      {prepayAt(r) > 0n ? (
                        <span className="text-[var(--color-principal-dark)]">
                          {bahtFixed(prepayAt(r))}
                        </span>
                      ) : (
                        <span className="text-[var(--color-ink-3)]">—</span>
                      )}
                    </TdRight>
                  )}
                  <TdRight>
                    <span className={isActual ? 'font-medium' : ''}>
                      {bahtFixed(r.paymentFixed)}
                    </span>
                    {/* แยกให้ชัดว่าแถวไหนมาจากยอดที่บันทึกจริง แถวไหนเป็นประมาณการ */}
                    <span
                      className={`ml-1 text-micro ${
                        isActual
                          ? 'text-[var(--color-ok)]'
                          : noRecord
                            ? 'text-[var(--color-warn)]'
                            : 'text-[var(--color-ink-3)]'
                      }`}
                      title={
                        isActual
                          ? 'ยอดที่บันทึกว่าจ่ายจริง'
                          : noRecord
                            ? 'งวดนี้อยู่ในช่วงที่บันทึกการจ่ายไว้แล้ว แต่ไม่มีรายการของงวดนี้ — ถือว่าไม่ได้จ่าย เช่นงวดแรกที่สั้นมากจนธนาคารไปรวมเก็บกับงวดถัดไป'
                            : 'ประมาณการจากค่างวดตามสัญญา ยังไม่ได้บันทึกยอดจริง'
                      }
                    >
                      {isActual ? 'จริง' : noRecord ? 'ไม่มีบันทึก' : 'คาด'}
                    </span>
                    {paidDetail !== null && (
                      <div
                        className="text-micro font-normal text-[var(--color-ink-3)]"
                        title="รายการโอนที่ตกอยู่ในงวดนี้ — เงินที่โอนหลังวันตัดจะนับเป็นของงวดถัดไป"
                      >
                        {paidDetail}
                      </div>
                    )}
                  </TdRight>
                  <TdRight>
                    {bahtFixed(r.balanceAfterFixed)}
                    {/* ป้ายลงบรรทัดใหม่ใต้ตัวเลข แบบเดียวกับรายการโอนในคอลัมน์ยอดชำระ
                        ต่อท้ายในบรรทัดเดียวกันจะดันตัวเลขให้ไม่ตรงแนวกับแถวอื่น
                        ซึ่งทำให้กวาดตาอ่านยอดคงเหลือทั้งคอลัมน์ไม่ได้ */}
                    {otherFlags.length > 0 && (
                      <div className="text-micro font-normal text-[var(--color-ink-3)]">
                        {otherFlags.map((f) => FLAG_LABELS[f] ?? f).join(' · ')}
                      </div>
                    )}
                  </TdRight>
                  {/* ช่วงคิดดอกคือ (วันตัดงวดก่อน, วันตัดงวดนี้] — วันตัดถูกคิดดอกด้วย (TV-50) */}
                  <td className="py-2 pr-4 whitespace-nowrap text-[var(--color-ink-3)]">
                    {formatAccrualRange(r.accrualFrom, r.date)}
                  </td>
                  <TdRight>{r.accrualDays}</TdRight>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {rows.length > view.length && (
        <button
          onClick={() => setShowAll(true)}
          className="tap mt-3 text-meta text-[var(--color-interest)] hover:underline"
        >
          ดูทั้งหมด {rows.length} งวด
        </button>
      )}
      {showAll && (
        <button
          onClick={() => setShowAll(false)}
          className="tap mt-3 text-meta text-[var(--color-interest)] hover:underline"
        >
          ย่อกลับ
        </button>
      )}
    </>
  )
}

function ThRight({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <th className="py-2 pr-4 text-right font-medium text-[var(--color-ink-2)]" title={title}>
      {children}
    </th>
  )
}

function TdRight({ children }: { children: React.ReactNode }) {
  return <td className="py-2 pr-4 text-right num whitespace-nowrap">{children}</td>
}

/** งวดล่าสุดที่ถึงกำหนดแล้ว — ใช้หายอดคงเหลือ "วันนี้" */

