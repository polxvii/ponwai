/**
 * Split Ribbon — hero ของ Dashboard (spec ข้อ 4.1)
 *
 * ทุกงวดตลอดอายุสัญญาเป็นแท่งบาง ๆ 2 สี เรียงเป็นริบบิ้น
 * บอกความจริงที่แอพอื่นซ่อน: ปีแรก ๆ สีดอกเบี้ยกินพื้นที่เกือบทั้งแถบ แล้วค่อย ๆ ถอย
 *
 * ⛔ ห้ามแทนด้วย donut สัดส่วนต้น/ดอก หรือ gauge เปอร์เซ็นต์ผ่อน (ข้อ 4.2)
 *    gauge ทำให้เข้าใจผิดว่าใกล้หมดแล้ว เพราะ % ของงวดที่ผ่อนไม่ใช่ % ของหนี้ที่ลด
 *
 * marker ที่ "งวดที่เงินต้นแซงดอกเบี้ย" มีความหมายกว่า "ผ่อนไปแล้ว 12%"
 * เพราะเป็นจุดที่เงินที่จ่ายเริ่มกลายเป็นของเรามากกว่าของธนาคาร
 *
 * ⛔ ห้ามใช้การแซงครั้งแรก — สินเชื่อไทยมีโปร 3 ปีเกือบทุกตัว
 *    ช่วงโปรเรตต่ำพอที่เงินต้นจะชนะตั้งแต่งวดแรก แล้วพอพ้นโปรดอกเบี้ยกลับมาชนะ
 *    รายงานการแซงครั้งแรกจึงให้วันที่ที่กลับกลายทีหลัง ซึ่งแย่กว่าไม่บอกเลย
 *    ต้องเอาจุดที่แซงแล้วไม่กลับ = จุดเริ่มของช่วงท้ายที่เงินต้นชนะต่อเนื่องถึงงวดสุดท้าย
 */

import type { ScheduleRow } from '@engine/types.js'
import { formatThaiDate, thaiYear } from '@/lib/format'

const HEIGHT = 100

export function SplitRibbon({
  rows,
  currentIndex,
  height = 46,
}: {
  rows: readonly ScheduleRow[]
  /** งวดล่าสุดที่ถึงกำหนดแล้ว 0 = ยังไม่เริ่มผ่อน */
  currentIndex: number
  height?: number
}) {
  if (rows.length === 0) return null

  const n = rows.length
  const crossover = durableCrossover(rows)
  // แซงแล้วกลับอย่างน้อยครั้งหนึ่ง = มีช่วงที่ดอกเบี้ยกลับมาชนะหลังพ้นโปร
  const reversed =
    crossover !== null &&
    rows.some((r, i) => i < crossover - 1 && r.principalFixed > r.interestFixed)

  const first = rows[0]!
  const last = rows[n - 1]!
  const current = currentIndex > 0 ? rows[currentIndex - 1] : undefined

  return (
    <figure>
      <svg
        viewBox={`0 0 ${n} ${HEIGHT}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block' }}
        role="img"
        aria-label={
          crossover === null
            ? `ริบบิ้น ${n} งวด เงินต้นยังไม่แซงดอกเบี้ย`
            : `ริบบิ้น ${n} งวด เงินต้นแซงดอกเบี้ยที่งวด ${crossover}`
        }
      >
        {rows.map((r, i) => {
          const total = r.interestFixed + r.principalFixed
          // งวดที่ไม่มีการจ่ายเลย (ถ้ามี) ให้ถือว่าเป็นดอกเบี้ยทั้งแท่ง
          const interestPct = total > 0n ? Number((r.interestFixed * 10_000n) / total) / 100 : 100
          const h = (interestPct / 100) * HEIGHT
          const past = i < currentIndex
          return (
            <g key={r.index}>
              {/* ดอกเบี้ยอยู่ด้านบน เพราะเป็นส่วนที่ "หายไป" */}
              <rect
                x={i}
                y={0}
                width={1}
                height={h}
                fill="var(--color-interest-dark)"
                opacity={past ? 1 : 0.45}
              />
              <rect
                x={i}
                y={h}
                width={1}
                height={HEIGHT - h}
                fill="var(--color-principal-dark)"
                opacity={past ? 1 : 0.45}
              />
            </g>
          )
        })}

        {/* เส้นบอกงวดปัจจุบัน — ใช้ vector-effect ไม่ให้ความหนาถูกยืดตาม viewBox */}
        {currentIndex > 0 && currentIndex <= n && (
          <line
            x1={currentIndex}
            x2={currentIndex}
            y1={0}
            y2={HEIGHT}
            stroke="var(--color-panel-ink)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {crossover !== null && (
          <line
            x1={crossover}
            x2={crossover}
            y1={0}
            y2={HEIGHT}
            stroke="var(--color-panel-ink-2)"
            strokeWidth={1}
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* ป้ายปี — เอาแค่ 3 จุดที่มีความหมาย ไม่ใช่ทุกปี */}
      <div className="mt-1 flex justify-between text-[var(--text-micro)] text-[var(--color-panel-ink-3)]">
        <span>{thaiYear(first.date)}</span>
        {crossover !== null && rows[crossover - 1] && (
          <span className="text-[var(--color-panel-ink-2)]">
            เงินต้นแซงดอกเบี้ย {formatThaiDate(rows[crossover - 1]!.date, 'monthYear')}
          </span>
        )}
        <span>{thaiYear(last.date)}</span>
      </div>

      {reversed && (
        <p className="mt-1 text-[var(--text-micro)] text-[var(--color-panel-ink-2)]">
          ช่วงโปรเงินต้นชนะอยู่ก่อน แล้วพอพ้นโปรดอกเบี้ยกลับมาชนะ
          วันที่ข้างบนคือจุดที่เงินต้นชนะแล้วไม่กลับ
        </p>
      )}

      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[var(--text-micro)] text-[var(--color-panel-ink-2)]">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ background: 'var(--color-interest-dark)' }}
          />
          ดอกเบี้ย
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ background: 'var(--color-principal-dark)' }}
          />
          เงินต้น
        </span>
        {current && (
          <span>
            งวด {current.index} จาก {n} · {formatThaiDate(current.date, 'monthYear')}
          </span>
        )}
        <span className="text-[var(--color-panel-ink-3)]">
          ส่วนที่ทึบคือที่ผ่อนไปแล้ว
        </span>
      </figcaption>
    </figure>
  )
}

/**
 * งวดที่เงินต้นแซงดอกเบี้ยแล้วไม่กลับ (1-indexed)
 * ไล่จากงวดสุดท้ายย้อนขึ้นมา จุดเริ่มของช่วงต่อเนื่องนั้นคือคำตอบ
 * null = งวดสุดท้ายดอกเบี้ยยังชนะ ซึ่งเกิดได้ถ้าจ่ายแค่ขั้นต่ำตลอด
 */
export function durableCrossover(rows: readonly ScheduleRow[]): number | null {
  let i = rows.length - 1
  if (i < 0 || rows[i]!.principalFixed <= rows[i]!.interestFixed) return null
  while (i > 0 && rows[i - 1]!.principalFixed > rows[i - 1]!.interestFixed) i--
  return rows[i]!.index
}
