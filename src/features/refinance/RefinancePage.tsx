/**
 * Refinance Mode (spec ข้อ 2A)
 *
 * โหมดหลักเท่ากับ Compare ไม่ใช่ feature ย่อย เพราะผู้ใช้กลับมาใช้ทุก 3 ปีตลอดอายุสัญญา
 * ⛔ ห้ามตัด "ไม่ทำอะไร" ออกจากตาราง — เป็น baseline เดียวที่บอกได้ว่าย้ายแล้วคุ้มจริงไหม
 */

import { useMemo, useState } from 'react'
import { compareRefinanceOptions, recommend, type RefinanceOutcome } from '@engine/refinance.js'
import type { Satang } from '@engine/money.js'
import { isoDate } from '@engine/date.js'
import { Field, NumberField, SelectField, Toggle, DateField } from '@/components/Field'
import { baht, bahtRounded, formatDuration, formatThaiDate } from '@/lib/format'
import { BANK_PRESETS } from '../compare/model'
import { InterestCurveChart } from './InterestCurveChart'
import {
  DEFAULT_CURRENT, DEFAULT_RETENTION, DEFAULT_REFI,
  buildScenarios, contextOf, penaltyOf, refiMovingCost, refiReady,
  type CurrentLoan, type RetentionDraft, type RefiDraft,
} from './model'

export function RefinancePage() {
  const [current, setCurrent] = useState<CurrentLoan>(DEFAULT_CURRENT)
  const [retention, setRetention] = useState<RetentionDraft>(DEFAULT_RETENTION)
  const [refi, setRefi] = useState<RefiDraft>(DEFAULT_REFI)

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

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-[var(--text-hero)]">รีไฟแนนซ์คุ้มไหม</h1>
        <p className="mt-1 text-[var(--text-meta)] text-[var(--color-ink-2)]">
          เทียบ 3 ทางพร้อมกันเสมอ — อยู่เฉย ๆ / ขอลดดอกกับธนาคารเดิม / ย้ายธนาคาร
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-10">
        <div className="space-y-6">
          <CurrentLoanForm
            value={current}
            onChange={(p) => setCurrent({ ...current, ...p })}
            penalty={penalty}
          />
          <RetentionForm value={retention} onChange={(p) => setRetention({ ...retention, ...p })} />
          <RefiForm value={refi} onChange={(p) => setRefi({ ...refi, ...p })} movingCost={moving} />
        </div>

        <div>
          {error && (
            <p className="rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-[var(--text-meta)] text-[var(--color-warn)]">
              {error}
            </p>
          )}

          {outcomes.length === 0 && !error && (
            <p className="text-[var(--color-ink-2)]">
              กรอกยอดหนี้คงเหลือ ค่างวด และเรตที่จ่ายอยู่ แล้วผลลัพธ์จะขึ้นทันที
            </p>
          )}

          {outcomes.length > 0 && (
            <>
              {best && <Verdict best={best} outcomes={outcomes} />}

              {warnings.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {warnings.map((w, i) => (
                    <li
                      key={i}
                      className="rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-[var(--text-meta)] text-[var(--color-warn)]"
                    >
                      ⚠️ {w}
                    </li>
                  ))}
                </ul>
              )}

              <OutcomeTable outcomes={outcomes} best={best} />
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
      <p className="text-[var(--text-meta)] text-[var(--color-panel-ink-2)]">ทางที่ถูกที่สุด</p>
      <h2 className="mt-1 text-[var(--text-lead)]">{best.label}</h2>

      {best.kind === 'stay' ? (
        <p className="mt-3 text-[var(--text-meta)] text-[var(--color-panel-ink-2)]">
          ยังไม่มีข้อเสนอไหนคุ้มกว่าการอยู่เฉย ๆ
        </p>
      ) : (
        <p className="mt-3 num text-[var(--text-figure)] text-[var(--color-principal-dark)]">
          ประหยัดดอกเบี้ย {bahtRounded(best.interestSavedVsStayFixed)} บาท
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-[var(--text-meta)]">
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
      <table className="w-full min-w-[680px] border-collapse text-[var(--text-row)]">
        <thead>
          <tr className="border-b border-[var(--color-rule)] text-left">
            <th className="py-3 pr-4 text-[var(--text-meta)] font-medium text-[var(--color-ink-2)]">
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
                  o.costsMoreThanStaying ? 'opacity-70' : ''
                }`}
              >
                <td className="py-3 pr-4">
                  <span className={isBest ? 'font-medium' : ''}>{o.label}</span>
                  {isBest && (
                    <span className="ml-2 rounded-sm bg-[var(--color-principal-tint)] px-1.5 py-0.5 text-[var(--text-micro)] text-[var(--color-principal-text)]">
                      ถูกที่สุด
                    </span>
                  )}
                </td>
                <Td>{baht(o.installmentSatang, 0)}</Td>
                <Td>{bahtRounded(o.futureInterestFixed)}</Td>
                <Td>{o.kind === 'stay' ? '—' : baht(o.movingCostSatang, 0)}</Td>
                <Td
                  tone={
                    o.kind === 'stay' ? undefined : o.interestSavedVsStayFixed < 0n ? 'warn' : 'ok'
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
      className="py-3 pr-4 text-right text-[var(--text-meta)] font-medium text-[var(--color-ink-2)]"
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

function CurrentLoanForm({
  value: c,
  onChange,
  penalty,
}: {
  value: CurrentLoan
  onChange: (p: Partial<CurrentLoan>) => void
  penalty: Satang
}) {
  return (
    <section>
      <h2 className="mb-3 text-[var(--text-row)]">หนี้ที่ผ่อนอยู่</h2>
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
            onChange={(v) => onChange({ remainingMonths: typeof v === 'number' ? v : 0 })}
          />
        </Field>
        <Field label="วันที่พิจารณา" hint={formatThaiDate(c.asOf, 'long')}>
          <DateField value={c.asOf} onChange={(v) => onChange({ asOf: isoDate(v) })} />
        </Field>
        <Field label="วันตัดรอบ" suffix="ของเดือน">
          <NumberField
            value={c.dueDayOfMonth}
            max={31}
            onChange={(v) => onChange({ dueDayOfMonth: typeof v === 'number' ? v : 1 })}
          />
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="lock-in เดิมเหลือ" suffix="เดือน" hint="0 = พ้นแล้ว ไถ่ถอนได้ฟรี">
          <NumberField
            value={c.lockinLeftMonths}
            max={120}
            onChange={(v) => onChange({ lockinLeftMonths: typeof v === 'number' ? v : 0 })}
          />
        </Field>
        <Field
          label="ค่าปรับไถ่ถอน"
          suffix="%"
          hint={
            penalty > 0n
              ? `คิดเป็น ${baht(penalty, 0)} บาท`
              : 'ไม่ถูกเก็บ เพราะพ้น lock-in แล้ว'
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
          options={BANK_PRESETS.map((b) => ({
            value: b.code,
            label: b.isSfi ? `${b.nameTh} (รัฐ)` : b.nameTh,
          }))}
        />
      </Field>

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
            onChange={(v) => onChange({ termYears: typeof v === 'number' ? v : 30 })}
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
        <summary className="tap cursor-pointer text-[var(--text-meta)] text-[var(--color-ink-2)]">
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
