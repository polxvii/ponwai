/**
 * ดอกเบี้ยสะสม + ต้นทุนการย้าย ของแต่ละทางเลือก
 *
 * จุดที่เส้นของ "ย้ายธนาคาร" ตัดลงใต้เส้น "ไม่ทำอะไร" คือเดือนคืนทุน
 * ต้องเห็นเป็นกราฟ ไม่ใช่แค่ตัวเลขเดียว เพราะบางทางถูกกว่าช่วงแรกแต่แพงกว่าในระยะยาว
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { RefinanceOutcome } from '@engine/refinance.js'
import { FIXED_SCALE } from '@engine/money.js'

const SERIES_COLORS = [
  'var(--color-ink-2)',          // ไม่ทำอะไร = เส้นกลาง ๆ ไม่ชวนมอง
  'var(--color-ok)',             // retention
  'var(--color-interest)',       // ย้ายธนาคาร
  'var(--color-principal-text)', // ย้ายแต่คงค่างวด
] as const

export function InterestCurveChart({ outcomes: all }: { outcomes: readonly RefinanceOutcome[] }) {
  // ⛔ ห้ามวาดเส้นของเคสที่จ่ายไม่ไหว — ตอนชนเพดาน 1,200 งวดดอกจะพุ่งหลักสิบล้าน
  //    แล้วกินสเกลแกน Y จนเส้นที่เหลือแบนติดพื้นอ่านไม่ออก
  const outcomes = all.filter((o) => o.feasible)
  const hidden = all.length - outcomes.length
  if (outcomes.length === 0) return null

  const maxLen = Math.max(...outcomes.map((o) => o.rows.length))
  const data: Record<string, number>[] = []
  const acc = outcomes.map((o) => Number(o.movingCostSatang) / 100)

  for (let i = 0; i < maxLen; i++) {
    const point: Record<string, number> = { month: i + 1 }
    outcomes.forEach((o, k) => {
      const row = o.rows[i]
      if (row) acc[k] = (acc[k] ?? 0) + Number(row.interestFixed / FIXED_SCALE) / 100
      // หนี้ปิดแล้วให้เส้นหยุดนิ่ง ไม่ใช่หายไป — จะได้เทียบปลายทางกันได้
      point[`s${k}`] = acc[k] ?? 0
    })
    data.push(point)
  }

  const label = (key: string) => outcomes[Number(key.slice(1))]?.label ?? key

  return (
    <figure className="mt-8">
      <figcaption className="mb-1 text-[var(--text-row)]">ดอกเบี้ยสะสม + ต้นทุนการย้าย</figcaption>
      <p className="mb-4 text-[var(--text-meta)] text-[var(--color-ink-2)]">
        เส้นเริ่มจากต้นทุนการย้าย ไม่ใช่ศูนย์ — จุดที่เส้นตัดกับ &quot;ไม่ทำอะไร&quot; คือเดือนคืนทุน
        {hidden > 0 && ` (ซ่อน ${hidden} ทางที่จ่ายไม่ไหว)`}
      </p>

      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--color-rule)" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: 'var(--color-ink-3)', fontSize: 12 }}
              stroke="var(--color-rule)"
              tickFormatter={(m: number) => (m % 60 === 0 ? `อีก ${String(m / 12)} ปี` : '')}
              interval={0}
            />
            <YAxis
              tick={{ fill: 'var(--color-ink-3)', fontSize: 12 }}
              stroke="var(--color-rule)"
              width={56}
              tickFormatter={compactNumber}
            />
            <Tooltip
              formatter={(v, name) => [
                `${Math.round(Number(v)).toLocaleString('en-US')} บาท`,
                label(String(name)),
              ]}
              labelFormatter={(m) => `เดือนที่ ${String(m)}`}
              contentStyle={{
                background: 'var(--color-paper-raised)',
                border: '1px solid var(--color-rule)',
                borderRadius: 6,
                fontSize: 13,
              }}
            />
            <Legend formatter={(v: string) => label(v)} wrapperStyle={{ fontSize: 13 }} />
            {outcomes.map((o, k) => (
              <Line
                key={k}
                type="monotone"
                dataKey={`s${k}`}
                stroke={SERIES_COLORS[k % SERIES_COLORS.length] ?? 'var(--color-interest)'}
                strokeWidth={o.kind === 'stay' ? 1.5 : 2}
                {...(o.kind === 'stay' ? { strokeDasharray: '4 3' } : {})}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

function compactNumber(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} ล้าน`
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`
  return String(Math.round(v))
}
