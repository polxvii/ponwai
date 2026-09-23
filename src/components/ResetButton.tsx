/**
 * ปุ่ม "เริ่มใหม่" ที่ต้องกดยืนยันก่อน
 *
 * ⚠️ สิ่งที่ล้างคือตัวเลขที่ผู้ใช้นั่งกรอกทีละช่องจากใบเสนอจริง กู้คืนไม่ได้
 *    กดพลาดครั้งเดียวเสียงานทั้งหมด จึงต้องถามก่อนเสมอ
 *
 * ⛔ ห้ามใช้ window.confirm — เบราว์เซอร์บล็อกได้ หน้าตาหลุดจากแอพ
 *    และบนมือถือ dialog เด้งกลางจอจนผู้ใช้ไม่เห็นว่ากำลังจะลบอะไร
 *    ยืนยันตรงที่เดิมกับปุ่ม ผู้ใช้จึงเห็นบริบทครบตอนตัดสินใจ
 */

import { useState } from 'react'

export function ResetButton({
  onReset,
  label = 'เริ่มใหม่',
  confirmLabel = 'ล้างทุกช่อง',
}: {
  onReset: () => void
  label?: string
  confirmLabel?: string
}) {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="tap shrink-0 text-[var(--text-meta)] text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)] hover:underline"
      >
        {label}
      </button>
    )
  }

  return (
    <span className="flex shrink-0 items-center gap-3 text-[var(--text-meta)]">
      <span className="text-[var(--color-ink-2)]">ล้างที่กรอกไว้ทั้งหมด?</span>
      <button
        onClick={() => {
          onReset()
          setConfirming(false)
        }}
        className="tap font-medium text-[var(--color-warn)] hover:underline"
      >
        {confirmLabel}
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="tap text-[var(--color-ink-3)] hover:underline"
      >
        ยกเลิก
      </button>
    </span>
  )
}
