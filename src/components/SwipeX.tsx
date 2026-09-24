/**
 * ลากซ้าย–ขวาเพื่อเลื่อนทีละขั้น
 *
 * ⚠️ ต้องปล่อยให้เลื่อนหน้าจอขึ้นลงได้ตามปกติ
 *    กราฟสูงเกือบเต็มจอบนมือถือ ถ้ากินท่าทางแนวตั้งไปด้วย
 *    ผู้ใช้จะเลื่อนผ่านกราฟไม่ได้เลย ต้องอ้อมไปลากตรงขอบจอ
 *    จึงล็อกแกนจากการขยับ 8px แรก แล้วตั้ง touch-action: pan-y ไว้ให้เบราว์เซอร์
 *
 * ⛔ ห้าม preventDefault ในตัวจัดการ — เบราว์เซอร์จะเลิกส่ง pointermove ของการเลื่อนจอ
 *    และ tooltip ของกราฟจะตายไปด้วย
 */

import { useRef, type ReactNode } from 'react'

/** ระยะลากต่อหนึ่งขั้น — สั้นกว่านี้จะเลื่อนพรวดตอนสะบัดนิ้ว */
const STEP_PX = 56
/** ขยับเกินเท่านี้ถึงตัดสินว่าเป็นการลากแนวไหน */
const AXIS_LOCK_PX = 8

export function SwipeX({
  onStep,
  disabled = false,
  children,
}: {
  /** เรียกพร้อมจำนวนขั้นที่ขยับเพิ่มจากครั้งก่อน — ลากซ้าย = บวก (ไปข้างหน้า) */
  onStep: (delta: number) => void
  disabled?: boolean
  children: ReactNode
}) {
  const start = useRef<{ x: number; y: number } | null>(null)
  /** ขั้นที่ส่งออกไปแล้วในการลากครั้งนี้ ป้องกันส่งซ้ำตอนนิ้วสั่นอยู่กับที่ */
  const sent = useRef(0)
  const axis = useRef<'none' | 'x' | 'y'>('none')

  const end = () => {
    start.current = null
    axis.current = 'none'
  }

  if (disabled) return <>{children}</>

  return (
    <div
      style={{ touchAction: 'pan-y' }}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, y: e.clientY }
        sent.current = 0
        axis.current = 'none'
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (!s) return
        const dx = e.clientX - s.x
        const dy = e.clientY - s.y

        if (axis.current === 'none') {
          if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return
          axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        }
        if (axis.current !== 'x') return

        // ลากไปทางซ้าย = ดันแผ่นกระดาษออกไป เห็นปีถัดไป
        const steps = Math.trunc(-dx / STEP_PX)
        if (steps !== sent.current) {
          onStep(steps - sent.current)
          sent.current = steps
        }
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={end}
    >
      {children}
    </div>
  )
}
