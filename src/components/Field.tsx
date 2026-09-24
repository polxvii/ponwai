/**
 * ช่องกรอก — ข้อกำหนดทางเทคนิคสำหรับมือถือ (spec ข้อ 5A.5)
 *
 *   font-size ขั้นต่ำ 16px   ต่ำกว่านี้ Safari iOS ซูมหน้าจอเองทุกครั้งที่แตะ
 *   inputMode="decimal"      type="number" มีปัญหาลูกศรขึ้นลงและค่าเปลี่ยนเมื่อเลื่อนเมาส์
 *   พื้นที่แตะขั้นต่ำ 44px
 */

import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

export function Field({
  label,
  hint,
  children,
  suffix,
}: {
  label: string
  hint?: string | undefined
  children: ReactNode
  suffix?: string | undefined
}) {
  return (
    <label className="block">
      <span className="block text-meta text-[var(--color-ink-2)]">{label}</span>
      {/* suffix ลอยทับตัวเลขถ้าไม่กันที่ไว้ — กันด้วยตัวแปร CSS ที่ input รับช่วงไป
          ใช้ em เพื่อให้คำนวณจาก font-size ของ input เอง และเป็น utility ตัวเดียว
          ไม่ชนกับ pr- ค่าอื่นใน class list */}
      <span
        className="relative mt-1 flex items-center"
        style={
          suffix
            ? ({ '--field-pr': `calc(1rem + ${suffix.length} * 0.62em)` } as CSSProperties)
            : undefined
        }
      >
        {children}
        {suffix && (
          <span className="pointer-events-none absolute right-3 text-meta text-[var(--color-ink-3)]">
            {suffix}
          </span>
        )}
      </span>
      {hint && (
        <span className="mt-1 block text-micro text-[var(--color-ink-3)]">{hint}</span>
      )}
    </label>
  )
}

const inputClass =
  'tap w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-raised)] ' +
  'pl-3 pr-[var(--field-pr,0.75rem)] py-2 text-right num tabular-nums ' +
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
  /**
   * เก็บข้อความที่ผู้ใช้พิมพ์ไว้เอง ไม่วาดจากตัวเลขที่ parse แล้ว
   *
   * ⛔ ห้ามใช้ value={format(number)} ตรง ๆ
   *    พิมพ์ "2." แล้ว Number("2.") = 2 พอวาดกลับเป็น "2" จุดหายทันที
   *    ทำให้พิมพ์ทศนิยมไม่ได้เลยทั้งแอพ — เรตดอกเบี้ยพิมพ์ 2.5 ไม่ได้
   *    ต้องให้ข้อความระหว่างพิมพ์เป็นของ input เอง แล้วค่อยส่งตัวเลขออกไป
   */
  const [text, setText] = useState(() => (value === '' ? '' : formatNumber(value)))

  // ค่าที่เปลี่ยนจากข้างนอก (โหลดฟอร์ม กด reset เติมค่าอัตโนมัติ) ต้องสะท้อนลงช่อง
  // แต่ห้ามเขียนทับตอนที่ข้อความปัจจุบันแปลงแล้วได้ค่าเดียวกัน ไม่งั้น "2." โดนลบอีก
  useEffect(() => {
    const typed = text.replace(/,/g, '').trim()
    const matches =
      value === '' ? typed === '' : typed !== '' && Number(typed) === value
    if (!matches) setText(value === '' ? '' : formatNumber(value))
    // ตั้งใจดูเฉพาะ value — text เปลี่ยนเองตอนพิมพ์ ไม่ต้องวิ่งซ้ำ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <input
      type="text"
      inputMode="decimal"
      className={inputClass}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value.replace(/,/g, '').trim()
        if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return
        setText(groupThousands(raw))
        if (raw === '' || raw === '.') return onChange('')
        const n = Number(raw)
        if (Number.isNaN(n)) return
        if (max !== undefined && n > max) {
          setText(formatNumber(max))
          return onChange(max)
        }
        onChange(n)
      }}
      onBlur={() => setText(value === '' ? '' : formatNumber(value))}
    />
  )
}

function formatNumber(n: number): string {
  return groupThousands(String(n))
}

/** ใส่ลูกน้ำเฉพาะจำนวนเต็ม ส่วนทศนิยมคงไว้ตามที่พิมพ์ รวมถึงจุดที่ยังไม่มีเลขตาม */
function groupThousands(raw: string): string {
  const [whole, frac] = raw.split('.')
  const w = (whole ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac !== undefined ? `${w}.${frac}` : w
}

export function SelectField<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: T
  onChange: (v: T) => void
  options: readonly { value: T; label: string }[]
  disabled?: boolean
  /**
   * ตัวเลือกว่างบนสุดสำหรับฟอร์มที่ยังไม่ควรเลือกอะไรให้ล่วงหน้า
   * ⛔ ห้ามยัดตัวเลือกว่างเข้าไปใน options ที่หลายหน้าใช้ร่วมกัน
   *    หน้าที่ "ต้องเลือก" จะได้ตัวเลือกที่ไม่ใช่ค่าจริงติดมาด้วยโดยไม่มีใครสังเกต
   */
  placeholder?: string
}) {
  return (
    <select
      className={`${inputClass.replace('text-right', 'text-left')} disabled:opacity-60`}
      value={value}
      disabled={disabled === true}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
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
        <span className="block text-row">{label}</span>
        {hint && (
          <span className="block text-meta text-[var(--color-ink-2)]">{hint}</span>
        )}
      </span>
    </label>
  )
}

/**
 * ช่องเลือกวันที่
 * ตัวเลือกวันที่ของเบราว์เซอร์แสดง ค.ศ. เสมอ เปลี่ยนไม่ได้
 * จึงพิมพ์ พ.ศ. กำกับไว้ใต้ช่อง ไม่ใช่แปลงค่าที่เก็บ (ข้อ 5.3 — DB/engine เป็น ค.ศ. เท่านั้น)
 */
export function DateField({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <input
      type="date"
      className={inputClass.replace('text-right', 'text-left')}
      value={value}
      onChange={(e) => e.target.value !== '' && onChange(e.target.value)}
    />
  )
}

/** ช่องกรอกข้อความ เช่น ชื่อธนาคารที่ไม่อยู่ในรายการ */
export function TextField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      type="text"
      className={inputClass.replace('text-right', 'text-left').replace(' num tabular-nums', '')}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
