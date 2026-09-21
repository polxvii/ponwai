/**
 * ช่องกรอก — ข้อกำหนดทางเทคนิคสำหรับมือถือ (spec ข้อ 5A.5)
 *
 *   font-size ขั้นต่ำ 16px   ต่ำกว่านี้ Safari iOS ซูมหน้าจอเองทุกครั้งที่แตะ
 *   inputMode="decimal"      type="number" มีปัญหาลูกศรขึ้นลงและค่าเปลี่ยนเมื่อเลื่อนเมาส์
 *   พื้นที่แตะขั้นต่ำ 44px
 */

import type { ReactNode } from 'react'

export function Field({
  label,
  hint,
  children,
  suffix,
}: {
  label: string
  hint?: string
  children: ReactNode
  suffix?: string
}) {
  return (
    <label className="block">
      <span className="block text-[var(--text-meta)] text-[var(--color-ink-2)]">{label}</span>
      <span className="relative mt-1 flex items-center">
        {children}
        {suffix && (
          <span className="pointer-events-none absolute right-3 text-[var(--text-meta)] text-[var(--color-ink-3)]">
            {suffix}
          </span>
        )}
      </span>
      {hint && (
        <span className="mt-1 block text-[var(--text-micro)] text-[var(--color-ink-3)]">{hint}</span>
      )}
    </label>
  )
}

const inputClass =
  'tap w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-raised)] ' +
  'px-3 py-2 text-right num tabular-nums ' +
  'focus:border-[var(--color-interest)] focus:outline-2 focus:outline-offset-1 ' +
  'focus:outline-[var(--color-interest)]'

/**
 * ช่องกรอกตัวเลข
 * ⛔ ห้ามใช้ type="number" — ลูกศรขึ้นลงกินพื้นที่ และค่าเปลี่ยนเองเมื่อ scroll ทับ
 */
export function NumberField({
  value,
  onChange,
  placeholder,
  max,
}: {
  value: number | ''
  onChange: (v: number | '') => void
  placeholder?: string
  max?: number
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      className={inputClass}
      value={value === '' ? '' : formatWithCommas(value)}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value.replace(/,/g, '').trim()
        if (raw === '') return onChange('')
        if (!/^\d*\.?\d*$/.test(raw)) return
        const n = Number(raw)
        if (Number.isNaN(n)) return
        onChange(max !== undefined && n > max ? max : n)
      }}
    />
  )
}

function formatWithCommas(n: number): string {
  const [whole, frac] = String(n).split('.')
  const w = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac !== undefined ? `${w}.${frac}` : w
}

export function SelectField<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: readonly { value: T; label: string }[]
}) {
  return (
    <select
      className={inputClass.replace('text-right', 'text-left')}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="tap flex cursor-pointer items-start gap-3 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5 shrink-0 accent-[var(--color-interest)]"
      />
      <span>
        <span className="block text-[var(--text-row)]">{label}</span>
        {hint && (
          <span className="block text-[var(--text-meta)] text-[var(--color-ink-2)]">{hint}</span>
        )}
      </span>
    </label>
  )
}
