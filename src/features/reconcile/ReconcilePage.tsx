/**
 * Reconciliation (spec ข้อ 3.3) — ฟีเจอร์ที่แอพอื่นไม่มี
 *
 * เทียบตารางที่เราคำนวณกับใบแจ้งยอดจริง แล้วหาว่าธนาคารใช้วิธีไหน
 *
 * ⛔ inference ต้องทำ 2 ขั้น ห้ามยำรวมเป็น brute force ก้อนเดียว
 *    โยนทุกมิติเข้าไปพร้อมกันได้ 120 แบบ แต่ใบแจ้งยอดมีแค่ 12 แถว
 *    นั่นคือการ fit noise ไม่ใช่ค้นพบความจริง
 *      ขั้น 1  วันตัด  เทียบวันที่ตรงตัว 5 แบบ
 *      ขั้น 2  จำนวนเงิน  ตรึงวันตัดแล้ว brute force 24 แบบ
 *
 * ⛔ ถ้าหลายแบบให้ผลต่างกันไม่ถึง 1 บาท ต้องแสดงทุกตัวพร้อมบอกว่าแยกไม่ออก
 *    ห้ามเลือกให้เงียบ ๆ (ปีปกติ ACT/365F กับ ACT/ACT แยกไม่ออกโดยหลักการ)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildSchedule } from '@engine/schedule.js'
import {
  detectPersistentDrift, inferAmountConventions, inferDateRule, indistinguishableTop,
  reconcile,
  type InferResult, type ReconResult, type ReconZone, type StatementEntry,
} from '@engine/reconcile.js'
import { baht as toSatang, type Satang } from '@engine/money.js'
import { isoDate, type ISODate } from '@engine/date.js'
import { Field, NumberField, TextField, DateField } from '@/components/Field'
import { HolidayCalendar } from '@/components/HolidayCalendar'
import { baht, formatThaiDate } from '@/lib/format'
import { downloadCsv, reconCsv, reportName } from '@/lib/export'
import {
  addBankHoliday, applyDateRule, applyInferredConvention, deleteStatementEntry,
  listBankHolidays, listStatementEntries, toLoanTerms, toPaymentEvents,
  upsertStatementEntries,
  type LoanFull, type LoanListItem,
} from '@/lib/db'

const BASIS_LABEL: Record<string, string> = {
  'ACT/365F': 'ACT/365F หาร 365 ตลอด',
  'ACT/ACT': 'ACT/ACT ปีอธิกสุรทินหาร 366',
  'ACT/365_SKIP': 'ACT/365_SKIP ข้าม 29 ก.พ.',
}
const ROUNDING_LABEL: Record<string, string> = {
  none: 'ไม่ปัด',
  round_satang: 'ปัดครึ่งขึ้นเป็นสตางค์',
  floor_satang: 'ตัดเศษเป็นสตางค์',
  floor_baht: 'ตัดเศษเป็นบาท',
}
const ROLL_LABEL: Record<string, string> = {
  none: 'ตัดวันที่กำหนดเสมอ',
  preceding: 'ตรงวันหยุดขยับมาเร็วขึ้น',
  following: 'ตรงวันหยุดเลื่อนออกไป',
}
const CAL_LABEL: Record<string, string> = {
  weekend_only: 'เสาร์–อาทิตย์',
  weekend_and_bank_holidays: 'เสาร์–อาทิตย์ + วันหยุดธนาคาร',
}

const ZONE_STYLE: Record<ReconZone, string> = {
  green: 'text-[var(--color-ok)]',
  yellow: 'text-[var(--color-principal-text)]',
  red: 'text-[var(--color-warn)]',
}
const ZONE_TEXT: Record<ReconZone, string> = {
  green: 'ตรง',
  yellow: 'ต่างเล็กน้อย',
  red: 'ต่างมาก',
}

type Draft = { stmtDate: ISODate; interest: number | ''; balance: number | '' }

export function ReconcilePage({
  item,
  full,
  today,
  onBack,
  onApplied,
}: {
  item: LoanListItem
  full: LoanFull
  today: ISODate
  onBack: () => void
  onApplied: () => void
}) {
  const [entries, setEntries] = useState<StatementEntry[] | null>(null)
  const [draft, setDraft] = useState<Draft>({ stmtDate: today, interest: '', balance: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [holidays, setHolidays] = useState<{ date: ISODate; name: string | null }[]>([])
  /** ขยับเมื่อปฏิทินวันหยุดเปลี่ยน เพื่อให้โหลดสัญญากับตารางใหม่ */
  const [holidayKey, setHolidayKey] = useState(0)

  const terms = useMemo(() => toLoanTerms(full), [full])
  const events = useMemo(() => toPaymentEvents(full), [full])

  const reload = useCallback(() => {
    listStatementEntries(item.loanId)
      .then(setEntries)
      .catch((e: Error) => setError(e.message))
    listBankHolidays()
      .then(setHolidays)
      .catch(() => undefined)
  }, [item.loanId])

  useEffect(reload, [reload])

  const analysis = useMemo(() => {
    if (!entries || entries.length === 0) return null

    // ขั้น 1 — วันตัด
    const dateRule = inferDateRule(terms, entries)
    // ขั้น 2 — จำนวนเงิน ตรึงวันตัดจากขั้น 1
    const amounts = inferAmountConventions(terms, events, entries, dateRule.best)
    const tied = indistinguishableTop(amounts)

    // ผลปัจจุบันตามที่บันทึกไว้จริง ใช้เทียบว่าที่ค้นพบดีขึ้นจริงไหม
    const current = reconcile(buildSchedule(terms, events).rows, entries)
    const drift = detectPersistentDrift(current)

    return { dateRule, amounts, tied, current, drift }
  }, [entries, terms, events])

  async function addEntry() {
    if (draft.interest === '' && draft.balance === '') {
      return setError('กรอกดอกเบี้ยหรือยอดคงเหลืออย่างน้อยหนึ่งช่อง')
    }
    setBusy(true)
    setError(null)
    try {
      await upsertStatementEntries(item.loanId, [
        {
          stmtDate: draft.stmtDate,
          ...(draft.interest !== '' ? { interestSatang: toSatang(draft.interest) as Satang } : {}),
          ...(draft.balance !== '' ? { balanceSatang: toSatang(draft.balance) as Satang } : {}),
        },
      ])
      setDraft({ stmtDate: draft.stmtDate, interest: '', balance: '' })
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function removeEntry(d: ISODate) {
    setBusy(true)
    try {
      await deleteStatementEntry(item.loanId, d)
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function apply(best: InferResult) {
    if (!analysis) return
    setBusy(true)
    setError(null)
    try {
      await applyDateRule(
        item.loanId,
        analysis.dateRule.best.dateRoll,
        analysis.dateRule.best.rollCalendar,
      )
      await applyInferredConvention(
        item.loanId,
        terms.conventions[0]?.effectiveFrom ?? terms.startDate,
        best.candidate,
        `ค้นพบจากใบแจ้งยอด ${entries?.length ?? 0} งวด คลาดเคลื่อนเฉลี่ย ${(best.maeSatang / 100).toFixed(2)} บาท`,
      )
      setNote('บันทึกแล้ว — ตารางผ่อนจะคิดด้วยวิธีนี้ต่อไป และคำเตือน "ค่าสมมติ" จะหายไป')
      onApplied()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
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
        <h1 className="text-hero">กระทบยอดกับใบแจ้งยอด</h1>
        <p className="mt-1 text-meta text-[var(--color-ink-2)]">
          {item.propertyName} · {item.bankLabel} — กรอกตัวเลขจากใบแจ้งยอดจริง
          แล้วแอพจะหาว่าธนาคารคิดดอกด้วยวิธีไหน
        </p>
      </header>

      {/* ---------- กรอกใบแจ้งยอด ---------- */}
      <section className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-4">
        <h2 className="text-row">เพิ่มงวดจากใบแจ้งยอด</h2>
        <p className="mt-1 text-meta text-[var(--color-ink-2)]">
          ยิ่งกรอกหลายงวดยิ่งแม่น — 12 งวดขึ้นไปจะแยกวิธีคิดได้ชัด
          ใส่แค่ดอกเบี้ยหรือแค่ยอดคงเหลือก็ได้
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Field label="วันที่ในใบแจ้งยอด" hint={formatThaiDate(draft.stmtDate, 'long')}>
            <DateField
              value={draft.stmtDate}
              onChange={(v) => setDraft({ ...draft, stmtDate: isoDate(v) })}
            />
          </Field>
          <Field label="ดอกเบี้ยงวดนั้น" suffix="บาท">
            <NumberField
              value={draft.interest}
              onChange={(v) => setDraft({ ...draft, interest: v })}
            />
          </Field>
          <Field label="ยอดคงเหลือ" suffix="บาท">
            <NumberField
              value={draft.balance}
              onChange={(v) => setDraft({ ...draft, balance: v })}
            />
          </Field>
          <button
            onClick={() => void addEntry()}
            disabled={busy}
            className="tap self-end rounded-md bg-[var(--color-interest)] px-4 py-2.5 text-[var(--color-panel-ink)] disabled:opacity-50"
          >
            เพิ่ม
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-meta text-[var(--color-warn)]">
            {error}
          </p>
        )}
      </section>

      {entries === null && <p className="mt-6 text-[var(--color-ink-2)]">กำลังโหลด…</p>}

      {entries !== null && entries.length === 0 && (
        <p className="mt-6 text-[var(--color-ink-2)]">
          ยังไม่มีข้อมูลใบแจ้งยอด — กรอกงวดแรกด้านบนเพื่อเริ่ม
        </p>
      )}

      {analysis && entries !== null && entries.length > 0 && (
        <>
          {/* ---------- ขั้น 1 ---------- */}
          <section className="mt-8">
            <h2 className="text-row">ขั้นที่ 1 — วันตัดยอด</h2>
            <p className="mt-1 text-meta text-[var(--color-ink-2)]">
              เทียบวันที่ตรงตัว ไม่ใช่ fit ตัวเลข — วันที่ที่ธนาคารแจ้งมาคือความจริงอยู่แล้ว
            </p>

            <p className="mt-3 text-lead">
              {ROLL_LABEL[analysis.dateRule.best.dateRoll]} ·{' '}
              {CAL_LABEL[analysis.dateRule.best.rollCalendar]}
            </p>
            <p className="text-meta text-[var(--color-ink-2)]">
              ตรง {analysis.dateRule.matched} จาก {analysis.dateRule.total} งวด
            </p>

            {analysis.dateRule.unmatchedDates.length > 0 && (
              <p className="mt-2 rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-meta text-[var(--color-warn)]">
                ไม่มีกฎไหนอธิบาย {analysis.dateRule.unmatchedDates.length} งวดนี้ได้:{' '}
                {analysis.dateRule.unmatchedDates.map((d) => formatThaiDate(d)).join(', ')} —
                น่าจะเป็นวันหยุดพิเศษที่ประกาศกะทันหัน ใส่ไว้ในปฏิทินวันหยุดด้านล่าง
                หรือแก้วันตัดของงวดนั้นเป็นรายงวด
              </p>
            )}
          </section>

          {/* ---------- ขั้น 2 ---------- */}
          <section className="mt-8">
            <h2 className="text-row">ขั้นที่ 2 — วิธีคิดจำนวนเงิน</h2>
            <p className="mt-1 text-meta text-[var(--color-ink-2)]">
              ตรึงวันตัดจากขั้นที่ 1 แล้วลอง 24 แบบ หาแบบที่คลาดเคลื่อนน้อยที่สุด
            </p>

            {analysis.tied.length > 1 && (
              <p className="mt-3 rounded-md bg-[var(--color-interest-tint)] px-3 py-2 text-meta text-[var(--color-ink-2)]">
                มี {analysis.tied.length} แบบที่ให้ผลต่างกันไม่ถึง 1 บาท —
                ข้อมูลเท่าที่มีแยกไม่ออก เลือกแบบไหนก็ได้ผลเหมือนกันในทางปฏิบัติ
                กรอกใบแจ้งยอดเพิ่มถ้าอยากรู้ให้แน่
              </p>
            )}

            <ul className="mt-3 space-y-2">
              {analysis.tied.map((r, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-3"
                >
                  <span>
                    <span className="block">
                      {BASIS_LABEL[r.candidate.dayCountBasis]} ·{' '}
                      {ROUNDING_LABEL[r.candidate.rounding]}
                      {r.candidate.capitaliseUnpaidInterest && ' · ทบดอกค้างเข้าต้น'}
                    </span>
                    <span className="block text-meta text-[var(--color-ink-2)]">
                      คลาดเคลื่อนเฉลี่ย {(r.maeSatang / 100).toFixed(2)} บาทต่องวด ·{' '}
                      <span className={ZONE_STYLE[r.worstZone]}>
                        งวดที่แย่ที่สุด {ZONE_TEXT[r.worstZone]}
                      </span>
                    </span>
                  </span>
                  <button
                    onClick={() => void apply(r)}
                    disabled={busy}
                    className="tap shrink-0 rounded-md border border-[var(--color-interest)] px-3 py-2 text-meta text-[var(--color-interest)] disabled:opacity-50"
                  >
                    ใช้แบบนี้
                  </button>
                </li>
              ))}
            </ul>

            {note && (
              <p className="mt-3 rounded-md bg-[var(--color-ok)]/10 px-3 py-2 text-meta text-[var(--color-ok)]">
                {note}
              </p>
            )}
          </section>

          {/* ---------- ผลเทียบรายงวด ---------- */}
          <section className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-row">เทียบรายงวดด้วยค่าที่ใช้อยู่ตอนนี้</h2>
              <button
                onClick={() =>
                  downloadCsv(
                    reportName(item.propertyName, 'reconcile', today),
                    reconCsv(analysis.current),
                  )
                }
                className="tap text-meta text-[var(--color-interest)] hover:underline"
              >
                ส่งออก CSV
              </button>
            </div>

            {analysis.drift.detected && (
              <p className="mt-2 rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-meta text-[var(--color-warn)]">
                ⚠️ คลาดเคลื่อนไปทางเดียวกันติดกัน {analysis.drift.runLength} งวด (
                {analysis.drift.direction === 'we_higher'
                  ? 'เราคิดมากกว่าธนาคาร'
                  : 'เราคิดน้อยกว่าธนาคาร'}
                ) — ไม่ใช่เรื่องปัดเศษ แต่เป็นวิธีคิดที่ต่างกันอย่างเป็นระบบ
                {analysis.drift.hint !== null && ` · ${analysis.drift.hint}`}
              </p>
            )}

            <ReconTable results={analysis.current} />
          </section>
        </>
      )}

      {/* ---------- รายการใบแจ้งยอด ---------- */}
      {entries !== null && entries.length > 0 && (
        <section className="mt-8">
          <h2 className="text-row">ใบแจ้งยอดที่กรอกไว้ ({entries.length})</h2>
          <ul className="mt-2 divide-y divide-[var(--color-rule)]">
            {entries.map((e) => (
              <li key={e.stmtDate} className="flex items-center justify-between gap-4 py-2">
                <span className="text-meta">
                  {formatThaiDate(e.stmtDate)}
                  {e.interestSatang !== undefined && ` · ดอก ${baht(e.interestSatang)}`}
                  {e.balanceSatang !== undefined && ` · เหลือ ${baht(e.balanceSatang)}`}
                </span>
                <button
                  onClick={() => void removeEntry(e.stmtDate)}
                  disabled={busy}
                  className="tap text-meta text-[var(--color-ink-3)] hover:text-[var(--color-warn)] disabled:opacity-50"
                >
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- ปฏิทินวันหยุดธนาคาร ---------- */}
      <section className="mt-8 rounded-lg border border-[var(--color-rule)] p-4">
        <h2 className="mb-1 text-row">ปฏิทินวันหยุดธนาคาร</h2>
        {/* โหลดตารางใหม่ทุกครั้งที่ปฏิทินเปลี่ยน — วันหยุดเปลี่ยนวันตัดงวด
            ถ้าไม่รีโหลด ผู้ใช้จะติ๊กแล้วเห็นตารางเดิมแล้วนึกว่าไม่มีผล */}
        <HolidayCalendar onChanged={() => setHolidayKey((k: number) => k + 1)} />
      </section>
    </div>
  )
}

function ReconTable({ results }: { results: readonly ReconResult[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-meta">
        <thead>
          <tr className="border-b border-[var(--color-rule)] text-left">
            <th className="py-2 pr-4 font-medium text-[var(--color-ink-2)]">วันที่</th>
            <th className="py-2 pr-4 text-right font-medium text-[var(--color-ink-2)]">งวด</th>
            <th className="py-2 pr-4 text-right font-medium text-[var(--color-ink-2)]">
              Δ ดอกเบี้ย
            </th>
            <th className="py-2 pr-4 text-right font-medium text-[var(--color-ink-2)]">
              Δ คงเหลือ
            </th>
            <th className="py-2 font-medium text-[var(--color-ink-2)]">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.stmtDate} className="border-b border-[var(--color-rule)]">
              <td className="py-2 pr-4">{formatThaiDate(r.stmtDate)}</td>
              <td className="py-2 pr-4 text-right num">{r.periodIndex ?? '—'}</td>
              <td className="py-2 pr-4 text-right num">
                {r.interestDeltaSatang === null ? '—' : signed(r.interestDeltaSatang)}
              </td>
              <td className="py-2 pr-4 text-right num">
                {r.balanceDeltaSatang === null ? '—' : signed(r.balanceDeltaSatang)}
              </td>
              <td className={`py-2 ${ZONE_STYLE[r.zone]}`}>
                {r.matched ? ZONE_TEXT[r.zone] : 'ไม่มีงวดตรงวันนี้'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-micro text-[var(--color-ink-3)]">
        Δ เป็นบวก = เราคำนวณได้มากกว่าที่ธนาคารแจ้ง · ต่างไม่เกิน 1 บาทถือว่าตรง
        (เป็นเรื่องปัดเศษ) · เกิน 50 บาทคือวิธีคิดต่างกันจริง
      </p>
    </div>
  )
}

function signed(v: bigint): string {
  const s = baht(v as Satang)
  return v > 0n ? `+${s}` : s
}
