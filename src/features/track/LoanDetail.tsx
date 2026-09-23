/**
 * หน้าสัญญาเดียว — ตารางผ่อนที่คิดจากการจ่ายจริง
 *
 * แนวคิด: ตารางนี้ต้องตรงกับใบแจ้งยอดธนาคารระดับสตางค์ ถ้าไม่ตรงคือมีอะไรผิด
 * จึงแสดง "ช่วงวันที่คิดดอก" กับ "จำนวนวัน" ไว้ด้วย เพราะนั่นคือจุดที่มักไม่ตรง
 * ไม่ใช่ตัวเลขดอกเบี้ยเอง
 */

import { useEffect, useMemo, useState } from 'react'
import { buildSchedule } from '@engine/schedule.js'
import { groupSchedule, type GroupAxis } from '@engine/grouping.js'
import { addDays, daysBetween, type ISODate } from '@engine/date.js'
import type { Fixed, Satang } from '@engine/money.js'
import type { PaymentEvent, PaymentKind, ScheduleRow } from '@engine/types.js'
import { Field, NumberField, SelectField, TextField, DateField } from '@/components/Field'
import { SplitBar } from '@/components/SplitBar'
import { baht, bahtRounded, formatDuration, formatMonthSpan, formatThaiDate, pct } from '@/lib/format'
import { downloadCsv, paymentsCsv, reportName, scheduleCsv, yearSummaryCsv } from '@/lib/export'
import {
  addPayment, getLoanFull, removePayment, toLoanTerms, toPaymentEvents,
  type LoanFull, type LoanListItem,
} from '@/lib/db'
import { isoDate } from '@engine/date.js'
import { todayISO } from './model'
import { balanceOn, settledPeriods } from '@/lib/progress'

const FIXED = 1_000_000_000_000n

export function LoanDetail({
  item,
  onBack,
  onPlanPrepay,
  onReconcile,
  onEdit,
}: {
  item: LoanListItem
  onBack: () => void
  onPlanPrepay: () => void
  onReconcile: () => void
  /** ส่งสัญญาที่โหลดมาแล้วกลับไป จะได้ไม่ต้องยิงซ้ำเพื่อเติมฟอร์ม */
  onEdit: (full: LoanFull) => void
}) {
  const [full, setFull] = useState<LoanFull | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [axis, setAxis] = useState<GroupAxis>('contract_year')
  const [reloadKey, setReloadKey] = useState(0)

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

  const today = todayISO()

  const computed = useMemo(() => {
    if (!full) return null
    const terms = toLoanTerms(full)
    // ตารางจากการจ่ายจริง เทียบกับตารางที่ควรเป็นถ้าจ่ายตามสัญญาเป๊ะ ๆ
    const events = toPaymentEvents(full)
    const actual = buildSchedule(terms, events)
    const plan = buildSchedule(terms)
    return { terms, events, actual, plan }
  }, [full])

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

  const { actual, plan, events } = computed
  const rows = actual.rows
  // นับจาก "จ่ายจริงไปแล้วหรือยัง" ด้วย ไม่ใช่รอวันครบกำหนดอย่างเดียว
  const paidPeriods = settledPeriods(rows, events, today)
  const balanceNow = balanceOn(rows, events, today, item.disbursedSatang)
  const interestPaid = rows
    .slice(0, paidPeriods)
    .reduce((a, r) => (a + r.interestPaidFixed) as Fixed, 0n as Fixed)
  const principalPaid = ((item.disbursedSatang * FIXED) - balanceNow) as Fixed
  const payoff = rows[rows.length - 1]
  const savedPeriods = plan.rows.length - rows.length

  return (
    <Wrapper onBack={onBack}>
      <header className="mb-6">
        <h1 className="text-hero">{item.propertyName}</h1>
        <p className="mt-1 text-meta text-[var(--color-ink-2)]">
          {item.bankLabel} · ทำสัญญา {formatThaiDate(item.contractDate, 'long')} ·{' '}
          {formatDuration(item.termMonths)}
        </p>
      </header>

      {full.conventionAssumed && (
        <p className="mb-4 rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-meta text-[var(--color-warn)]">
          ⚠️ วิธีนับวันและการปัดเศษยังเป็นค่าสมมติ ตัวเลขอาจต่างจากใบแจ้งยอดเล็กน้อย —
          เอาใบแจ้งยอด 1 ใบมาเทียบแล้วยืนยันได้
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
        <p className="text-meta text-[var(--color-panel-ink-2)]">ยอดคงเหลือวันนี้</p>
        <p className="mt-1 num text-hero">{bahtRounded(balanceNow)}</p>

        <SplitBar
          className="mt-4"
          interest={balanceNow}
          principal={principalPaid}
          height={10}
          onPanel
        />
        <p className="mt-1 text-micro text-[var(--color-panel-ink-3)]">
          เป็นของเราแล้ว {bahtRounded(principalPaid)} · ยังเป็นหนี้ {bahtRounded(balanceNow)}
        </p>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1 text-meta sm:grid-cols-3">
          <PanelRow k="ผ่อนมาแล้ว" v={`${paidPeriods} งวด`} />
          <PanelRow k="ดอกเบี้ยที่จ่ายไป" v={bahtRounded(interestPaid)} />
          <PanelRow k="ค่างวดตามสัญญา" v={baht(item.installmentSatang, 0)} />
          <PanelRow
            k="ปิดหนี้"
            v={payoff ? formatThaiDate(payoff.date, 'monthYear') : '—'}
          />
          <PanelRow k="ผ่อนทั้งหมด" v={formatDuration(rows.length)} />
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
        </dl>
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={onPlanPrepay}
          className="tap rounded-md bg-[var(--color-principal)] px-4 py-2.5 text-[var(--color-ink)]"
        >
          วางแผนโปะ →
        </button>
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
        <button
          onClick={() =>
            downloadCsv(reportName(item.propertyName, 'schedule', today), scheduleCsv(rows))
          }
          className="tap rounded-md border border-[var(--color-rule)] px-4 py-2.5"
        >
          ส่งออกตารางผ่อน
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
          ส่งออกสรุปรายปี
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
            ส่งออกการจ่าย
          </button>
        )}
      </div>

      {/* ---------- การจ่าย ---------- */}
      <PaymentSection
        full={full}
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
        <ScheduleTable rows={rows} events={events} today={today} />
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

// ---------- การจ่าย ----------

const KIND_LABELS: readonly { value: PaymentKind | 'fee'; label: string }[] = [
  { value: 'installment', label: 'ค่างวดปกติ' },
  { value: 'partial_prepay', label: 'โปะบางส่วน' },
  { value: 'full_redemption', label: 'ปิดบัญชี' },
  { value: 'fee', label: 'ค่าธรรมเนียม (ไม่ตัดหนี้)' },
]

function PaymentSection({ full, onChanged }: { full: LoanFull; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [paidDate, setPaidDate] = useState<ISODate>(todayISO())
  const [amount, setAmount] = useState<number | ''>(
    Number(full.loan.installment_satang) / 100,
  )
  const [kind, setKind] = useState<PaymentKind | 'fee'>('installment')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (typeof amount !== 'number' || amount <= 0) return setError('กรอกจำนวนเงินที่จ่าย')
    setBusy(true)
    setError(null)
    try {
      await addPayment(full.loan.id, {
        paidDate,
        amountSatang: BigInt(Math.round(amount * 100)) as Satang,
        kind,
        ...(note.trim() !== '' ? { note: note.trim() } : {}),
      })
      setNote('')
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
          onClick={() => setOpen(!open)}
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
            <Field label="ประเภท">
              <SelectField value={kind} onChange={setKind} options={KIND_LABELS} />
            </Field>
            <Field label="หมายเหตุ">
              <TextField value={note} onChange={setNote} placeholder="เช่น โบนัสกลางปี" />
            </Field>
          </div>

          {error && (
            <p className="mt-3 text-meta text-[var(--color-warn)]">{error}</p>
          )}

          <button
            onClick={() => void submit()}
            disabled={busy}
            className="tap mt-3 rounded-md bg-[var(--color-interest)] px-4 py-2 text-[var(--color-panel-ink)] disabled:opacity-50"
          >
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      )}

      {full.payments.length === 0 ? (
        <p className="text-meta text-[var(--color-ink-2)]">
          ยังไม่มีการจ่ายที่บันทึกไว้ — ตารางด้านล่างคิดจากค่างวดตามสัญญา
          พอบันทึกการจ่ายจริงแล้วตารางจะปรับตาม
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-rule)]">
          {full.payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-4 py-2">
              <span className="text-meta">
                {formatThaiDate(p.paidDate)} ·{' '}
                {KIND_LABELS.find((k) => k.value === p.kind)?.label ?? p.kind}
                {p.note && <span className="text-[var(--color-ink-3)]"> · {p.note}</span>}
              </span>
              <span className="flex items-center gap-3">
                <span className="num">{baht(p.amountSatang)}</span>
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
      <table className="w-full min-w-[560px] border-collapse text-row">
        <thead>
          <tr className="border-b border-[var(--color-rule)] text-left">
            <th className="py-2 pr-4 text-meta font-medium text-[var(--color-ink-2)]">
              ปี
            </th>
            <ThRight>งวด</ThRight>
            <ThRight>ดอกเบี้ย</ThRight>
            <ThRight>เงินต้น</ThRight>
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
  convention_changed: 'เปลี่ยนวิธีคิด',
}

function ScheduleTable({
  rows,
  events,
  today,
}: {
  rows: readonly ScheduleRow[]
  events: readonly PaymentEvent[]
  today: ISODate
}) {
  const [showAll, setShowAll] = useState(false)
  // ใช้เกณฑ์เดียวกับการ์ดด้านบน ไม่งั้นแถวที่ไฮไลต์กับยอดคงเหลือชี้คนละงวด
  const currentIndex = settledPeriods(rows, events, today)
  // ค่าตั้งต้นโชว์รอบ ๆ งวดปัจจุบัน ไม่ใช่ 360 แถวรวดเดียว
  const view = showAll
    ? rows
    : rows.slice(Math.max(0, currentIndex - 6), currentIndex + 6)

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-meta">
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
              <ThRight>ยอดชำระ</ThRight>
              <ThRight>ยอดหนี้คงเหลือ</ThRight>
              <th className="py-2 pr-4 font-medium text-[var(--color-ink-2)]">ช่วงคิดดอก</th>
              <ThRight>วัน</ThRight>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => {
              const isActual = r.flags.includes('actual_payment')
              const otherFlags = r.flags.filter((f) => f !== 'actual_payment')
              return (
                <tr
                  key={r.index}
                  className={`border-b border-[var(--color-rule)] ${
                    r.index === currentIndex ? 'bg-[var(--color-principal-tint)]' : ''
                  }`}
                >
                  <TdRight>{r.index}</TdRight>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {formatThaiDate(r.date, 'monthYear')}
                    {r.date !== r.nominalDate && (
                      <span
                        className="ml-1 text-[var(--color-ink-3)]"
                        title={`ตัดจริง ${formatThaiDate(r.date)} ตามกฎคือ ${formatThaiDate(r.nominalDate)}`}
                      >
                        *
                      </span>
                    )}
                  </td>
                  <TdRight>{pct(r.effectiveRateBps)}</TdRight>
                  <TdRight>{bahtRounded(r.principalFixed)}</TdRight>
                  <TdRight>{bahtRounded(r.interestFixed)}</TdRight>
                  <TdRight>
                    <span className={isActual ? 'font-medium' : ''}>
                      {bahtRounded(r.paymentFixed)}
                    </span>
                    {/* แยกให้ชัดว่าแถวไหนมาจากยอดที่บันทึกจริง แถวไหนเป็นประมาณการ */}
                    <span
                      className={`ml-1 text-micro ${
                        isActual ? 'text-[var(--color-ok)]' : 'text-[var(--color-ink-3)]'
                      }`}
                      title={
                        isActual
                          ? 'ยอดที่บันทึกว่าจ่ายจริง'
                          : 'ประมาณการจากค่างวดตามสัญญา ยังไม่ได้บันทึกยอดจริง'
                      }
                    >
                      {isActual ? 'จริง' : 'คาด'}
                    </span>
                  </TdRight>
                  <TdRight>
                    {bahtRounded(r.balanceAfterFixed)}
                    {otherFlags.length > 0 && (
                      <span className="ml-2 text-micro text-[var(--color-ink-3)]">
                        {otherFlags.map((f) => FLAG_LABELS[f] ?? f).join(' · ')}
                      </span>
                    )}
                  </TdRight>
                  {/* ปลายช่วงเป็นแบบเปิด วันตัดยังไม่ถูกคิดดอก จึงแสดงถึงวันก่อนหน้า */}
                  <td className="py-2 pr-4 whitespace-nowrap text-[var(--color-ink-3)]">
                    {formatThaiDate(r.accrualFrom)} – {formatThaiDate(addDays(r.date, -1))}
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

