import { useMemo } from 'react'
import { rankOffers, sensitivityBand, findRankFlips } from '@engine/compare.js'
import { baht as toSatang } from '@engine/money.js'
import { Field, NumberField, SelectField, TextField, Toggle } from '@/components/Field'
import { formatDuration } from '@/lib/format'
import { useLocalState } from '@/lib/persist'
import { ResultsTable } from './ResultsTable'
import { CostCurveChart, SensitivityBand } from './CostCurveChart'
import {
  BANK_OPTIONS, DEFAULT_COMMON, DEFAULT_DRAFTS, MAX_OFFERS, MIN_OFFERS, OTHER_BANK,
  emptyDraft, nextBankCode, offerLabel, promoYears, toLoanOffer, assessCompleteness,
  reviveCommon, reviveDrafts,
  type OfferDraft, type CommonTerms,
} from './model'

const HORIZON = 36

export function ComparePage() {
  const [common, setCommon, resetCommon] = useLocalState<CommonTerms>(
    'compare:common', DEFAULT_COMMON, reviveCommon,
  )
  const [drafts, setDrafts, resetDrafts] = useLocalState<OfferDraft[]>(
    'compare:offers', DEFAULT_DRAFTS, reviveDrafts,
  )

  // Equal-Payment Mode — ฟีเจอร์หลักที่ทำให้แอพนี้ต่าง (ข้อ 2.2)
  const [equalPayment, setEqualPayment, resetEqual] = useLocalState('compare:equalPayment', true)
  const [lockedPayment, setLockedPayment, resetLocked] = useLocalState<number | ''>(
    'compare:lockedPayment', 20_000,
  )

  /** ล็อกจริงเมื่อเปิดสวิตช์ "และ" มีตัวเลขที่ใช้ได้ — ไม่งั้นค่างวดของแต่ละข้อเสนอยังมีผล */
  const locked =
    equalPayment && typeof lockedPayment === 'number' && lockedPayment > 0 ? lockedPayment : null

  const update = (id: string, patch: Partial<OfferDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)))

  const addOffer = () =>
    setDrafts((ds) => {
      if (ds.length >= MAX_OFFERS) return ds
      const code = nextBankCode(ds.map((d) => d.bankCode))
      // id ต้องไม่ซ้ำตลอดอายุของ list ใช้เวลาเป็นฐาน ไม่ใช่ ds.length ที่ชนกันได้หลังลบ
      return [...ds, emptyDraft(`o${Date.now().toString(36)}`, code)]
    })

  const removeOffer = (id: string) =>
    setDrafts((ds) => (ds.length <= MIN_OFFERS ? ds : ds.filter((d) => d.id !== id)))

  const resetAll = () => {
    resetCommon()
    resetDrafts()
    resetEqual()
    resetLocked()
  }

  /** ตาราง/กราฟ รู้จักข้อเสนอด้วย id ไม่ใช่รหัสธนาคาร — แปลงกลับเป็นชื่อที่ตรงนี้ */
  const nameOf = useMemo(() => {
    const map = new Map(drafts.map((d) => [d.id, offerLabel(d)]))
    return (key: string) => map.get(key) ?? key
  }, [drafts])

  const { ranked, bands, flips, error } = useMemo(() => {
    try {
      const offers = drafts.map((d) => toLoanOffer(d, common))
      const ready = drafts.every((d) => assessCompleteness(d, common, locked !== null).ready)
      if (!ready) return { ranked: [], bands: [], flips: [], error: null }

      const opts =
        locked !== null
          ? { equalPaymentSatang: toSatang(locked), horizonMonths: HORIZON }
          : { horizonMonths: HORIZON }

      const ranked = rankOffers(offers, opts)
      const bands = sensitivityBand(offers, [-50, 0, 50, 100], opts)
      return { ranked, bands, flips: findRankFlips(bands), error: null }
    } catch (e) {
      return { ranked: [], bands: [], flips: [], error: (e as Error).message }
    }
  }, [drafts, common, locked])

  /** จำนวนงวดที่จะผ่อนจริงของแต่ละข้อเสนอ — ไม่เท่ากับเทอมตามสัญญาถ้าจ่ายเกินค่างวด */
  const actualMonths = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of ranked) if (r.feasible) m.set(r.bankCode, r.totalPeriods)
    return m
  }, [ranked])

  const missing = drafts.flatMap((d) =>
    assessCompleteness(d, common, locked !== null).missing.map((m) => ({
      ...m,
      bank: offerLabel(d),
    })),
  )

  return (
    // ⛔ ห้ามครอบ max-width แบบมือถือที่ระดับบนสุด (ข้อ 5A.1)
    //    max-width ของ content อยู่ที่ 1440 ไม่ใช่ 480
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[var(--text-hero)]">เปรียบเทียบข้อเสนอ</h1>
          <p className="mt-1 text-[var(--text-meta)] text-[var(--color-ink-2)]">
            จ่ายเท่ากันทุกธนาคาร แล้วดูว่าใครทำให้หนี้เหลือน้อยกว่า
          </p>
        </div>
        <button
          onClick={resetAll}
          className="tap shrink-0 text-[var(--text-meta)] text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)] hover:underline"
        >
          เริ่มใหม่
        </button>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-10">
        {/* ---------- ฝั่งกรอก ---------- */}
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-[var(--text-row)]">เงื่อนไขร่วม</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="วงเงินกู้" suffix="บาท">
                <NumberField
                  value={common.loanAmount}
                  onChange={(v) => setCommon({ ...common, loanAmount: v })}
                />
              </Field>
              <Field label="ระยะเวลา" suffix="ปี">
                <NumberField
                  value={common.termYears}
                  max={40}
                  onChange={(v) => setCommon({ ...common, termYears: typeof v === 'number' ? v : 30 })}
                />
              </Field>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--color-rule)] p-3">
            <Toggle
              checked={equalPayment}
              onChange={setEqualPayment}
              label="ล็อกค่างวดให้เท่ากันทุกธนาคาร"
              hint="ถ้าค่างวดไม่เท่ากัน คือการเทียบกระแสเงินสดคนละชุด ผลลัพธ์จะไม่มีความหมาย"
            />
            {equalPayment && (
              <div className="mt-2">
                <Field
                  label="ค่างวดที่จะจ่ายจริงต่อเดือน"
                  suffix="บาท"
                  hint="ตัวเลขนี้เป็นตัวขับการคำนวณทั้งหมด ค่างวดในใบเสนอของแต่ละธนาคารจะกลายเป็นข้อมูลอ้างอิง"
                >
                  <NumberField value={lockedPayment} onChange={setLockedPayment} />
                </Field>
              </div>
            )}
          </section>

          {drafts.map((d, i) => (
            <OfferForm
              key={d.id}
              index={i}
              draft={d}
              termYears={common.termYears}
              actualMonths={actualMonths.get(d.id) ?? null}
              lockedPayment={locked}
              onChange={(p) => update(d.id, p)}
              {...(drafts.length > MIN_OFFERS ? { onRemove: () => removeOffer(d.id) } : {})}
            />
          ))}

          {drafts.length < MAX_OFFERS ? (
            <button
              onClick={addOffer}
              className="tap w-full rounded-lg border border-dashed border-[var(--color-rule)] py-3 text-[var(--color-interest)] hover:border-[var(--color-interest)] hover:bg-[var(--color-interest-tint)]"
            >
              + เพิ่มธนาคาร
            </button>
          ) : (
            <p className="text-center text-[var(--text-meta)] text-[var(--color-ink-3)]">
              เทียบพร้อมกันได้สูงสุด {MAX_OFFERS} ธนาคาร
            </p>
          )}
        </div>

        {/* ---------- ฝั่งผลลัพธ์ ---------- */}
        <div>
          {error && (
            <p className="rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-[var(--text-meta)] text-[var(--color-warn)]">
              {error}
            </p>
          )}

          {ranked.length === 0 && !error && (
            <p className="text-[var(--color-ink-2)]">
              กรอกเรตและค่างวดให้ครบอย่างน้อย 1 ปี แล้วผลลัพธ์จะขึ้นทันที
            </p>
          )}

          {ranked.length > 0 && (
            <>
              <ResultsTable ranked={ranked} horizonMonths={HORIZON} nameOf={nameOf} />

              {/* ให้ผลลัพธ์ตั้งแต่ยังกรอกไม่ครบ พร้อมบอกว่าที่ขาดกระทบเท่าไหร่ (ข้อ 5A.3) */}
              {missing.length > 0 && (
                <aside className="mt-6 rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-4">
                  <h3 className="text-[var(--text-meta)] font-medium">ยังกรอกไม่ครบ</h3>
                  <ul className="mt-2 space-y-1 text-[var(--text-meta)] text-[var(--color-ink-2)]">
                    {missing.slice(0, 5).map((m, i) => (
                      <li key={i}>
                        {m.bank} · {m.label} — {m.impact}
                      </li>
                    ))}
                  </ul>
                </aside>
              )}

              <CostCurveChart ranked={ranked} nameOf={nameOf} />
              <SensitivityBand bands={bands} flips={flips} nameOf={nameOf} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function OfferForm({
  index,
  draft,
  termYears,
  actualMonths,
  lockedPayment,
  onChange,
  onRemove,
}: {
  index: number
  draft: OfferDraft
  termYears: number
  /** จำนวนงวดที่จะผ่อนจริงตามตาราง null = ยังคำนวณไม่ได้ */
  actualMonths: number | null
  /** ไม่ null = ล็อกค่างวดอยู่ ค่างวดในช่องนี้จะไม่ถูกใช้คำนวณ */
  lockedPayment: number | null
  onChange: (patch: Partial<OfferDraft>) => void
  onRemove?: () => void
}) {
  const setRate = (i: number, v: number | '') => {
    const next = [...draft.promoRates]
    next[i] = v
    onChange({ promoRates: next })
  }


  return (
    <section className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[var(--text-micro)] text-[var(--color-ink-3)]">
          ข้อเสนอที่ {index + 1}
        </span>
        {onRemove && (
          <button
            onClick={onRemove}
            aria-label={`ลบข้อเสนอที่ ${index + 1}`}
            className="tap text-[var(--text-meta)] text-[var(--color-ink-3)] hover:text-[var(--color-warn)]"
          >
            ลบ
          </button>
        )}
      </div>

      <Field label="ธนาคาร">
        <SelectField
          value={draft.bankCode}
          onChange={(v) => onChange({ bankCode: v })}
          options={BANK_OPTIONS}
        />
      </Field>

      {draft.bankCode === OTHER_BANK && (
        <div className="mt-3">
          <Field label="ชื่อผู้ให้กู้" hint="ใช้ชื่อนี้ในตารางและกราฟ">
            <TextField
              value={draft.customName}
              onChange={(v) => onChange({ customName: v })}
              placeholder="เช่น สหกรณ์ออมทรัพย์ครู"
            />
          </Field>
        </div>
      )}

      {/* กรอกเรตเป็น "ปีที่" ไม่ใช่ from_month/to_month (ข้อ 5A.3 วิธีที่ 2) */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {draft.promoRates.map((r, i) => (
          <Field key={i} label={`ปีที่ ${i + 1}`} suffix="%">
            <NumberField value={r} onChange={(v) => setRate(i, v)} />
          </Field>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field
          label="หลังพ้นโปร"
          suffix="%"
          hint={floatingHint(termYears, promoYears(draft), actualMonths)}
        >
          <NumberField value={draft.floatingRate} onChange={(v) => onChange({ floatingRate: v })} />
        </Field>
        <Field
          label={lockedPayment === null ? 'ค่างวดที่จะจ่าย' : 'ค่างวดจากใบเสนอ'}
          suffix="บาท"
          hint={quoteHint(draft.installment, lockedPayment)}
        >
          <NumberField value={draft.installment} onChange={(v) => onChange({ installment: v })} />
        </Field>
      </div>

      <details className="mt-3">
        <summary className="tap cursor-pointer text-[var(--text-meta)] text-[var(--color-ink-2)]">
          ค่าธรรมเนียมและประกัน
        </summary>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="ค่าจดจำนอง" suffix="%">
              <NumberField
                value={draft.mortgageFeePct}
                onChange={(v) => onChange({ mortgageFeePct: v })}
              />
            </Field>
            <Field label="ฟรีสูงสุด" suffix="บาท" hint="เว้นว่าง = ไม่ฟรี">
              <NumberField
                value={draft.mortgageFeeWaivedCap}
                onChange={(v) => onChange({ mortgageFeeWaivedCap: v })}
              />
            </Field>
            <Field label="ค่าประเมิน" suffix="บาท">
              <NumberField value={draft.appraisalFee} onChange={(v) => onChange({ appraisalFee: v })} />
            </Field>
            <Field label="ค่าธรรมเนียมอื่น" suffix="บาท">
              <NumberField value={draft.otherFee} onChange={(v) => onChange({ otherFee: v })} />
            </Field>
          </div>

          <Toggle
            checked={draft.stampDuty}
            onChange={(v) => onChange({ stampDuty: v })}
            label="มีอากรแสตมป์ 0.05%"
            hint="เพดาน 10,000 บาทตามกฎหมาย"
          />

          <div className="grid grid-cols-2 gap-3">
            <Field label="เบี้ย MRTA" suffix="บาท">
              <NumberField value={draft.mrtaPremium} onChange={(v) => onChange({ mrtaPremium: v })} />
            </Field>
            <Field label="เบี้ยอัคคีภัย" suffix="บาท" hint={`ต่อ ${draft.fireTermYears} ปี`}>
              <NumberField value={draft.firePremium} onChange={(v) => onChange({ firePremium: v })} />
            </Field>
          </div>

          <Toggle
            checked={draft.mrtaFinanced}
            onChange={(v) => onChange({ mrtaFinanced: v })}
            label="รวมเบี้ย MRTA ในวงเงินกู้"
            hint="ถ้ารวม ต้นทุนจริงจะสูงกว่าเบี้ยที่เห็นมาก เพราะต้องเสียดอกเบี้ยของเบี้ยด้วย"
          />
        </div>
      </details>
    </section>
  )
}

/**
 * ตอนล็อกค่างวด ช่องนี้ไม่ถูกใช้คำนวณ ต้องบอกตรง ๆ ไม่ใช่ปล่อยให้พิมพ์แล้วผลไม่ขยับ
 * ส่วนต่างเป็นข้อมูลที่มีประโยชน์เอง เพราะการจ่ายเกินค่างวดคือกลยุทธ์หลักของแอพนี้
 */
function quoteHint(quoted: number | '', locked: number | null): string | undefined {
  if (locked === null) return undefined
  if (typeof quoted !== 'number' || quoted <= 0) {
    return `ไม่ถูกใช้คำนวณ เพราะล็อกค่างวดไว้ที่ ${locked.toLocaleString('en-US')}`
  }
  const diff = locked - quoted
  if (diff === 0) return 'เท่ากับค่างวดที่ล็อกไว้'
  const amount = Math.abs(diff).toLocaleString('en-US')
  return diff > 0
    ? `คุณจะจ่าย ${locked.toLocaleString('en-US')} มากกว่าใบเสนอ ${amount} — ส่วนเกินลดเงินต้นทั้งก้อน`
    : `คุณจะจ่าย ${locked.toLocaleString('en-US')} ต่ำกว่าใบเสนอ ${amount} — ธนาคารอาจไม่ยอม`
}

/**
 * เรตลอยตัวกินเวลาเท่าไหร่
 *
 * ⛔ ห้ามอ้างเทอมตามสัญญาเพียว ๆ — จ่ายเกินค่างวดแล้วหนี้ปิดเร็วกว่ามาก
 *    เช่น สัญญา 30 ปีแต่จ่าย 40,000 ปิดใน 8 ปี เรตลอยตัวกินแค่ 5 ปี ไม่ใช่ 27
 *    ตัวเลขที่เกินจริงทำให้ผู้ใช้กลัวเรตลอยตัวมากกว่าที่ควร
 */
function floatingHint(termYears: number, promo: number, actualMonths: number | null): string {
  if (actualMonths === null) {
    const left = Math.max(0, termYears - promo)
    return left > 0 ? `ตามสัญญากินเวลา ${left} ปีจาก ${termYears}` : 'สัญญาจบก่อนพ้นโปร'
  }
  const floatMonths = actualMonths - promo * 12
  if (floatMonths <= 0) {
    return `ปิดหนี้ใน ${formatDuration(actualMonths)} ยังไม่พ้นโปร อัตรานี้ไม่ถูกใช้`
  }
  return `กินเวลา ${formatDuration(floatMonths)} จากที่ผ่อนจริง ${formatDuration(actualMonths)}`
}
