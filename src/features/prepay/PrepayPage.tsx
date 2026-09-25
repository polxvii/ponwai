/**
 * Prepay Planner (spec ข้อ 3.4)
 *
 * 2 มุมมองบน state ชุดเดียวกัน
 *   ปฏิทิน  ตั้งยอด เห็น "รูปร่างของปี" ทั้ง 12 เดือนในจอเดียว
 *   รายการ  ผลลัพธ์จริงรายงวด ค่างวด + โปะ = ยอดจ่าย แยกดอก/ต้น เหลือเท่าไหร่
 *
 * ⛔ สองมุมมองต้องแสดงคนละอย่าง ถ้าแค่จัดเรียงข้อมูลชุดเดิมใหม่ ไม่ต้องมีสองมุมมอง
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildSchedule } from '@engine/schedule.js'
import { findInstallment } from '@engine/rates.js'
import { evaluatePrepayPlan } from '@engine/prepay-roi.js'
import { FIXED_SCALE, toFixed, type Fixed } from '@engine/money.js'
import { month as monthOf, year as yearOf, type ISODate } from '@engine/date.js'
import type { ScheduleRow } from '@engine/types.js'
import { SplitBar } from '@/components/SplitBar'
import { Field, NumberField, SelectField, TextField, DateField } from '@/components/Field'
import { baht, bahtRounded, formatDuration, formatThaiDate, pct } from '@/lib/format'
import { isoDate } from '@engine/date.js'
import { interestUpTo, settledPeriods } from '@/lib/progress'
import {
  getMarginalTaxRateBps, getPlan, savePlan,
  setMarginalTaxRateBps, toLoanTerms, toPaymentEvents,
  type LoanFull, type LoanListItem,
} from '@/lib/db'
import {
  MONTH_NAMES, PRESET_CHIPS,
  amountAt, bumpMonths, clearYearOverride, copyYear, emptyDraft, fromPlan, monthRange,
  baseRepeatsForward, isRepeatedFromBase, newLump, setMonths, toPlan,
  type PrepayDraft,
} from './model'

export type OtherLoan = { loanId: string; rows: readonly ScheduleRow[] }

/** JSON.stringify โยนทิ้งเมื่อเจอ bigint — แผนเก็บยอดเป็น Satang ซึ่งเป็น bigint */
const bigintText = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** null = ยังโหลดไม่เสร็จ ห้ามให้ผู้ใช้แก้ก่อน ไม่งั้นแผนที่โหลดมาทับสิ่งที่เพิ่งพิมพ์ */
  const [planLoaded, setPlanLoaded] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  /** แผนที่เขียนลง DB ไปแล้ว ใช้กันการบันทึกซ้ำโดยไม่มีอะไรเปลี่ยน */
  const lastSaved = useRef<string | null>(null)

  // แผนของสัญญานี้มีอันเดียว เปิดหน้ามาก็เอาอันนั้นมาแก้ต่อเลย ไม่ต้องเลือก
  useEffect(() => {
    let alive = true
    getPlan(item.loanId)
      .then((p) => {
        if (!alive) return
        if (p) {
          setDraft(fromPlan(p))
          lastSaved.current = JSON.stringify(p, bigintText)
        }
        setPlanLoaded(true)
      })
      .catch((e: Error) => {
        if (!alive) return
        setError(e.message)
        setPlanLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [item.loanId])
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

  /**
   * ยอดที่จ่ายเกินค่างวดไปแล้วจริง ของงวดที่เลยวันตัดมาแล้ว
   *
   * ⛔ ต้องแสดงในปฏิทินแบบแก้ไม่ได้ ไม่ใช่ปล่อยว่างเหมือนไม่เคยโปะ
   *    ปฏิทินที่โชว์ "—" ทั้งที่เดือนนั้นโปะไปแล้วจริง ทำให้ผู้ใช้วางแผนซ้ำซ้อน
   *    และตัวเลข "เงินที่โปะรวม" จะไม่ตรงกับที่จ่ายไปจริง
   * ⛔ และต้องแก้ที่นี่ไม่ได้ เพราะของจริงอยู่ที่ยอดชำระจริงของงวดนั้น
   *    ถ้าให้พิมพ์ทับได้ แผนจะขัดกับประวัติการจ่ายโดยไม่มีอะไรเตือน
   */
  const paidExtra = useMemo(() => {
    const out = new Map<string, number>()
    for (const r of baseline.rows) {
      if (r.date > today) break
      const scheduled = toFixed(
        findInstallment(terms.installmentSteps, r.index, terms.installmentSatang),
      )
      // paymentFixed รวม prepay ของงวดนั้นไว้แล้ว จึงหักค่างวดทีเดียวได้ทั้งสองทาง
      // งวดที่ไม่ได้บันทึกค่างวดไว้ ยังต้องจับ "โปะบางส่วน" ที่บันทึกลอย ๆ ให้เจอ
      // ไม่งั้นเดือนที่โปะไป 350,000 จะโชว์ "—" ชวนให้วางแผนโปะทับซ้ำ
      const extra = r.flags.includes('actual_payment') ? r.paymentFixed - scheduled : r.prepayFixed
      if (extra > 0n) out.set(`${yearOf(r.date)}-${monthOf(r.date)}`, Number(extra / FIXED_SCALE) / 100)
    }
    return out
  }, [baseline, terms, today])

  /**
   * เงินที่โปะไปแล้วจริงถึงวันนี้ — ทั้งที่บันทึกเป็น "โปะบางส่วน" และส่วนที่จ่ายเกินค่างวด
   *
   * ⚠️ ไม่ใช่ส่วนหนึ่งของ outcome — ตัวเลขในแผงสรุปเป็น "ส่วนต่างจากเส้นฐาน"
   *    และเส้นฐานนับการจ่ายจริงไว้หมดแล้ว เงินที่โปะไปแล้วจึงหักล้างกันเป็น 0 เสมอ
   *    ถ้าไม่แสดงแยกไว้ ผู้ใช้ที่โปะไป 4 ล้านจะเห็น "เงินที่โปะรวม 0" แล้วนึกว่าแอพไม่นับให้
   */
  /**
   * ค่างวดตามสัญญาของแต่ละเดือน "ปี-เดือน" -> บาท
   *
   * ⚠️ ต้องเป็นค่างวดของงวดนั้นจริง ๆ ไม่ใช่ค่างวดตั้งต้นของสัญญา
   *    สัญญาที่แบ่งช่วงค่างวด ปีโปรกับปีลอยตัวไม่เท่ากัน
   *    คนวางแผนโปะต้องรู้ว่าเดือนนั้นจ่ายเท่าไหร่อยู่แล้ว ถึงจะตัดสินใจได้ว่าโปะเพิ่มไหวแค่ไหน
   */
  const dueByMonth = useMemo(() => {
    const out = new Map<string, number>()
    for (const r of baseline.rows) {
      const pay = findInstallment(terms.installmentSteps, r.index, terms.installmentSatang)
      out.set(`${yearOf(r.date)}-${monthOf(r.date)}`, Number(pay) / 100)
    }
    return out
  }, [baseline, terms])

  const paidExtraTotal = useMemo(
    () => [...paidExtra.values()].reduce((a, b) => a + b, 0),
    [paidExtra],
  )

  /**
   * เงินที่โปะไปแล้วได้อะไรกลับมา
   *
   * ⚠️ คนละฐานกับแผงแผน — แผงแผนตอบว่า "โปะเพิ่มจากนี้แล้วได้อะไร"
   *    เทียบกับการจ่ายต่อแบบที่ทำอยู่ ซึ่งนับเงินที่โปะไปแล้วไว้หมด
   *    อันนี้ตอบคนละข้อ คือ "ที่โปะมาแล้วได้อะไร" เทียบกับจ่ายตามสัญญาเป๊ะ ๆ ไม่โปะเลย
   *    สองข้อนี้ต้องแยกกันบนจอ ไม่งั้นคนที่โปะมา 4.7 ล้านเปิดหน้านี้มาเห็นแต่เลข 0
   */
  /**
   * งวดที่ยังต้องผ่อนจริง ๆ นับจากวันนี้
   *
   * ⛔ rows.length คืออายุสัญญาทั้งเส้น ไม่ใช่ส่วนที่เหลือ
   *    ป้าย "เหลือ 18 ปี 10 เดือน" บนสัญญาที่ผ่อนมาแล้ว 51 งวด เกินจริงไป 4 ปีกว่า
   *    ใช้ settledPeriods ตัวเดียวกับที่หน้าสัญญาใช้ จะได้ไม่ขัดกันเองสองหน้า
   */
  const periodsLeft = useMemo(
    () => withPlan.rows.length - settledPeriods(withPlan.rows, events, today),
    [withPlan, events, today],
  )

  const done = useMemo(() => {
    const contractOnly = buildSchedule(terms)
    const settled = settledPeriods(baseline.rows, events, today)

    // หนี้ที่ยังเหลือเมื่อครบอายุสัญญา ถ้าจ่ายแต่ค่างวด — ใช้แทนตัวเลข "เร็วขึ้น" ที่เทียบไม่ได้
    const atTerm = contractOnly.rows.find((r) => r.index === terms.termMonths)

    /**
     * หนี้ ณ งวดเดียวกัน ถ้าไม่เคยโปะเลย
     *
     * ⚠️ นี่คือคำตอบของ "ที่โปะไปแล้วมีผลแค่ไหน" ที่คำนวณได้เสมอ
     *    เพราะเทียบที่จุดเวลาเดียวกัน ไม่ต้องรอให้ทั้งสองฝั่งมีวันปิดหนี้
     *    ต่างจาก "เร็วขึ้นกี่ปี" ที่ต้องมีวันปิดหนี้ทั้งคู่ถึงจะลบกันได้
     */
    const balanceNowIfNeverPrepaid = contractOnly.rows.find((r) => r.index === settled)
      ?.balanceAfterFixed
    const balanceNowActual = baseline.rows.find((r) => r.index === settled)?.balanceAfterFixed

    return {
      settled,
      interestSavedSoFarFixed: (interestUpTo(contractOnly.rows, settled) -
        interestUpTo(baseline.rows, settled)) as Fixed,

      /* ⛔ แผนฐานชนเพดานจำนวนงวด = จ่ายตามสัญญาแล้วไม่มีวันปิดหนี้
         จำนวนงวดที่เอาไปลบกันจะเป็นค่าของเพดาน ไม่ใช่ของความจริง */
      comparable: contractOnly.paidOff,
      periodsSaved: contractOnly.rows.length - baseline.rows.length,
      interestSavedLifetimeFixed: (contractOnly.totalInterestFixed -
        baseline.totalInterestFixed) as Fixed,
      balanceAtTermFixed: atTerm?.balanceAfterFixed ?? null,

      /**
       * ปิดหนี้ก่อนกำหนดสัญญากี่งวด
       *
       * ⚠️ ใช้เมื่อฝั่ง "จ่ายตามสัญญาอย่างเดียว" ไม่มีวันปิดหนี้ให้เอามาลบ
       *    กำหนด 30 ปีเป็นเส้นตายจริงที่เขียนไว้ในสัญญา ไม่ใช่ค่าที่เราสมมติขึ้น
       *    จึงตอบเป็น "ปี" ได้โดยไม่ต้องเดาวันปิดหนี้ของตารางที่ไม่มีวันจบ
       * ⛔ คนละความหมายกับ periodsSaved ห้ามเอาไปแสดงใต้ป้ายเดียวกัน
       */
      periodsBeforeTerm: baseline.paidOff ? terms.termMonths - baseline.rows.length : null,
      // ดอกเบี้ยต่องวดหลังพ้นโปร เทียบกับค่างวด — สาเหตุที่หนี้ไม่ลด บอกเป็นตัวเลขได้
      interestPerPeriodFixed: atTerm?.interestFixed ?? null,
      installmentAtTermFixed: atTerm
        ? toFixed(findInstallment(terms.installmentSteps, atTerm.index, terms.installmentSatang))
        : null,
      balanceNowIfNeverPrepaidFixed: balanceNowIfNeverPrepaid ?? null,
      debtAvoidedNowFixed:
        balanceNowIfNeverPrepaid !== undefined && balanceNowActual !== undefined
          ? ((balanceNowIfNeverPrepaid - balanceNowActual) as Fixed)
          : null,
    }
  }, [terms, baseline, events, today])

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
    if (selected.length === 0) return
    if (manualAmount === null || Number.isNaN(manualAmount)) return
    applyToSelection(manualAmount)
    setManual('')
  }

  /**
   * เลิกเลือกเดือนแล้วต้องล้างเลขที่พิมพ์ค้างด้วย
   * ไม่งั้นช่องถูก disable ทั้งที่ยังมีเลขอยู่ ผู้ใช้แก้หรือกด Escape ก็ไม่ได้
   */
  useEffect(() => {
    if (selected.length === 0) setManual('')
  }, [selected.length])

  const save = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const plan = toPlan(draft)
      await savePlan(item.loanId, plan)
      lastSaved.current = JSON.stringify(plan, bigintText)
      setSavedAt(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [draft, item.loanId])

  /**
   * บันทึกอัตโนมัติ
   *
   * แผนมีอันเดียวต่อสัญญา การให้กดบันทึกเองจึงไม่ได้ให้ทางเลือกอะไร
   * มีแต่ทำให้คนกรอกยอดเสร็จแล้วปิดหน้าไป โดยที่ตารางผ่อนไม่เคยเห็นแผนนั้น
   *
   * ⛔ ห้ามยิงก่อน planLoaded — draft ตอนนั้นยังว่าง จะเขียนทับแผนจริงที่กำลังโหลดมา
   * ⚠️ เทียบกับที่บันทึกไว้ล่าสุดก่อนเสมอ ไม่งั้นแค่โหลดแผนมาก็ยิงเขียนกลับทันทีหนึ่งรอบ
   *    และ savePlan ลบ scenario เก่าทิ้งทุกครั้ง การเขียนซ้ำ ๆ คือการลบ-สร้างซ้ำ ๆ ด้วย
   */
  useEffect(() => {
    if (!planLoaded) return
    const next = JSON.stringify(toPlan(draft), bigintText)
    if (next === lastSaved.current) return
    const t = setTimeout(() => void save(), 1200)
    return () => clearTimeout(t)
  }, [draft, planLoaded, save])

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
        {paidExtraTotal > 0 && (
          <>
            <div className="mb-5 border-b border-[var(--color-panel-ink-3)]/30 pb-5">
              <p className="mb-3 text-meta text-[var(--color-panel-ink-2)]">
                ผลของเงินที่โปะไปแล้ว
              </p>
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
                <Stat
                  k="โปะไปแล้วจริง"
                  v={Math.round(paidExtraTotal).toLocaleString('en-US')}
                />
                <Stat
                  k="ประหยัดดอกไปแล้ว"
                  v={bahtRounded(done.interestSavedSoFarFixed)}
                  tone="principal"
                  sub={`ใน ${done.settled} งวดที่ผ่านมา`}
                />
                {/* ⛔ "เร็วขึ้นกี่ปี" ต้องมีวันปิดหนี้ทั้งสองฝั่งถึงจะลบกันได้
                    ค่างวดไม่พอปิดหนี้ = ฝั่งสัญญาไม่มีวันจบ ไม่มีเลขให้ลบ
                    แต่คำถามเดิม "ที่โปะไปแล้วมีผลแค่ไหน" ยังตอบได้
                    ถ้าเปลี่ยนหน่วยคำตอบจากปีเป็นหนี้ที่หายไป ณ วันนี้ */}
                {done.comparable && done.periodsSaved > 0 ? (
                  <Stat
                    k="ปิดหนี้เร็วขึ้นแล้ว"
                    v={formatDuration(done.periodsSaved)}
                    sub={`ประหยัดดอกทั้งสัญญา ${bahtRounded(done.interestSavedLifetimeFixed)}`}
                  />
                ) : done.periodsBeforeTerm !== null && done.periodsBeforeTerm > 0 ? (
                  <Stat
                    k="ปิดก่อนครบสัญญา"
                    v={formatDuration(done.periodsBeforeTerm)}
                    {...(done.balanceAtTermFixed === null
                      ? {}
                      : {
                          sub: `ถ้าไม่โปะ ครบ ${formatDuration(terms.termMonths)} ยังเหลือหนี้ ${bahtRounded(done.balanceAtTermFixed)}`,
                        })}
                  />
                ) : (
                  <Stat k="ปิดก่อนครบสัญญา" v="—" sub="ยังไม่มีวันปิดหนี้" />
                )}
              </div>

              {/* ⚠️ ต้องบอกว่าตัวเลขข้างบนเทียบกับอะไร
                  "ปิดก่อนครบสัญญา" เทียบกับกำหนด 30 ปีที่เขียนไว้ในสัญญา
                  ไม่ใช่เทียบกับวันปิดหนี้ของการจ่ายตามค่างวด ซึ่งไม่มี
                  ⛔ ห้ามเขียนว่า "เร็วขึ้นเท่านี้เทียบกับไม่โปะ" — คนละอย่างกัน */}
              {!done.comparable && (
                <p className="mt-3 text-micro text-[var(--color-panel-ink-3)]">
                  {done.interestPerPeriodFixed !== null && done.installmentAtTermFixed !== null && (
                    <>
                      หลังพ้นโปร ดอกเบี้ยงวดละ {bahtRounded(done.interestPerPeriodFixed)} แต่ค่างวดมี{' '}
                      {bahtRounded(done.installmentAtTermFixed)} เงินต้นจึงไม่ถูกตัดเลย{' '}
                    </>
                  )}
                  จ่ายตามค่างวดอย่างเดียวหนี้ไม่ลดไม่ว่าผ่านไปกี่ปี จึงไม่มีวันปิดหนี้ของฝั่งนั้น —
                  ตัวเลขข้างบนเทียบกับกำหนด {formatDuration(terms.termMonths)} ที่เขียนไว้ในสัญญาแทน
                  {' '}ถ้าจริง ๆ ธนาคารขึ้นค่างวดหลังพ้นโปร ใส่ในช่อง
                  &quot;ค่างวดหลังพ้นโปร&quot; ที่หน้าแก้ไขสัญญา แล้วจะเทียบกับวันปิดหนี้จริงได้
                </p>
              )}
            </div>

            <p className="mb-3 text-meta text-[var(--color-panel-ink-2)]">
              ถ้าโปะเพิ่มตามแผนนี้อีก
            </p>
          </>
        )}

        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            k="ปิดหนี้เร็วขึ้นอีก"
            v={
              baseline.paidOff && outcome.periodsSaved > 0
                ? formatDuration(outcome.periodsSaved)
                : '—'
            }
            sub={baseline.paidOff ? `เหลืออีก ${formatDuration(periodsLeft)}` : 'ยังไม่มีวันปิดหนี้'}
          />
          <Stat
            k="ประหยัดดอกเบี้ย"
            v={baseline.paidOff ? bahtRounded(outcome.interestSavedFixed) : '—'}
            tone="principal"
          />
          <Stat
            k="เงินที่จะโปะเพิ่ม"
            v={bahtRounded(outcome.totalPrepaidFixed)}
          />
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

        {/* ⛔ เส้นฐานชนเพดานจำนวนงวด = ผลต่างทุกตัวเทียบกับเพดาน ไม่ใช่กับความจริง
            ปล่อยไว้จะได้ "เร็วขึ้นอีก 82 ปี" ซึ่งไม่มีความหมาย */}
        {!baseline.paidOff && (
          <p className="mt-4 text-micro text-[var(--color-warn)]">
            จ่ายต่อแบบที่ทำอยู่ หนี้ยังไม่มีวันหมด — ยังไม่มีวันปิดหนี้ให้เอามาเทียบว่าเร็วขึ้นเท่าไหร่
            ลองเพิ่มยอดโปะในปฏิทินจนตัวเลขเริ่มขึ้น นั่นคือจุดที่สัญญานี้เริ่มปิดได้
          </p>
        )}

        {baseline.paidOff && outcome.roiBps !== null && (
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

      {/* บอกที่มาของยอดตรงที่ยอดโผล่ ไม่ใช่ปล่อยให้ไปเจอตัวเลือก "ทำซ้ำแบบ" ใต้ปฏิทินเอง */}
      {view === 'calendar' && isRepeatedFromBase(draft, editingYear) && (
        <p className="mt-3 text-meta text-[var(--color-ink-2)]">
          ยอดของปีนี้ทำซ้ำมาจากแผนฐานปี {draft.baseYear + 543} — แก้ตรงนี้ได้
          จะกลายเป็นยอดเฉพาะปีนี้ ถ้าไม่อยากให้ทำซ้ำ เปลี่ยนที่ &quot;ทำซ้ำแบบ&quot; ใต้ปฏิทิน
        </p>
      )}
      {view === 'calendar' && editingYear === draft.baseYear && baseRepeatsForward(draft) && (
        <p className="mt-3 text-meta text-[var(--color-ink-2)]">
          ยอดที่ตั้งในปีนี้คือแผนฐาน จะถูกใช้ซ้ำ
          {draft.repeatMode === 'repeat_forever'
            ? ' ทุกปีจนปิดหนี้'
            : ` ถึงปี ${typeof draft.repeatUntilYear === 'number' ? draft.repeatUntilYear + 543 : '—'}`}{' '}
          — เปลี่ยนได้ที่ &quot;ทำซ้ำแบบ&quot; ใต้ปฏิทิน
        </p>
      )}

      {view === 'calendar' ? (
        <CalendarView
          draft={draft}
          paidExtra={paidExtra}
          dueByMonth={dueByMonth}
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
              /* ต้องมี selected.length เหมือนชิปอื่น ไม่งั้นกดแล้ว applyToSelection
                 return เงียบ ๆ แต่ setManual('') ยังทำงาน = เลขที่พิมพ์หายไปเฉย ๆ */
              disabled={
                selected.length === 0 || manualAmount === null || Number.isNaN(manualAmount)
              }
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

      {/* ---------- สถานะการบันทึก ---------- */}
      <section className="mt-8">
        <h2 className="text-row">แผนโปะของสัญญานี้</h2>
        <p className="mt-1 text-meta text-[var(--color-ink-2)]">
          มีแผนเดียวต่อสัญญา บันทึกให้อัตโนมัติ
          ตารางผ่อนกับสรุปรายปีในหน้าสัญญาจะคิดรวมแผนนี้ให้
        </p>

        <p className="mt-2 text-meta">
          {busy ? (
            <span className="text-[var(--color-ink-2)]">กำลังบันทึก…</span>
          ) : error !== null ? (
            <span className="text-[var(--color-warn)]">
              บันทึกไม่สำเร็จ — {error}{' '}
              <button onClick={() => void save()} className="tap underline">
                ลองอีกครั้ง
              </button>
            </span>
          ) : savedAt !== null ? (
            <span className="text-[var(--color-ok)]">บันทึกแล้ว {savedAt} น.</span>
          ) : (
            <span className="text-[var(--color-ink-3)]">แก้ยอดแล้วระบบบันทึกให้เอง</span>
          )}
        </p>
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
  paidExtra,
  dueByMonth,
  year,
  selected,
  anchor,
  onTap,
  onSetOne,
}: {
  draft: PrepayDraft
  /** "ปี-เดือน" -> ยอดที่จ่ายเกินค่างวดไปแล้วจริง ล็อกไว้แก้ที่นี่ไม่ได้ */
  paidExtra: ReadonlyMap<string, number>
  /** "ปี-เดือน" -> ค่างวดตามสัญญาของงวดนั้น */
  dueByMonth: ReadonlyMap<string, number>
  year: number
  selected: readonly number[]
  anchor: number | null
  onTap: (m: number) => void
  onSetOne: (m: number, v: number) => void
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const doneAt = (m: number) => paidExtra.get(`${year}-${m}`)
  const dueAt = (m: number) => dueByMonth.get(`${year}-${m}`)
  // เดือนที่โปะไปแล้วจริงให้โชว์ยอดจริง ไม่ใช่ยอดที่ตั้งไว้ในแผน
  const values = Array.from({ length: 12 }, (_, i) => doneAt(i + 1) ?? amountAt(draft, year, i + 1))
  const max = Math.max(1, ...values)

  return (
    <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
      {values.map((v, i) => {
        const m = i + 1
        const done = doneAt(m)
        const isSelected = done === undefined && selected.includes(m)
        const isAnchor = done === undefined && anchor === m
        // ยอดที่ต้องโอนจริงของเดือนนั้น = ค่างวด + โปะ ตัวเลขที่ผู้ใช้เอาไปเทียบกับเงินในบัญชี
        const due = dueAt(m)
        const total = due === undefined ? undefined : due + v
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
              onClick={() => done === undefined && onTap(m)}
              className="tap block w-full text-left text-meta text-[var(--color-ink-2)]"
            >
              {MONTH_NAMES[i]}
              {done !== undefined && (
                <span className="ml-1 text-[var(--color-principal-dark)]">จ่ายแล้ว</span>
              )}
              {/* ค่างวดที่ต้องจ่ายอยู่แล้วของเดือนนั้น — ฐานที่ยอดโปะจะไปบวกเพิ่ม */}
              {due !== undefined && (
                <span className="block text-micro text-[var(--color-ink-3)]">
                  ค่างวด {Math.round(due).toLocaleString('en-US')}
                </span>
              )}
            </button>

            {done !== undefined ? (
              <span
                title="ยอดที่จ่ายเกินค่างวดไปแล้วจริง แก้ที่นี่ไม่ได้ — ต้องแก้ที่ยอดชำระจริงของงวดนั้น"
                className="mt-1 block w-full cursor-not-allowed text-right num text-row text-[var(--color-principal-dark)]"
              >
                {done.toLocaleString('en-US')}
              </span>
            ) : editing === m ? (
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

            {/* ยอดที่ต้องโอนจริงเดือนนั้น = ค่างวด + โปะ — เลขที่เอาไปเทียบกับเงินในบัญชีได้ตรง ๆ */}
            {total !== undefined && total > 0 && (
              <span className="mt-1 block text-right text-micro text-[var(--color-ink-3)]">
                รวม {Math.round(total).toLocaleString('en-US')}
              </span>
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
