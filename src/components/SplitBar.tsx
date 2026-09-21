/**
 * แถบสองสี — หน่วยพื้นฐานของ UI ทั้งแอพ (spec ข้อ 5.1)
 *
 * "กรรมสิทธิ์กำลังย้ายมือ" — ทุกจำนวนเงินมี 2 ส่วนเสมอ
 * ส่วนที่หายไปให้ธนาคาร (ดอกเบี้ย) กับส่วนที่กลายเป็นของเรา (เงินต้น)
 *
 * pattern เดียวกันนี้ซ้ำตั้งแต่ตัวเลขตัวเดียว ไปจนถึงริบบิ้น 360 งวด
 */

import type { Fixed } from '@engine/money.js'

type Props = {
  interest: Fixed
  principal: Fixed
  /** พื้นหมึกเข้มต้องใช้คู่สีที่สว่างกว่า ไม่ใช่ค่าเดียวกับพื้นกระดาษ */
  onPanel?: boolean
  height?: number
  className?: string
}

export function SplitBar({ interest, principal, onPanel = false, height = 12, className = '' }: Props) {
  const total = interest + principal
  const interestPct = total > 0n ? Number((interest * 10_000n) / total) / 100 : 0

  const interestColor = onPanel ? 'var(--color-interest-dark)' : 'var(--color-interest)'
  const principalColor = onPanel ? 'var(--color-principal-dark)' : 'var(--color-principal)'

  return (
    <div
      className={`flex overflow-hidden rounded-sm ${className}`}
      style={{ height }}
      role="img"
      aria-label={`ดอกเบี้ย ${interestPct.toFixed(0)}% เงินต้น ${(100 - interestPct).toFixed(0)}%`}
    >
      <span style={{ width: `${interestPct}%`, background: interestColor }} />
      {/* hairline คั่นสองสี ชดเชยคอนทราสต์ระหว่างทองกับสเลตบนพื้นหมึกเข้ม (ข้อ 5.2) */}
      <span
        style={{
          width: `${100 - interestPct}%`,
          background: principalColor,
          borderLeft: onPanel ? '1px solid var(--color-ribbon-rule)' : 'none',
        }}
      />
    </div>
  )
}

/** มิเตอร์ที่มีเพดานชัดเจน เช่น สิทธิลดหย่อนภาษี — ห้ามใช้กับตัวเลขที่ไม่มีเพดาน (ข้อ 5.4) */
export function CapMeter({
  used,
  cap,
  height = 10,
}: {
  used: Fixed
  cap: Fixed
  height?: number
}) {
  const pct = cap > 0n ? Math.min(100, Number((used * 10_000n) / cap) / 100) : 0
  const over = used > cap

  return (
    <div
      className="flex overflow-hidden rounded-sm bg-[var(--color-rule)]"
      style={{ height }}
      role="img"
      aria-label={`ใช้ไป ${pct.toFixed(0)}% ของเพดาน`}
    >
      <span
        style={{
          width: `${pct}%`,
          background: over ? 'var(--color-warn)' : 'var(--color-principal)',
        }}
      />
    </div>
  )
}
