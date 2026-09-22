/**
 * ฟอร์มบันทึกสัญญาที่ผ่อนอยู่
 *
 * เรียงช่องตามลำดับที่หาได้จากเอกสาร ไม่ใช่ตามลำดับที่ engine ต้องใช้
 * ส่วนที่เดาไม่ได้จริง ๆ (วิธีนับวัน การปัดเศษ การทบดอก) ซ่อนใต้ details
 * พร้อมค่าตั้งต้นที่พบบ่อยสุด และบอกตรง ๆ ว่าเป็นค่าสมมติจนกว่าจะเทียบใบแจ้งยอด
 */

import { useState } from 'react'
import { Field, NumberField, SelectField, TextField, Toggle, DateField } from '@/components/Field'
import { formatThaiDate } from '@/lib/format'
import { isoDate } from '@engine/date.js'
import { createLoan } from '@/lib/db'
import { BANK_OPTIONS, OTHER_BANK } from '../compare/model'
import {
  DATE_ROLL_OPTIONS, DAY_COUNT_OPTIONS, ROLL_CALENDAR_OPTIONS, ROUNDING_OPTIONS,
  emptyLoanDraft, todayISO, toNewLoanInput, validateDraft,
  type LoanDraft,
} from './model'

export function LoanForm({
  onDone,
  onCancel,
}: {
  onDone: (loanId: string) => void
  onCancel: () => void
}) {
  const [d, setD] = useState<LoanDraft>(() => emptyLoanDraft(todayISO()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)

  const set = (patch: Partial<LoanDraft>) => setD({ ...d, ...patch })
  const errors = validateDraft(d)

  const setRate = (i: number, v: number | '') => {
    const next = [...d.promoRates]
    next[i] = v
    set({ promoRates: next })
  }

  async function save() {
    if (errors.length > 0) return setShowErrors(true)
    setBusy(true)
    setError(null)
    try {
      onDone(await createLoan(toNewLoanInput(d)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-[640px]">
      <h2 className="text-[var(--text-lead)]">บันทึกสัญญาที่ผ่อนอยู่</h2>
      <p className="mt-1 text-[var(--text-meta)] text-[var(--color-ink-2)]">
        เอาเลขจากสัญญาเงินกู้กับใบแจ้งยอดล่าสุดมากรอก ส่วนที่ไม่รู้ข้ามได้ แก้ทีหลังได้
      </p>

      <section className="mt-6 space-y-3">
        <Field label="ชื่อทรัพย์สิน" hint="ตั้งให้จำได้ เช่น คอนโดรังสิต">
          <TextField
            value={d.propertyName}
            onChange={(v) => set({ propertyName: v })}
            placeholder="บ้านเลขที่ 99/1"
          />
        </Field>

        <Field label="ธนาคาร">
          <SelectField
            value={d.bankCode}
            onChange={(v) => set({ bankCode: v })}
            options={BANK_OPTIONS}
          />
        </Field>

        {d.bankCode === OTHER_BANK && (
          <Field label="ชื่อผู้ให้กู้">
            <TextField
              value={d.customName}
              onChange={(v) => set({ customName: v })}
              placeholder="เช่น สหกรณ์ออมทรัพย์ครู"
            />
          </Field>
        )}
      </section>

      <section className="mt-6">
        <h3 className="mb-3 text-[var(--text-row)]">วันที่</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="วันทำสัญญา" hint={formatThaiDate(d.contractDate, 'long')}>
            <DateField value={d.contractDate} onChange={(v) => set({ contractDate: isoDate(v) })} />
          </Field>
          <Field
            label="วันเบิกเงินกู้"
            hint="วันที่เริ่มคิดดอกเบี้ย มักไม่ใช่วันเดียวกับวันทำสัญญา และเป็นสาเหตุอันดับหนึ่งที่งวดแรกไม่ตรง"
          >
            <DateField
              value={d.firstAccrualDate}
              onChange={(v) => set({ firstAccrualDate: isoDate(v) })}
            />
          </Field>
          <Field label="วันตัดงวดแรก" hint={formatThaiDate(d.firstDueDate, 'long')}>
            <DateField value={d.firstDueDate} onChange={(v) => set({ firstDueDate: isoDate(v) })} />
          </Field>
          <Field label="วันตัดรอบ" suffix="ของเดือน">
            <NumberField
              value={d.dueDayOfMonth}
              max={31}
              onChange={(v) => set({ dueDayOfMonth: typeof v === 'number' ? v : 1 })}
            />
          </Field>
        </div>
      </section>

      <section className="mt-6">
        <h3 className="mb-3 text-[var(--text-row)]">วงเงินและค่างวด</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="วงเงินที่เบิกจริง" suffix="บาท" hint="ยอดที่ได้รับจริง รวมเบี้ยที่รวมในวงเงินแล้ว">
            <NumberField value={d.disbursed} onChange={(v) => set({ disbursed: v })} />
          </Field>
          <Field label="ค่างวดตามสัญญา" suffix="บาท">
            <NumberField value={d.installment} onChange={(v) => set({ installment: v })} />
          </Field>
          <Field label="ระยะเวลา" suffix="ปี">
            <NumberField
              value={d.termYears}
              max={40}
              onChange={(v) => set({ termYears: typeof v === 'number' ? v : 30 })}
            />
          </Field>
          <Field label="โปะแล้วให้" hint="ธนาคารส่วนใหญ่ตั้งเป็นลดจำนวนงวด">
            <SelectField
              value={d.prepayMode}
              onChange={(v) => set({ prepayMode: v })}
              options={[
                { value: 'shorten_term' as const, label: 'ลดจำนวนงวด' },
                { value: 'reduce_installment' as const, label: 'ลดค่างวด' },
              ]}
            />
          </Field>
        </div>
      </section>

      <section className="mt-6">
        <h3 className="mb-3 text-[var(--text-row)]">อัตราดอกเบี้ย</h3>
        <div className="grid grid-cols-3 gap-2">
          {d.promoRates.map((r, i) => (
            <Field key={i} label={`ปีที่ ${i + 1}`} suffix="%">
              <NumberField value={r} onChange={(v) => setRate(i, v)} />
            </Field>
          ))}
        </div>
        <div className="mt-3">
          <Field
            label="หลังพ้นโปร"
            suffix="%"
            hint={`กินเวลา ${Math.max(0, d.termYears - d.promoRates.filter((r) => typeof r === 'number').length)} ปีจาก ${d.termYears}`}
          >
            <NumberField value={d.floatingRate} onChange={(v) => set({ floatingRate: v })} />
          </Field>
        </div>
      </section>

      {/* ส่วนที่ไม่มีใครรู้จนกว่าจะเทียบใบแจ้งยอด — ซ่อนไว้แต่ต้องแก้ได้ (ข้อ 9.1) */}
      <details className="mt-6 rounded-lg border border-[var(--color-rule)] p-4">
        <summary className="tap cursor-pointer text-[var(--text-row)]">
          วิธีคิดดอกเบี้ยของธนาคาร
          <span className="ml-2 text-[var(--text-meta)] text-[var(--color-ink-3)]">
            ค่าตั้งต้นเป็นแบบที่พบบ่อยสุด
          </span>
        </summary>

        <p className="mt-3 rounded-md bg-[var(--color-interest-tint)] px-3 py-2 text-[var(--text-meta)] text-[var(--color-ink-2)]">
          ทั้ง 3 ข้อนี้ไม่มีเขียนในสัญญา รู้ได้จากการเทียบกับใบแจ้งยอดจริงเท่านั้น
          ระบบจะบันทึกไว้ว่าเป็นค่าสมมติ จนกว่าคุณจะยืนยันด้วยยอดจริง
        </p>

        <div className="mt-3 space-y-3">
          <Field label="วิธีนับวัน" hint="ดอกเบี้ยคิดรายวัน ไม่ใช่หาร 12">
            <SelectField
              value={d.dayCountBasis}
              onChange={(v) => set({ dayCountBasis: v })}
              options={DAY_COUNT_OPTIONS}
            />
          </Field>
          <Field label="การปัดเศษ" hint="ปัดตอนจบงวด ไม่ใช่ปัดทุกวัน">
            <SelectField
              value={d.rounding}
              onChange={(v) => set({ rounding: v })}
              options={ROUNDING_OPTIONS}
            />
          </Field>
          <Field label="ถ้าวันตัดตรงวันหยุด">
            <SelectField
              value={d.dateRoll}
              onChange={(v) => set({ dateRoll: v })}
              options={DATE_ROLL_OPTIONS}
            />
          </Field>
          {d.dateRoll !== 'none' && (
            <Field label="นับวันหยุดจาก">
              <SelectField
                value={d.rollCalendar}
                onChange={(v) => set({ rollCalendar: v })}
                options={ROLL_CALENDAR_OPTIONS}
              />
            </Field>
          )}
          <Toggle
            checked={d.capitaliseUnpaidInterest}
            onChange={(v) => set({ capitaliseUnpaidInterest: v })}
            label="จ่ายไม่พอดอก แล้วเอาดอกที่เหลือทบเข้าเงินต้น"
            hint="ค่าตั้งต้นคือไม่ทบ ตาม ป.พ.พ. ม.655 ที่ห้ามคิดดอกซ้อนดอก — เปิดเฉพาะเมื่อยืนยันจากใบแจ้งยอดแล้ว"
          />
        </div>
      </details>

      {showErrors && errors.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-[var(--text-meta)] text-[var(--color-warn)]">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-4 rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-[var(--text-meta)] text-[var(--color-warn)]">
          บันทึกไม่สำเร็จ — {error}
        </p>
      )}

      <div className="mt-6 flex gap-3">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="tap rounded-md bg-[var(--color-interest)] px-4 py-2.5 text-[var(--color-panel-ink)] disabled:opacity-50"
        >
          {busy ? 'กำลังบันทึก…' : 'บันทึกสัญญา'}
        </button>
        <button onClick={onCancel} disabled={busy} className="tap px-4 py-2.5 text-[var(--color-ink-2)]">
          ยกเลิก
        </button>
      </div>
    </div>
  )
}
