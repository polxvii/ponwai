/**
 * ตัวเลือกธนาคารที่เห็นสีประจำแบงก์ในรายการด้วย
 *
 * ⛔ <select> ของเบราว์เซอร์ใส่ HTML ใน <option> ไม่ได้ ทุก engine เรนเดอร์เป็นข้อความล้วน
 *    จะให้เห็นสีตอนกางรายการต้องเขียน listbox เอง ไม่มีทางลัด
 *
 * ⚠️ เขียนเองแล้วต้องรับผิดชอบสิ่งที่ <select> เคยให้ฟรี
 *    ลูกศรขึ้นลง Enter Esc Home End · โฟกัสกลับที่ปุ่มตอนปิด · aria ครบ
 *    ไม่งั้นคนที่ใช้คีย์บอร์ดหรือโปรแกรมอ่านหน้าจอเลือกธนาคารไม่ได้เลย
 */

import { useEffect, useId, useRef, useState } from 'react'
import { BankMark } from './BankMark'

export function BankSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder = 'เลือกธนาคาร',
  disabled,
}: {
  value: T
  onChange: (v: T) => void
  options: readonly { value: T; label: string }[]
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const id = useId()

  const selected = options.findIndex((o) => o.value === value)
  const current = selected >= 0 ? options[selected] : undefined

  // ปิดเมื่อคลิกนอกกรอบ — pointerdown ไม่ใช่ click เพราะ click จะมาหลังปุ่มอื่นทำงานไปแล้ว
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  // เลื่อนรายการให้ตัวที่โฟกัสอยู่ในสายตาเสมอ ไม่งั้นกดลูกศรแล้วไฮไลต์หายไปใต้ขอบ
  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const pick = (i: number) => {
    const o = options[i]
    if (!o) return
    onChange(o.value)
    setOpen(false)
    btn.current?.focus()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setActive(selected >= 0 ? selected : 0)
        setOpen(true)
      }
      return
    }
    switch (e.key) {
      case 'Escape':   e.preventDefault(); setOpen(false); btn.current?.focus(); break
      case 'ArrowDown':e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)); break
      case 'ArrowUp':  e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); break
      case 'Home':     e.preventDefault(); setActive(0); break
      case 'End':      e.preventDefault(); setActive(options.length - 1); break
      case 'Enter':
      case ' ':        e.preventDefault(); pick(active); break
    }
  }

  return (
    // ⚠️ w-full จำเป็น — Field ห่อ children ด้วย flex
    //    flex item ที่ไม่สั่งความกว้างจะหดเท่าเนื้อหา แล้ว w-full ของปุ่มข้างในจะอิงความกว้างที่หดแล้ว
    <div ref={box} className="relative w-full min-w-0">
      <button
        ref={btn}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-haspopup="listbox"
        {...(open ? { 'aria-activedescendant': `${id}-${active}` } : {})}
        disabled={disabled === true}
        onClick={() => {
          setActive(selected >= 0 ? selected : 0)
          setOpen((v) => !v)
        }}
        onKeyDown={onKey}
        className="tap flex w-full items-center gap-2 rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-raised)] px-3 py-2 text-left focus:border-[var(--color-interest)] focus:outline-2 focus:outline-offset-1 focus:outline-[var(--color-interest)] disabled:opacity-60"
      >
        {current ? (
          <>
            <BankMark code={current.value} name={current.label} size={22} />
            <span className="min-w-0 flex-1 truncate">{current.label}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[var(--color-ink-3)]">{placeholder}</span>
        )}
        <span aria-hidden className="text-[var(--color-ink-3)]">▾</span>
      </button>

      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          tabIndex={-1}
          className="absolute z-30 mt-1 max-h-72 w-max min-w-full max-w-[min(22rem,80vw)] overflow-auto rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-raised)] py-1 shadow-lg"
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              data-i={i}
              role="option"
              aria-selected={o.value === value}
              onPointerDown={(e) => { e.preventDefault(); pick(i) }}
              onPointerEnter={() => setActive(i)}
              className={`tap flex cursor-pointer items-center gap-2 px-3 py-2 ${
                i === active ? 'bg-[var(--color-interest-tint)]' : ''
              }`}
            >
              <BankMark code={o.value} name={o.label} size={22} />
              <span className={`min-w-0 flex-1 truncate ${o.value === value ? 'font-medium' : ''}`}>
                {o.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
