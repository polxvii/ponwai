/**
 * Refinance Mode (spec ข้อ 2A)
 *
 * โหมดหลักเท่ากับ Compare ไม่ใช่ feature ย่อย เพราะผู้ใช้กลับมาใช้ทุก 3 ปีตลอดอายุสัญญา
 * ⛔ ห้ามตัด "ไม่ทำอะไร" ออกจากตาราง — เป็น baseline เดียวที่บอกได้ว่าย้ายแล้วคุ้มจริงไหม
 */

import { useEffect, useMemo, useState } from 'react'
import { compareRefinanceOptions, recommend, type RefinanceOutcome } from '@engine/refinance.js'
import type { Satang } from '@engine/money.js'
import { isoDate } from '@engine/date.js'
import { Field, NumberField, SelectField, TextField, Toggle, DateField } from '@/components/Field'
import { useLocalState } from '@/lib/persist'
import { ResetButton } from '@/components/ResetButton'
import { todayISO } from '../track/model'
import { baht, bahtRounded, formatDuration, formatThaiDate } from '@/lib/format'
import { BANK_OPTIONS, OTHER_BANK } from '../compare/model'
import { InterestCurveChart } from './InterestCurveChart'
import { useAuth } from '@/lib/auth'
import { getLoanFull, listLoans, type LoanListItem } from '@/lib/db'
import {
  currentFromLoan, emptyCurrent, EMPTY_RETENTION, EMPTY_REFI,
  buildScenarios, contextOf, penaltyOf, refiMissing, refiMovingCost, refiReady,
  refiWarnings, retentionUsable,
  reviveCurrent, reviveRetention, reviveRefi,
  type CurrentLoan, type RetentionDraft, type RefiDraft,
} from './model'

/** อ่านครั้งเดียวตอนโหลดโมดูล ไม่งั้นค่าตั้งต้นเปลี่ยนทุก render แล้ว reset วนไม่จบ */
const TODAY = todayISO()
const EMPTY_CURRENT = emptyCurrent(TODAY)
const REVIVE_CURRENT = reviveCurrent(TODAY)

/** ช่องว่างคือ 0 — ใช้ที่เดียวกับ model เพื่อให้ตีความค่าว่างตรงกัน */
const num = (v: number | '' | undefined): number => (typeof v === 'number' ? v : 0)

export function RefinancePage() {
  const [current, setCurrent, resetCurrent] = useLocalState<CurrentLoan>(
    'refi:current', EMPTY_CURRENT, REVIVE_CURRENT,
  )
  const [retention, setRetention, resetRetention] = useLocalState<RetentionDraft>(
    'refi:retention', EMPTY_RETENTION, reviveRetention,
  )
  const [refi, setRefi, resetRefi] = useLocalState<RefiDraft>(
    'refi:offer', EMPTY_REFI, reviveRefi,
  )

  const resetAll = () => {
    resetCurrent()
    resetRetention()
    resetRefi()
  }

  const { outcomes, best, warnings, error } = useMemo(() => {
    const empty = {
      outcomes: [] as RefinanceOutcome[],
      best: null as RefinanceOutcome | null,
      warnings: [] as string[],
      error: null as string | null,
    }
    if (!refiReady(current, refi)) return empty
    try {
      const outcomes = compareRefinanceOptions(
        contextOf(current),
        buildScenarios(current, retention, refi),
      )
      const { best, warnings } = recommend(outcomes)
      return { outcomes, best, warnings, error: null }
    } catch (e) {
      return { ...empty, error: (e as Error).message }
    }
  }, [current, retention, refi])

  const penalty = penaltyOf(current)
  const moving = refiMovingCost(current, refi)
  const missing = refiMissing(current, refi)
  const missingCosts = refiWarnings(current, retention, refi)

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="text-hero">รีไฟแนนซ์คุ้มไหม</h1>
          <p className="mt-1 text-meta text-[var(--color-ink-2)]">
            เทียบ 3 ทางพร้อมกันเสมอ — อยู่เฉย ๆ / ขอลดดอกกับธนาคารเดิม / ย้ายธนาคาร
          </p>
        </div>
        <ResetButton onReset={resetAll} />
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-10">
        {/* min-w-0 จำเป็น: grid item ตั้งต้นเป็น min-width:auto ลูกที่กว้างจะดันคอลัมน์จนหน้าเลื่อนได้ */}
        <div className="min-w-0 space-y-6">
          <CurrentLoanForm
            value={current}
            onChange={(p) => setCurrent({ ...current, ...p })}
            penalty={penalty}
            onPull={(p) => setCurrent({ ...current, ...p })}
          />
          <RetentionForm value={retention} onChange={(p) => setRetention({ ...retention, ...p })} />
          <RefiForm value={refi} onChange={(p) => setRefi({ ...refi, ...p })} movingCost={moving} />
        </div>

        <div className="min-w-0">
          {error && (
            <p className="rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-meta text-[var(--color-warn)]">
              {error}
            </p>
          )}

          {/* บอกให้ครบว่ายังขาดช่องไหน ไม่ใช่ทิ้งให้ไล่หาเองว่าทำไมผลยังไม่ขึ้น */}
          {outcomes.length === 0 && !error && (
            <div className="text-[var(--color-ink-2)]">
              <p>กรอกให้ครบแล้วผลลัพธ์จะขึ้นทันที ยังขาด</p>
              <ul className="mt-2 space-y-1 text-meta">
                {missing.map((m) => (
                  <li key={m}>· {m}</li>
                ))}
              </ul>
            </div>
          )}

          {outcomes.length > 0 && (
            <>
              {best && <Verdict best={best} outcomes={outcomes} />}

              {warnings.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {warnings.map((w, i) => (
                    <li
                      key={i}
                      className="rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-meta text-[var(--color-warn)]"
                    >
                      ⚠️ {w}
                    </li>
                  ))}
                </ul>
              )}

              <OutcomeTable outcomes={outcomes} best={best} />

              {/* ให้ผลลัพธ์ตั้งแต่ยังกรอกไม่ครบ พร้อมบอกว่าที่ขาดกระทบเท่าไหร่ (ข้อ 5A.3) */}
              {missingCosts.length > 0 && (
                <aside className="mt-6 rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-4">
                  <h3 className="text-meta font-medium">ยังกรอกไม่ครบ — ต้นทุนการย้ายต่ำกว่าจริง</h3>
                  <ul className="mt-2 space-y-1 text-meta text-[var(--color-ink-2)]">
                    {missingCosts.map((w) => (
                      <li key={w.label}>
                        {w.label} — {w.impact}
                      </li>
                    ))}
                  </ul>
                </aside>
              )}

              {/* ผู้ใช้กรอก 2 ทาง แล้วเห็น 4 แถว ต้องบอกว่าอีก 2 มาจากไหน ไม่ใช่ปล่อยให้เดา */}
              {outcomes.some((o) => o.autoAdded) && (
                <p className="mt-3 text-meta text-[var(--color-ink-2)]">
                  แถวที่ติดป้าย &quot;แอพเติมให้&quot; ไม่ได้มาจากที่คุณกรอก —{' '}
                  <b className="font-medium">ไม่ทำอะไร</b> คือฐานเทียบที่ต้องมีเสมอ และ{' '}
                  <b className="font-medium">คงค่างวดเดิม</b> คือย้ายธนาคารแล้วจ่ายเท่าที่จ่ายอยู่
                  ไม่ลดค่างวดลง ซึ่งธนาคารไม่เสนอให้ แต่มักเป็นทางที่ถูกที่สุด
                </p>
              )}
              <InterestCurveChart outcomes={outcomes} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** คำตอบตรง ๆ ว่าควรทำอะไร วางไว้บนสุดก่อนตาราง (ข้อ 2A.3) */
function Verdict({
  best,
  outcomes,
}: {
  best: RefinanceOutcome
  outcomes: readonly RefinanceOutcome[]
}) {
  const stay = outcomes.find((o) => o.kind === 'stay')

  return (
    <section className="rounded-lg bg-[var(--color-panel)] p-5 text-[var(--color-panel-ink)]">
      <p className="text-meta text-[var(--color-panel-ink-2)]">ทางที่ถูกที่สุด</p>
      <h2 className="mt-1 text-lead">{best.label}</h2>

      {best.kind === 'stay' ? (
        <p className="mt-3 text-meta text-[var(--color-panel-ink-2)]">
          ยังไม่มีข้อเสนอไหนคุ้มกว่าการอยู่เฉย ๆ
        </p>
      ) : (
        <p className="mt-3 num text-figure text-[var(--color-principal-dark)]">
          ประหยัดดอกเบี้ย {bahtRounded(best.interestSavedVsStayFixed)} บาท
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-meta">
        <PanelRow k="ดอกเบี้ยที่เหลือจ่าย" v={bahtRounded(best.futureInterestFixed)} />
        <PanelRow k="ต้นทุนการย้าย" v={baht(best.movingCostSatang, 0)} />
        <PanelRow k="ผ่อนอีก" v={formatDuration(best.remainingPeriods)} />
        <PanelRow k="ปิดหนี้" v={formatThaiDate(best.payoffDate, 'monthYear')} />
        <PanelRow
          k="คืนทุนเดือนที่"
          v={best.breakevenMonth === null ? 'ไม่คืนทุน' : String(best.breakevenMonth)}
        />
        {stay && (
          <PanelRow
            k="ระยะเวลาที่เปลี่ยนไป"
            v={`${formatDuration(stay.remainingPeriods)} เหลือ ${formatDuration(best.remainingPeriods)}`}
          />
        )}
      </dl>
    </section>
  )
}

function PanelRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-[var(--color-panel-ink-2)]">{k}</dt>
      <dd className="text-right num">{v}</dd>
    </>
  )
}

function OutcomeTable({
  outcomes,
  best,
}: {
  outcomes: readonly RefinanceOutcome[]
  best: RefinanceOutcome | null
}) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-row">
        <thead>
          <tr className="border-b border-[var(--color-rule)] text-left">
            <th className="py-3 pr-4 text-meta font-medium text-[var(--color-ink-2)]">
              ทางเลือก
            </th>
            <Th>ค่างวด</Th>
            <Th title="ดอกเบี้ยตั้งแต่วันนี้จนปิดหนี้">ดอกเบี้ยที่เหลือ</Th>
            <Th>ต้นทุนย้าย</Th>
            <Th title="เทียบกับการไม่ทำอะไรเลย ติดลบ = แพงกว่า">ประหยัดได้</Th>
            <Th>ผ่อนอีก</Th>
            <Th title="เดือนที่ดอกเบี้ยที่ประหยัดสะสมเกินต้นทุนการย้าย">คืนทุน</Th>
          </tr>
        </thead>
        <tbody>
          {outcomes.map((o, i) => {
            const isBest = best !== null && o.label === best.label
            return (
              <tr
                key={i}
                className={`border-b border-[var(--color-rule)] ${
                  !o.feasible || o.costsMoreThanStaying ? 'opacity-70' : ''
                }`}
              >
                <td className="py-3 pr-4">
                  <span className={isBest ? 'font-medium' : ''}>{o.label}</span>
                  {isBest && (
                    <span className="ml-2 rounded-sm bg-[var(--color-principal-tint)] px-1.5 py-0.5 text-micro text-[var(--color-principal-text)]">
                      ถูกที่สุด
                    </span>
                  )}
                  {o.autoAdded && (
                    <span
                      className="ml-2 rounded-sm border border-[var(--color-rule)] px-1.5 py-0.5 text-micro text-[var(--color-ink-3)]"
                      title={
                        o.kind === 'stay'
                          ? 'ฐานเทียบที่ต้องมีเสมอ ถ้าไม่มีก็บอกไม่ได้ว่าการย้ายคุ้มจริงไหม'
                          : 'ทางที่ธนาคารไม่เสนอ แต่มักถูกที่สุด — ย้ายแล้วจ่ายเท่าที่จ่ายอยู่ ไม่ลดค่างวด'
                      }
                    >
                      แอพเติมให้
                    </span>
                  )}
                  {!o.feasible && (
                    <span className="ml-2 rounded-sm bg-[var(--color-warn)]/12 px-1.5 py-0.5 text-micro text-[var(--color-warn)]">
                      จ่ายไม่ไหว
                    </span>
                  )}
                </td>
                <Td>{baht(o.installmentSatang, 0)}</Td>

                {/* ⛔ ตัวเลขของเคสที่จ่ายไม่ไหวไม่มีความหมาย — ตอนชนเพดานงวดจะได้ดอกหลักสิบล้าน
                    แสดงสาเหตุแทน ไม่ใช่โชว์เลขใหญ่ ๆ ให้เทียบกับของจริง */}
                {o.feasible ? (
                  <>
                    <Td>{bahtRounded(o.futureInterestFixed)}</Td>
                    <Td>{o.kind === 'stay' ? '—' : baht(o.movingCostSatang, 0)}</Td>
                    <Td
                      tone={
                        o.kind === 'stay'
                          ? undefined
                          : o.interestSavedVsStayFixed < 0n
                            ? 'warn'
                            : 'ok'
                      }
                    >
                      {o.kind === 'stay' ? '—' : bahtRounded(o.interestSavedVsStayFixed)}
                    </Td>
                    <Td>{formatDuration(o.remainingPeriods)}</Td>
                    <Td tone={o.kind !== 'stay' && o.breakevenBeyondLockin ? 'warn' : undefined}>
                      {o.kind === 'stay'
                        ? '—'
                        : o.breakevenMonth === null
                          ? 'ไม่คืนทุน'
                          : `เดือนที่ ${o.breakevenMonth}`}
                    </Td>
                  </>
                ) : (
                  <td colSpan={5} className="py-3 pr-4 text-meta text-[var(--color-warn)]">
                    {o.infeasibleReason} · ต้องจ่ายอย่างน้อย {baht(o.minInstallmentSatang, 0)} บาท
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Th({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <th
      className="py-3 pr-4 text-right text-meta font-medium text-[var(--color-ink-2)]"
      title={title}
    >
      {children}
    </th>
  )
}

function Td({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'ok' | undefined }) {
  const color =
    tone === 'warn' ? 'text-[var(--color-warn)]' : tone === 'ok' ? 'text-[var(--color-ok)]' : ''
  return <td className={`py-3 pr-4 text-right num ${color}`}>{children}</td>
}

// ---------- ฟอร์ม ----------

/**
 * ดึงยอดจากสัญญาที่ติดตามอยู่ มาเป็นค่าตั้งต้น
 *
 * ⚠️ หน้านี้ใช้ได้โดยไม่ต้องล็อกอิน (ข้อ 2A) ตัวดึงจึงต้องหายไปเงียบ ๆ
 *    เมื่อยังไม่ล็อกอินหรือยังไม่มีสัญญา ห้ามขึ้นกล่องชวนล็อกอินคั่นกลางฟอร์ม
 * ⚠️ ล้มเหลวก็ต้องไม่พังทั้งหน้า — กรอกเองได้อยู่แล้ว การดึงเป็นแค่ทางลัด
 */
function PullFromTracked({ onPull }: { onPull: (p: Partial<CurrentLoan>) => void }) {
  const { user, loading } = useAuth()
  const [loans, setLoans] = useState<LoanListItem[]>([])
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pulledFrom, setPulledFrom] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return setLoans([])
    let alive = true
    listLoans()
      .then((all) => alive && setLoans(all.filter((l) => l.status === 'active')))
      .catch(() => alive && setLoans([]))
    return () => {
      alive = false
    }
  }, [user])

  if (loading || !user || loans.length === 0) return null

  const target = picked === '' ? loans[0] : loans.find((l) => l.loanId === picked)

  async function pull() {
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      onPull(currentFromLoan(await getLoanFull(target.loanId), TODAY))
      setPulledFrom(target.propertyName)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1">
          <Field label="ดึงจากสัญญาที่ติดตามอยู่">
            <SelectField
              value={target?.loanId ?? ''}
              onChange={setPicked}
              options={loans.map((l) => ({
                value: l.loanId,
                label: `${l.propertyName} · ${l.bankLabel}`,
              }))}
            />
          </Field>
        </div>
        <button
          onClick={() => void pull()}
          disabled={busy || !target}
          className="tap shrink-0 rounded-md border border-[var(--color-interest)] px-3 py-2 text-meta text-[var(--color-interest)] disabled:opacity-50"
        >
          {busy ? 'กำลังดึง…' : 'ใช้ข้อมูลนี้'}
        </button>
      </div>

      {error && <p className="mt-2 text-meta text-[var(--color-warn)]">{error}</p>}

      <p className="mt-2 text-micro text-[var(--color-ink-3)]">
        {pulledFrom === null
          ? 'เติมยอดคงเหลือ ค่างวด เรต และงวดที่เหลือให้ แก้ต่อได้ทุกช่อง'
          : `เติมจาก ${pulledFrom} แล้ว — แก้ต่อได้ทุกช่อง`}
        {' '}ส่วน lock-in กับค่าปรับไถ่ถอนอยู่ในสัญญากระดาษ ระบบไม่มีข้อมูล ต้องกรอกเอง
      </p>
    </div>
  )
}

function CurrentLoanForm({
  value: c,
  onChange,
  penalty,
  onPull,
}: {
  value: CurrentLoan
  onChange: (p: Partial<CurrentLoan>) => void
  penalty: Satang
  onPull: (p: Partial<CurrentLoan>) => void
}) {
  return (
    <section>
      <h2 className="mb-3 text-row">หนี้ที่ผ่อนอยู่</h2>
      <PullFromTracked onPull={onPull} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="ยอดคงเหลือวันนี้" suffix="บาท">
          <NumberField value={c.balance} onChange={(v) => onChange({ balance: v })} />
        </Field>
        <Field label="ค่างวดที่จ่ายอยู่" suffix="บาท">
          <NumberField value={c.installment} onChange={(v) => onChange({ installment: v })} />
        </Field>
        <Field label="เรตที่จ่ายอยู่" suffix="%">
          <NumberField value={c.currentRate} onChange={(v) => onChange({ currentRate: v })} />
        </Field>
        <Field label="งวดที่เหลือตามสัญญา" suffix="งวด">
          <NumberField
            value={c.remainingMonths}
            max={480}
            onChange={(v) => onChange({ remainingMonths: v })}
          />
        </Field>
        <Field label="วันที่พิจารณา" hint={formatThaiDate(c.asOf, 'long')}>
          <DateField value={c.asOf} onChange={(v) => onChange({ asOf: isoDate(v) })} />
        </Field>
        <Field label="วันตัดรอบ" suffix="ของเดือน">
          <NumberField
            value={c.dueDayOfMonth}
            max={31}
            onChange={(v) => onChange({ dueDayOfMonth: v })}
          />
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="lock-in เดิมเหลือ" suffix="เดือน" hint="0 = พ้นแล้ว ไถ่ถอนได้ฟรี">
          <NumberField
            value={c.lockinLeftMonths}
            max={120}
            onChange={(v) => onChange({ lockinLeftMonths: v })}
          />
        </Field>
        <Field
          label="ค่าปรับไถ่ถอน"
          suffix="%"
          /* ⛔ ห้ามสรุปจากยอดที่คำนวณได้ ยอด 0 เกิดจาก "ยังไม่กรอก" ก็ได้
             การบอกว่า "พ้น lock-in แล้ว" ทั้งที่ผู้ใช้เพิ่งกรอกว่าเหลืออีก 12 เดือน
             คือยืนยันข้อเท็จจริงที่ผิด บนตัวเลขที่ชี้ขาดว่าย้ายคุ้มหรือไม่ */
          hint={
            num(c.lockinLeftMonths) === 0
              ? 'ไม่ถูกเก็บ เพราะพ้น lock-in แล้ว'
              : penalty > 0n
                ? `คิดเป็น ${baht(penalty, 0)} บาท`
                : `ยังเหลือ lock-in ${num(c.lockinLeftMonths)} เดือน ต้องกรอก % ไม่งั้นคิดเป็น 0`
          }
        >
          <NumberField value={c.penaltyPct} onChange={(v) => onChange({ penaltyPct: v })} />
        </Field>
      </div>
    </section>
  )
}

function RetentionForm({
  value: r,
  onChange,
}: {
  value: RetentionDraft
  onChange: (p: Partial<RetentionDraft>) => void
}) {
  const setRate = (i: number, v: number | '') => {
    const next = [...r.promoRates]
    next[i] = v
    onChange({ promoRates: next })
  }

  return (
    <section className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-4">
      <Toggle
        checked={r.enabled}
        onChange={(v) => onChange({ enabled: v })}
        label="ขอลดดอกกับธนาคารเดิม (retention)"
        hint="ไม่ต้องจดจำนองใหม่ ไม่ต้องประเมินใหม่ มักเสียแค่ค่าดำเนินการหลักพัน — ควรลองขอก่อนเสมอ"
      />
      {r.enabled && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {r.promoRates.map((x, i) => (
              <Field key={i} label={`ปีที่ ${i + 1}`} suffix="%">
                <NumberField value={x} onChange={(v) => setRate(i, v)} />
              </Field>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="หลังพ้นโปร" suffix="%">
              <NumberField value={r.floatingRate} onChange={(v) => onChange({ floatingRate: v })} />
            </Field>
            <Field label="ค่าดำเนินการ" suffix="บาท">
              <NumberField value={r.fee} onChange={(v) => onChange({ fee: v })} />
            </Field>
          </div>

          {/* ต้องบอก ไม่งั้นผู้ใช้เปิดสวิตช์ไว้แล้วงงว่าทำไมตารางมีแค่ 2 ทาง */}
          {!retentionUsable(r) && (
            <p className="mt-3 text-meta text-[var(--color-ink-3)]">
              ยังไม่เอาทางนี้ไปเทียบ เพราะต้องมีทั้งเรตโปรอย่างน้อย 1 ปี และเรตหลังพ้นโปร
            </p>
          )}
        </>
      )}
    </section>
  )
}

function RefiForm({
  value: r,
  onChange,
  movingCost,
}: {
  value: RefiDraft
  onChange: (p: Partial<RefiDraft>) => void
  movingCost: Satang
}) {
  const setRate = (i: number, v: number | '') => {
    const next = [...r.promoRates]
    next[i] = v
    onChange({ promoRates: next })
  }

  return (
    <section className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-4">
      <Field label="ย้ายไปธนาคาร">
        <SelectField
          value={r.bankCode}
          onChange={(v) => onChange({ bankCode: v })}
          options={BANK_OPTIONS}
          placeholder="เลือกธนาคาร"
        />
      </Field>

      {r.bankCode === OTHER_BANK && (
        <div className="mt-3">
          <Field label="ชื่อผู้ให้กู้" hint="ใช้ชื่อนี้ในตารางผลลัพธ์">
            <TextField
              value={r.customName}
              onChange={(v) => onChange({ customName: v })}
              placeholder="เช่น สหกรณ์ออมทรัพย์ครู"
            />
          </Field>
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        {r.promoRates.map((x, i) => (
          <Field key={i} label={`ปีที่ ${i + 1}`} suffix="%">
            <NumberField value={x} onChange={(v) => setRate(i, v)} />
          </Field>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="หลังพ้นโปร" suffix="%">
          <NumberField value={r.floatingRate} onChange={(v) => onChange({ floatingRate: v })} />
        </Field>
        <Field label="ค่างวดตามใบเสนอ" suffix="บาท">
          <NumberField value={r.installment} onChange={(v) => onChange({ installment: v })} />
        </Field>
        <Field
          label="เทอมใหม่"
          suffix="ปี"
          hint="ยืดกลับ 30 ปี = ค่างวดถูกลง แต่ดอกรวมอาจมากกว่าไม่ทำอะไร"
        >
          <NumberField
            value={r.termYears}
            max={40}
            onChange={(v) => onChange({ termYears: v })}
          />
        </Field>
        <Field label="lock-in ใหม่" suffix="เดือน">
          <NumberField
            value={r.lockinMonths}
            max={120}
            onChange={(v) => onChange({ lockinMonths: typeof v === 'number' ? v : 36 })}
          />
        </Field>
      </div>

      <details className="mt-3" open>
        <summary className="tap cursor-pointer text-meta text-[var(--color-ink-2)]">
          ต้นทุนการย้าย รวมแล้ว {baht(movingCost, 0)} บาท
        </summary>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="ค่าจดจำนองใหม่" suffix="%">
              <NumberField
                value={r.mortgageFeePct}
                onChange={(v) => onChange({ mortgageFeePct: v })}
              />
            </Field>
            <Field label="ค่าประเมินใหม่" suffix="บาท">
              <NumberField value={r.appraisalFee} onChange={(v) => onChange({ appraisalFee: v })} />
            </Field>
            <Field label="ค่าธรรมเนียมอื่น" suffix="บาท">
              <NumberField value={r.otherFee} onChange={(v) => onChange({ otherFee: v })} />
            </Field>
            <Field label="เบี้ย MRTA ใหม่" suffix="บาท">
              <NumberField
                value={r.newMrtaPremium}
                onChange={(v) => onChange({ newMrtaPremium: v })}
              />
            </Field>
            <Field label="เบี้ยอัคคีภัยใหม่" suffix="บาท">
              <NumberField
                value={r.newFirePremium}
                onChange={(v) => onChange({ newFirePremium: v })}
              />
            </Field>
            <Field label="ของแถมที่ต้องคืนแบงก์เดิม" suffix="บาท">
              <NumberField value={r.clawback} onChange={(v) => onChange({ clawback: v })} />
            </Field>
            <Field
              label="เงินเวนคืน MRTA เดิม"
              suffix="บาท"
              hint="ได้คืนราว 30–50% ของเบี้ยถ้ายังเหลือความคุ้มครอง ลดต้นทุนย้ายลงตรง ๆ"
            >
              <NumberField
                value={r.surrenderRefund}
                onChange={(v) => onChange({ surrenderRefund: v })}
              />
            </Field>
            <Field label="ของแถมเงินสดจากแบงก์ใหม่" suffix="บาท">
              <NumberField value={r.incentive} onChange={(v) => onChange({ incentive: v })} />
            </Field>
          </div>

          <Toggle
            checked={r.stampDuty}
            onChange={(v) => onChange({ stampDuty: v })}
            label="มีอากรแสตมป์ 0.05%"
            hint="เพดาน 10,000 บาทตามกฎหมาย"
          />
        </div>
      </details>
    </section>
  )
}
