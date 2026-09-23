/**
 * Prepay Planner (spec ข้อ 3.4)
 *
 * 2 มุมมองบน state ชุดเดียวกัน
 *   ปฏิทิน  ตั้งยอด เห็น "รูปร่างของปี" ทั้ง 12 เดือนในจอเดียว
 *   รายการ  ผลลัพธ์จริงรายงวด ค่างวด + โปะ = ยอดจ่าย แยกดอก/ต้น เหลือเท่าไหร่
 *
 * ⛔ สองมุมมองต้องแสดงคนละอย่าง ถ้าแค่จัดเรียงข้อมูลชุดเดิมใหม่ ไม่ต้องมีสองมุมมอง
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildSchedule } from '@engine/schedule.js'
import { evaluatePrepayPlan } from '@engine/prepay-roi.js'
import type { Fixed } from '@engine/money.js'
import { year as yearOf, type ISODate } from '@engine/date.js'
import type { ScheduleRow } from '@engine/types.js'
import { SplitBar } from '@/components/SplitBar'
import { Field, NumberField, SelectField, TextField, DateField } from '@/components/Field'
import { baht, bahtRounded, formatDuration, formatThaiDate, pct } from '@/lib/format'
import { isoDate } from '@engine/date.js'
import {
  deleteScenario, getMarginalTaxRateBps, listScenarios, loadScenario, saveScenario,
  setMarginalTaxRateBps, toLoanTerms, toPaymentEvents,
  type LoanFull, type LoanListItem, type ScenarioSummary,
} from '@/lib/db'
import {
  MONTH_NAMES, PRESET_CHIPS,
  amountAt, bumpMonths, clearYearOverride, copyYear, emptyDraft, fromPlan, monthRange,
  newLump, setMonths, toPlan,
  type PrepayDraft,
} from './model'

export type OtherLoan = { loanId: string; rows: readonly ScheduleRow[] }

export function PrepayPage({
  item,
  full,
  otherLoans,
  today,
  onBack,
}: {
  item: LoanListItem
  full: LoanFull
  otherLoans: readonly OtherLoan[]
  today: ISODate
  onBack: () => void
}) {
  const terms = useMemo(() => toLoanTerms(full), [full])
  const events = useMemo(() => toPaymentEvents(full), [full])
  const baseline = useMemo(() => buildSchedule(terms, events), [terms, events])

  const startYear = Math.max(yearOf(today), yearOf(terms.startDate))
  const [draft, setDraft] = useState<PrepayDraft>(() => emptyDraft(startYear))
  const [view, setView] = useState<'calendar' | 'list'>('calendar')
  const [editingYear, setEditingYear] = useState(startYear)
  const [anchor, setAnchor] = useState<number | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [manual, setManual] = useState('')

  const [taxRateBps, setTaxRateBps] = useState<number | null>(null)
  const [taxLoaded, setTaxLoaded] = useState(false)
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([])
  const [scenarioName, setScenarioName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reloadScenarios = useCallback(() => {
    listScenarios(item.loanId)
      .then(setScenarios)
      .catch((e: Error) => setError(e.message))
  }, [item.loanId])

  useEffect(reloadScenarios, [reloadScenarios])
  useEffect(() => {
    getMarginalTaxRateBps()
      .then((v) => {
        setTaxRateBps(v)
        setTaxLoaded(true)
      })
      .catch(() => setTaxLoaded(true))
  }, [])

  const { withPlan, outcome } = useMemo(() => {
    const plan = toPlan(draft)
    const withPlan = buildSchedule(terms, events, plan)
    return {
      withPlan,
      outcome: evaluatePrepayPlan({
        loanId: item.loanId,
        baseline,
        withPlan,
        otherLoans,
        marginalTaxRateBps: taxRateBps,
      }),
    }
  }, [draft, terms, events, baseline, item.loanId, otherLoans, taxRateBps])

  const lastYear = yearOf((withPlan.rows[withPlan.rows.length - 1] ?? baseline.rows[0]!).date)

  // ---------- การเลือกช่วง (ข้อ 3.4) ----------
  const tapMonth = (m: number) => {
    if (anchor === null) {
      setAnchor(m)
      setSelected([m])
    } else {
      setSelected(monthRange(anchor, m))
      setAnchor(null)
    }
  }

  const applyToSelection = (amount: number) => {
    if (selected.length === 0) return
    setDraft(setMonths(draft, editingYear, selected, amount))
  }
  const bumpSelection = (delta: number) => {
    if (selected.length === 0) return
    setDraft(bumpMonths(draft, editingYear, selected, delta))
  }

  // ยอดที่พิมพ์เอง — null = ยังไม่พิมพ์, NaN = พิมพ์แล้วแต่ใช้ไม่ได้
  const manualAmount = useMemo(() => {
    const t = manual.replace(/,/g, '').trim()
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : Number.NaN
  }, [manual])

  const applyManual = () => {
    if (manualAmount === null || Number.isNaN(manualAmount)) return
    applyToSelection(manualAmount)
    setManual('')
  }

  async function save() {
    const name = scenarioName.trim()
    if (name === '') return setError('ตั้งชื่อแผนก่อนบันทึก')
    setBusy(true)
    setError(null)
    try {
      await saveScenario(item.loanId, name, toPlan(draft))
      setScenarioName('')
      reloadScenarios()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function load(id: string) {
    setBusy(true)
    setError(null)
    try {
      setDraft(fromPlan(await loadScenario(id)))
      setSelected([])
      setAnchor(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function drop(id: string) {
    setBusy(true)
    try {
      await deleteScenario(id)
      reloadScenarios()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function saveTaxRate(v: number | '') {
    const bpsValue = typeof v === 'number' && v > 0 ? Math.round(v * 100) : null
    setTaxRateBps(bpsValue)
    try {
      await setMarginalTaxRateBps(bpsValue)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
      <button
        onClick={onBack}
        className="tap mb-4 text-meta text-[var(--color-interest)] hover:underline"
      >
        ← กลับ
      </button>

      <header className="mb-6">
        <h1 className="text-hero">วางแผนโปะ</h1>
        <p className="mt-1 text-meta text-[var(--color-ink-2)]">
          {item.propertyName} · {item.bankLabel} · ค่างวด {baht(item.installmentSatang, 0)}
        </p>
      </header>

      {/* ---------- ผลลัพธ์ อัปเดตสดทุกครั้งที่แก้ (ข้อ 3.4) ---------- */}
      <section className="rounded-lg bg-[var(--color-panel)] p-5 text-[var(--color-panel-ink)]">
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            k="ปิดหนี้เร็วขึ้น"
            v={outcome.periodsSaved > 0 ? formatDuration(outcome.periodsSaved) : '—'}
            sub={`เหลือ ${formatDuration(withPlan.rows.length)}`}
          />
          <Stat
            k="ประหยัดดอกเบี้ย"
            v={bahtRounded(outcome.interestSavedFixed)}
            tone="principal"
          />
          <Stat k="เงินที่โปะรวม" v={bahtRounded(outcome.totalPrepaidFixed)} />
          <Stat
            k="ได้คืนต่อเงินโปะ 1 บาท"
            v={outcome.roiBps === null ? '—' : `${(outcome.roiBps / 10_000).toFixed(2)} บาท`}
            sub={
              outcome.afterTaxRoiBps === null
                ? 'กรอกอัตราภาษีเพื่อดูหลังภาษี'
                : `หลังภาษี ${(outcome.afterTaxRoiBps / 10_000).toFixed(2)} บาท`
            }
          />
        </div>

        {outcome.roiBps !== null && (
          <p className="mt-4 text-micro text-[var(--color-panel-ink-3)]">
            ตัวเลขนี้ลดลงเมื่อโปะหนักขึ้น เพราะหนี้หมดเร็วจนไม่เหลือดอกเบี้ยให้ประหยัด —
            ใช้เทียบกับผลตอบแทนของการเอาเงินก้อนเดียวกันไปลงทุนอย่างอื่น
          </p>
        )}
      </section>

      {/* ---------- อัตราภาษี ---------- */}
      <section className="mt-4 max-w-[520px]">
        <Field
          label="อัตราภาษีขั้นบันไดสูงสุดของคุณ"
          suffix="%"
          hint={
            taxRateBps === null
              ? 'เว้นว่างได้ ถ้าไม่กรอกจะไม่แสดงผลตอบแทนหลังภาษี — ไม่เดาแทน'
              : `เสียสิทธิลดหย่อนจากการโปะรวม ${bahtRounded(outcome.deductionLostFixed)} บาท`
          }
        >
          <NumberField
            value={taxLoaded && taxRateBps !== null ? taxRateBps / 100 : ''}
            max={35}
            onChange={(v) => void saveTaxRate(v)}
          />
        </Field>
      </section>

      {/* ---------- สลับมุมมอง ---------- */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {([
            { id: 'calendar' as const, label: 'ปฏิทิน' },
            { id: 'list' as const, label: 'รายการ' },
          ]).map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              aria-pressed={view === v.id}
              className={`tap rounded-md border px-3 py-2 text-meta ${
                view === v.id
                  ? 'border-[var(--color-interest)] bg-[var(--color-interest-tint)] text-[var(--color-interest)]'
                  : 'border-[var(--color-rule)] text-[var(--color-ink-2)]'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <YearNav
          year={editingYear}
          min={yearOf(terms.startDate)}
          max={lastYear}
          onChange={(y) => {
            setEditingYear(y)
            setSelected([])
            setAnchor(null)
          }}
        />
      </div>

      {view === 'calendar' ? (
        <CalendarView
          draft={draft}
          year={editingYear}
          selected={selected}
          anchor={anchor}
          onTap={tapMonth}
          onSetOne={(m, v) => setDraft(setMonths(draft, editingYear, [m], v))}
        />
      ) : (
        <ListView rows={withPlan.rows} year={editingYear} />
      )}

      {/* ---------- เครื่องมือปรับทั้งช่วง ---------- */}
      <section className="mt-4 rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-4">
        <p className="text-meta text-[var(--color-ink-2)]">
          {selected.length === 0
            ? 'แตะเดือนแรก แล้วแตะเดือนสุดท้าย เพื่อเลือกเป็นช่วง'
            : anchor !== null
              ? `เลือก ${MONTH_NAMES[anchor - 1]} แล้ว — แตะอีกเดือนเพื่อจบช่วง`
              : `เลือกอยู่ ${selected.length} เดือน (${MONTH_NAMES[selected[0]! - 1]} – ${MONTH_NAMES[selected[selected.length - 1]! - 1]})`}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {PRESET_CHIPS.map((c) => (
            <button
              key={c.label}
              disabled={selected.length === 0}
              onClick={() => applyToSelection(c.value)}
              className="tap rounded-full border border-[var(--color-rule)] px-3 py-1.5 text-meta hover:border-[var(--color-interest)] hover:text-[var(--color-interest)] disabled:opacity-40"
            >
              {c.label}
            </button>
          ))}

          {/* ยอดที่ไม่มีในชิป — พิมพ์เองแล้วยิงลงทั้งช่วงที่เลือก เหมือนกดชิป */}
          <span className="inline-flex items-center gap-1">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyManual()
                if (e.key === 'Escape') setManual('')
              }}
              disabled={selected.length === 0}
              inputMode="decimal"
              placeholder="ยอดอื่น"
              aria-label="พิมพ์ยอดโปะเอง"
              className={`tap w-[5.5rem] rounded-full border px-3 py-1.5 text-right text-meta num tabular-nums placeholder:text-[var(--color-ink-3)] disabled:opacity-40 ${
                Number.isNaN(manualAmount)
                  ? 'border-[var(--color-warn)]'
                  : 'border-[var(--color-rule)] focus:border-[var(--color-interest)]'
              }`}
            />
            <button
              onClick={applyManual}
              disabled={manualAmount === null || Number.isNaN(manualAmount)}
              className="tap rounded-full border border-[var(--color-interest)] px-3 py-1.5 text-meta text-[var(--color-interest)] disabled:opacity-40"
            >
              ใส่
            </button>
          </span>

          <span className="mx-1 w-px bg-[var(--color-rule)]" />
          {[-500, 500].map((d) => (
            <button
              key={d}
              disabled={selected.length === 0}
              onClick={() => bumpSelection(d)}
              className="tap rounded-full border border-[var(--color-rule)] px-3 py-1.5 text-meta num hover:border-[var(--color-interest)] disabled:opacity-40"
            >
              {d > 0 ? `+${d}` : d}
            </button>
          ))}
          {selected.length > 0 && (
            <button
              onClick={() => {
                setSelected([])
                setAnchor(null)
              }}
              className="tap px-2 text-meta text-[var(--color-ink-3)] hover:underline"
            >
              ยกเลิกการเลือก
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--color-rule)] pt-3">
          <button
            onClick={() => setDraft(copyYear(draft, editingYear, editingYear + 1))}
            className="tap text-meta text-[var(--color-interest)] hover:underline"
          >
            คัดลอกยอดปีนี้ไปปี {editingYear + 544}
          </button>
          {draft.overrides[editingYear] && (
            <button
              onClick={() => setDraft(clearYearOverride(draft, editingYear))}
              className="tap text-meta text-[var(--color-ink-3)] hover:underline"
            >
              ล้างค่าเฉพาะปีนี้ กลับไปใช้แผนฐาน
            </button>
          )}
        </div>
      </section>

      {/* ---------- แผนฐานทำซ้ำถึงปีไหน ---------- */}
      <section className="mt-4 max-w-[520px] rounded-lg border border-[var(--color-rule)] p-4">
        <Field label={`แผนฐานคือปี ${draft.baseYear + 543} ทำซ้ำแบบ`}>
          <SelectField
            value={draft.repeatMode}
            onChange={(v) => setDraft({ ...draft, repeatMode: v })}
            options={[
              { value: 'repeat_forever' as const, label: 'ทุกปีจนปิดหนี้' },
              { value: 'repeat_until' as const, label: 'ถึงปีที่กำหนด' },
              { value: 'single_year' as const, label: 'เฉพาะปีฐานปีเดียว' },
            ]}
          />
        </Field>
        {draft.repeatMode === 'repeat_until' && (
          <div className="mt-3">
            <Field label="ทำซ้ำถึงปี (พ.ศ.)">
              <NumberField
                value={typeof draft.repeatUntilYear === 'number' ? draft.repeatUntilYear + 543 : ''}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    repeatUntilYear: typeof v === 'number' ? v - 543 : '',
                  })
                }
              />
            </Field>
          </div>
        )}
      </section>

      <LumpSection draft={draft} onChange={setDraft} today={today} />

      {/* ---------- บันทึก/เทียบแผน ---------- */}
      <section className="mt-8">
        <h2 className="text-row">แผนที่บันทึกไว้</h2>
        <p className="mt-1 text-meta text-[var(--color-ink-2)]">
          บันทึกได้หลายชุดแล้วสลับดู เช่น โปะสม่ำเสมอ กับ โปะก้อนตอนโบนัส
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Field label="ชื่อแผน">
              <TextField
                value={scenarioName}
                onChange={setScenarioName}
                placeholder="เช่น โปะเดือนละ 5,000"
              />
            </Field>
          </div>
          <button
            onClick={() => void save()}
            disabled={busy}
            className="tap rounded-md bg-[var(--color-interest)] px-4 py-2 text-[var(--color-panel-ink)] disabled:opacity-50"
          >
            บันทึกแผนนี้
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-meta text-[var(--color-warn)]">
            {error}
          </p>
        )}

        {scenarios.length > 0 && (
          <ul className="mt-4 divide-y divide-[var(--color-rule)]">
            {scenarios.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 py-2">
                <span>{s.name}</span>
                <span className="flex gap-3 text-meta">
                  <button
                    onClick={() => void load(s.id)}
                    disabled={busy}
                    className="tap text-[var(--color-interest)] hover:underline disabled:opacity-50"
                  >
                    เปิด
                  </button>
                  <button
                    onClick={() => void drop(s.id)}
                    disabled={busy}
                    className="tap text-[var(--color-ink-3)] hover:text-[var(--color-warn)] disabled:opacity-50"
                  >
                    ลบ
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ---------- ชิ้นส่วน ----------

function Stat({
  k,
  v,
  sub,
  tone,
}: {
  k: string
  v: string
  sub?: string
  tone?: 'principal'
}) {
  return (
    <div>
      <p className="text-meta text-[var(--color-panel-ink-2)]">{k}</p>
      <p
        className={`num text-figure ${
          tone === 'principal' ? 'text-[var(--color-principal-dark)]' : ''
        }`}
      >
        {v}
      </p>
      {sub && <p className="text-micro text-[var(--color-panel-ink-3)]">{sub}</p>}
    </div>
  )
}

function YearNav({
  year,
  min,
  max,
  onChange,
}: {
  year: number
  min: number
  max: number
  onChange: (y: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(year - 1)}
        disabled={year <= min}
        className="tap rounded-md border border-[var(--color-rule)] px-3 py-2 disabled:opacity-40"
      >
        ←
      </button>
      <span className="num min-w-[72px] text-center text-row">{year + 543}</span>
      <button
        onClick={() => onChange(year + 1)}
        disabled={year >= max}
        className="tap rounded-md border border-[var(--color-rule)] px-3 py-2 disabled:opacity-40"
      >
        →
      </button>
    </div>
  )
}

/**
 * ปฏิทิน 3 คอลัมน์ × 4 แถว — เห็นครบ 12 เดือนโดยไม่ต้องเลื่อน
 * แถบใต้ตัวเลขทำให้กวาดตาเห็น "รูปร่างของปี" ได้ทันทีว่าเดือนไหนหนักเบา
 */
function CalendarView({
  draft,
  year,
  selected,
  anchor,
  onTap,
  onSetOne,
}: {
  draft: PrepayDraft
  year: number
  selected: readonly number[]
  anchor: number | null
  onTap: (m: number) => void
  onSetOne: (m: number, v: number) => void
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const values = Array.from({ length: 12 }, (_, i) => amountAt(draft, year, i + 1))
  const max = Math.max(1, ...values)

  return (
    <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
      {values.map((v, i) => {
        const m = i + 1
        const isSelected = selected.includes(m)
        const isAnchor = anchor === m
        return (
          <div
            key={m}
            className={`rounded-lg border p-3 ${
              isSelected || isAnchor
                ? 'border-[var(--color-interest)] bg-[var(--color-interest-tint)]'
                : 'border-[var(--color-rule)] bg-[var(--color-paper-raised)]'
            }`}
          >
            <button
              onClick={() => onTap(m)}
              className="tap block w-full text-left text-meta text-[var(--color-ink-2)]"
            >
              {MONTH_NAMES[i]}
            </button>

            {editing === m ? (
              <input
                autoFocus
                type="text"
                inputMode="decimal"
                defaultValue={v === 0 ? '' : String(v)}
                onBlur={(e) => {
                  const n = Number(e.target.value.replace(/,/g, ''))
                  onSetOne(m, Number.isFinite(n) && n > 0 ? n : 0)
                  setEditing(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setEditing(null)
                }}
                className="mt-1 w-full rounded-md border border-[var(--color-interest)] px-2 py-1 text-right num"
              />
            ) : (
              /* แตะที่ตัวเลข = พิมพ์ค่าเอง สำหรับยอดที่ไม่มีในชิป (ข้อ 3.4) */
              <button
                onClick={() => setEditing(m)}
                className="tap mt-1 block w-full text-right num text-row"
              >
                {v === 0 ? (
                  <span className="text-[var(--color-ink-3)]">—</span>
                ) : (
                  v.toLocaleString('en-US')
                )}
              </button>
            )}

            <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-[var(--color-rule)]">
              <span
                className="block h-full bg-[var(--color-principal)]"
                style={{ width: `${(v / max) * 100}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * มุมมองรายการ — ต้องแสดงสิ่งที่ปฏิทินแสดงไม่ได้ (ข้อ 3.4)
 * คือ "ผลลัพธ์จริง" ของแต่ละงวดหลังใส่แผนแล้ว ไม่ใช่ยอดที่ตั้งไว้
 */
function ListView({ rows, year }: { rows: readonly ScheduleRow[]; year: number }) {
  const inYear = rows.filter((r) => yearOf(r.date) === year)

  if (inYear.length === 0) {
    return (
      <p className="mt-4 text-[var(--color-ink-2)]">
        ปี {year + 543} ไม่มีงวดที่ต้องจ่าย — หนี้ปิดไปก่อนแล้ว
      </p>
    )
  }

  return (
    <ul className="mt-4 space-y-2">
      {inYear.map((r) => {
        const installment = (r.paymentFixed - r.prepayFixed) as Fixed
        return (
          <li
            key={r.index}
            className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-meta text-[var(--color-ink-2)]">
                งวด {r.index} · {formatThaiDate(r.date)}
                {/* เดือนสั้นดอกน้อยกว่า ต้องติดป้ายไม่งั้นดูเหมือนคำนวณผิด */}
                {r.accrualDays !== 30 && r.accrualDays !== 31 && (
                  <span className="ml-2 text-[var(--color-ink-3)]">{r.accrualDays} วัน</span>
                )}
              </span>
              {/* งวดที่ไม่ได้โปะไม่ต้องโชว์ "15,000 = 15,000" ซึ่งไม่ได้บอกอะไรเพิ่ม */}
              <span className="num">
                {r.prepayFixed > 0n ? (
                  <>
                    {bahtRounded(installment)}
                    <span className="text-[var(--color-ink-3)]"> + </span>
                    <span className="text-[var(--color-principal-text)]">
                      {bahtRounded(r.prepayFixed)}
                    </span>
                    <span className="text-[var(--color-ink-3)]"> = </span>
                    <span className="font-medium">{bahtRounded(r.paymentFixed)}</span>
                  </>
                ) : (
                  <span className="font-medium">{bahtRounded(r.paymentFixed)}</span>
                )}
              </span>
            </div>

            <SplitBar
              className="mt-2"
              interest={r.interestFixed}
              principal={r.principalFixed}
              height={6}
            />

            <div className="mt-1 flex flex-wrap justify-between gap-x-4 text-micro text-[var(--color-ink-2)]">
              <span>
                ดอก {bahtRounded(r.interestFixed)} · ต้น {bahtRounded(r.principalFixed)} ·{' '}
                {pct(r.effectiveRateBps)}
              </span>
              <span className="num">เหลือ {bahtRounded(r.balanceAfterFixed)}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** ก้อนเดี่ยวตามวันที่ เช่น โบนัส — บวกเพิ่มจากยอดรายเดือน ไม่ใช่แทนที่ (TV-22) */
function LumpSection({
  draft,
  onChange,
  today,
}: {
  draft: PrepayDraft
  onChange: (d: PrepayDraft) => void
  today: ISODate
}) {
  return (
    <section className="mt-4 rounded-lg border border-[var(--color-rule)] p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-row">โปะก้อนตามวันที่</h2>
        <button
          onClick={() => onChange({ ...draft, lumps: [...draft.lumps, newLump(today)] })}
          className="tap text-meta text-[var(--color-interest)] hover:underline"
        >
          + เพิ่มก้อน
        </button>
      </div>
      <p className="mt-1 text-meta text-[var(--color-ink-2)]">
        บวกเพิ่มจากยอดรายเดือน ไม่ใช่แทนที่ — ต้องตรงวันตัดงวดถึงจะถูกนับในงวดนั้น
      </p>

      {draft.lumps.map((l, i) => (
        <div key={l.id} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Field label="วันที่จ่าย" hint={formatThaiDate(l.payDate)}>
            <DateField
              value={l.payDate}
              onChange={(v) => {
                const next = [...draft.lumps]
                next[i] = { ...l, payDate: isoDate(v) }
                onChange({ ...draft, lumps: next })
              }}
            />
          </Field>
          <Field label="จำนวน" suffix="บาท">
            <NumberField
              value={l.amount}
              onChange={(v) => {
                const next = [...draft.lumps]
                next[i] = { ...l, amount: v }
                onChange({ ...draft, lumps: next })
              }}
            />
          </Field>
          <Field label="หมายเหตุ">
            <TextField
              value={l.label}
              onChange={(v) => {
                const next = [...draft.lumps]
                next[i] = { ...l, label: v }
                onChange({ ...draft, lumps: next })
              }}
              placeholder="โบนัส"
            />
          </Field>
          <button
            onClick={() =>
              onChange({ ...draft, lumps: draft.lumps.filter((x) => x.id !== l.id) })
            }
            className="tap self-end pb-2 text-meta text-[var(--color-ink-3)] hover:text-[var(--color-warn)]"
          >
            ลบ
          </button>
        </div>
      ))}
    </section>
  )
}
