import { useMemo, useState } from 'react'
import { rankOffers, sensitivityBand, findRankFlips } from '@engine/compare.js'
import { baht as toSatang } from '@engine/money.js'
import { Field, NumberField, SelectField, Toggle } from '@/components/Field'
import { ResultsTable } from './ResultsTable'
import { CostCurveChart, SensitivityBand } from './CostCurveChart'
import {
  BANK_PRESETS, DEFAULT_COMMON, emptyDraft, toLoanOffer, assessCompleteness, bankName,
  type OfferDraft, type CommonTerms,
} from './model'

const HORIZON = 36

export function ComparePage() {
  const [common, setCommon] = useState<CommonTerms>(DEFAULT_COMMON)
  const [drafts, setDrafts] = useState<OfferDraft[]>([
    { ...emptyDraft('a', 'KBANK'), promoRates: [2.5, 3.25, 3.75], floatingRate: 5.5, installment: 20_000, appraisalFee: 3_000 },
    { ...emptyDraft('b', 'SCB'),   promoRates: [2.9, 2.9, 3.4],   floatingRate: 5.3, installment: 20_000, appraisalFee: 3_000, otherFee: 9_000 },
  ])

  // Equal-Payment Mode — ฟีเจอร์หลักที่ทำให้แอพนี้ต่าง (ข้อ 2.2)
  const [equalPayment, setEqualPayment] = useState(true)
  const [lockedPayment, setLockedPayment] = useState<number | ''>(20_000)

  const update = (id: string, patch: Partial<OfferDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)))

  const { ranked, bands, flips, error } = useMemo(() => {
    try {
      const offers = drafts.map((d) => toLoanOffer(d, common))
      const ready = drafts.every((d) => assessCompleteness(d, common).ready)
      if (!ready) return { ranked: [], bands: [], flips: [], error: null }

      const opts =
        equalPayment && typeof lockedPayment === 'number' && lockedPayment > 0
          ? { equalPaymentSatang: toSatang(lockedPayment), horizonMonths: HORIZON }
          : { horizonMonths: HORIZON }

      const ranked = rankOffers(offers, opts)
      const bands = sensitivityBand(offers, [-50, 0, 50, 100], opts)
      return { ranked, bands, flips: findRankFlips(bands), error: null }
    } catch (e) {
      return { ranked: [], bands: [], flips: [], error: (e as Error).message }
    }
  }, [drafts, common, equalPayment, lockedPayment])

  const missing = drafts.flatMap((d) =>
    assessCompleteness(d, common).missing.map((m) => ({ ...m, bank: bankName(d.bankCode) })),
  )

  return (
    // ⛔ ห้ามครอบ max-width แบบมือถือที่ระดับบนสุด (ข้อ 5A.1)
    //    max-width ของ content อยู่ที่ 1440 ไม่ใช่ 480
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-[var(--text-hero)]">เปรียบเทียบข้อเสนอ</h1>
        <p className="mt-1 text-[var(--text-meta)] text-[var(--color-ink-2)]">
          จ่ายเท่ากันทุกธนาคาร แล้วดูว่าใครทำให้หนี้เหลือน้อยกว่า
        </p>
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
                <Field label="ค่างวดที่จะจ่ายจริงต่อเดือน" suffix="บาท">
                  <NumberField value={lockedPayment} onChange={setLockedPayment} />
                </Field>
              </div>
            )}
          </section>

          {drafts.map((d) => (
            <OfferForm key={d.id} draft={d} onChange={(p) => update(d.id, p)} />
          ))}
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
              <ResultsTable ranked={ranked} horizonMonths={HORIZON} />

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

              <CostCurveChart ranked={ranked} />
              <SensitivityBand bands={bands} flips={flips} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function OfferForm({
  draft,
  onChange,
}: {
  draft: OfferDraft
  onChange: (patch: Partial<OfferDraft>) => void
}) {
  const setRate = (i: number, v: number | '') => {
    const next = [...draft.promoRates]
    next[i] = v
    onChange({ promoRates: next })
  }

  return (
    <section className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-4">
      <Field label="ธนาคาร">
        <SelectField
          value={draft.bankCode}
          onChange={(v) => onChange({ bankCode: v })}
          options={BANK_PRESETS.map((b) => ({
            value: b.code,
            label: b.isSfi ? `${b.nameTh} (รัฐ)` : b.nameTh,
          }))}
        />
      </Field>

      {/* กรอกเรตเป็น "ปีที่" ไม่ใช่ from_month/to_month (ข้อ 5A.3 วิธีที่ 2) */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {draft.promoRates.map((r, i) => (
          <Field key={i} label={`ปีที่ ${i + 1}`} suffix="%">
            <NumberField value={r} onChange={(v) => setRate(i, v)} />
          </Field>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="หลังพ้นโปร" suffix="%" hint="กินเวลา 27 ปีจาก 30">
          <NumberField value={draft.floatingRate} onChange={(v) => onChange({ floatingRate: v })} />
        </Field>
        <Field label="ค่างวดจากใบเสนอ" suffix="บาท">
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
