/**
 * ปฏิทินวันหยุดธนาคาร แยกเป็นหัวข้อรายปี
 *
 * ทำไมต้องแก้ได้: ธปท. ประกาศปีต่อปี มีวันหยุดชดเชยกับวันพระตามจันทรคติ
 * ที่คำนวณล่วงหน้าไม่ได้ และแต่ละธนาคารก็ไม่ได้หยุดตรงกันทุกวัน
 * วันตัดงวดที่ตรงวันหยุดจะถูกเลื่อน ซึ่งเปลี่ยนจำนวนวันคิดดอกของงวดนั้น
 * ผิดไปวันเดียวก็ทำให้ตารางไม่ตรงกับใบแจ้งยอดทั้งเส้น
 *
 * ⛔ วันที่ seed มาให้เป็นของกลาง ลบไม่ได้ — ปิดได้อย่างเดียว
 *    ลบได้จะกระทบผู้ใช้ทุกคนที่ใช้ฐานข้อมูลเดียวกัน
 */

import { useEffect, useMemo, useState } from 'react'
import { isoDate, type ISODate } from '@engine/date.js'
import {
  addBankHoliday, listBankHolidaysFull, removeBankHoliday, setBankHolidayEnabled,
  type BankHoliday,
} from '@/lib/db'
import { Field, DateField, TextField } from '@/components/Field'
import { formatThaiDate } from '@/lib/format'

export function HolidayCalendar({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<BankHoliday[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<{ date: ISODate; name: string } | null>(null)

  const reload = () => {
    listBankHolidaysFull()
      .then(setItems)
      .catch((e: Error) => setError(e.message))
  }
  useEffect(reload, [])

  /** จัดกลุ่มรายปี พ.ศ. — เรียงจากปีใหม่ไปเก่า ปีที่ใกล้ตัวอยู่บน */
  const byYear = useMemo(() => {
    const m = new Map<number, BankHoliday[]>()
    for (const h of items ?? []) {
      const y = Number(h.date.slice(0, 4)) + 543
      const list = m.get(y) ?? []
      list.push(h)
      m.set(y, list)
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0])
  }, [items])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      reload()
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (items === null && error === null) {
    return <p className="text-meta text-[var(--color-ink-2)]">กำลังโหลดวันหยุด…</p>
  }

  return (
    <div>
      <p className="text-meta text-[var(--color-ink-2)]">
        วันตัดงวดที่ตรงวันหยุดจะถูกเลื่อน ซึ่งเปลี่ยนจำนวนวันคิดดอกของงวดนั้น —
        ปีที่ยังไม่มีข้อมูลระบบจะนับแค่เสาร์–อาทิตย์
      </p>

      {error && (
        <p className="mt-3 rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-meta text-[var(--color-warn)]">
          {error}
        </p>
      )}

      <button
        onClick={() => setDraft({ date: isoDate(new Date().toISOString().slice(0, 10)), name: '' })}
        className="tap mt-3 text-meta text-[var(--color-interest)] hover:underline"
      >
        + เพิ่มวันหยุด
      </button>

      {draft !== null && (
        <div className="mt-3 rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="วันที่" hint={formatThaiDate(draft.date, 'long')}>
              <DateField value={draft.date} onChange={(v) => setDraft({ ...draft, date: isoDate(v) })} />
            </Field>
            <Field label="ชื่อวันหยุด">
              <TextField
                value={draft.name}
                onChange={(v) => setDraft({ ...draft, name: v })}
                placeholder="เช่น วันมาฆบูชา"
              />
            </Field>
          </div>
          <div className="mt-3 flex gap-3">
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await addBankHoliday(draft.date, draft.name)
                  setDraft(null)
                })
              }
              className="tap rounded-md bg-[var(--color-interest)] px-4 py-2 text-meta text-[var(--color-panel-ink)] disabled:opacity-50"
            >
              เพิ่ม
            </button>
            <button
              onClick={() => setDraft(null)}
              className="tap text-meta text-[var(--color-ink-3)] hover:underline"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {byYear.length === 0 ? (
        <p className="mt-4 text-meta text-[var(--color-ink-3)]">ยังไม่มีวันหยุดในระบบ</p>
      ) : (
        byYear.map(([year, list]) => (
          <section key={year} className="mt-5">
            <h3 className="text-row">
              ปี {year}
              <span className="ml-2 text-meta text-[var(--color-ink-3)]">
                นับเป็นวันหยุด {list.filter((h) => h.enabled).length} จาก {list.length} วัน
              </span>
            </h3>
            <ul className="mt-2 divide-y divide-[var(--color-rule)]">
              {list.map((h) => (
                <li key={h.date} className="flex items-center justify-between gap-3 py-2">
                  <label className="tap flex min-w-0 flex-1 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={h.enabled}
                      disabled={busy}
                      onChange={(e) =>
                        void run(() => setBankHolidayEnabled(h.date, e.target.checked))
                      }
                    />
                    <span className={`min-w-0 text-meta ${h.enabled ? '' : 'text-[var(--color-ink-3)] line-through'}`}>
                      {formatThaiDate(h.date)}
                      {h.name && <span className="text-[var(--color-ink-2)]"> · {h.name}</span>}
                    </span>
                  </label>

                  {h.seeded ? (
                    <span
                      className="shrink-0 text-micro text-[var(--color-ink-3)]"
                      title="วันหยุดที่ระบบเตรียมไว้ให้ ลบไม่ได้ แต่ติ๊กออกเพื่อไม่นับได้"
                    >
                      ค่าตั้งต้น
                    </span>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => void run(() => removeBankHoliday(h.date))}
                      className="tap shrink-0 text-meta text-[var(--color-warn)] hover:underline disabled:opacity-50"
                    >
                      ลบ
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
