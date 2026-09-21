/**
 * กราฟที่ 4 — Bank comparison: cumulative cost curve (spec ข้อ 4.2)
 *
 * ตอบคำถาม "อันดับพลิกที่เดือนไหน"
 * ดีกว่า bar chart เฉลี่ย 3 ปีมาก เพราะเห็นว่าข้อเสนอที่ถูกช่วงโปร
 * อาจแพงกว่าในระยะยาว และเห็นจุดที่เส้นตัดกัน
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { RankedOffer } from '@engine/compare.js'
import { bahtRounded } from '@/lib/format'
import { bankName } from './model'

/** สีของเส้นแต่ละธนาคาร — ไล่จากคู่สีหลัก ไม่เอา rainbow palette */
const SERIES_COLORS = [
  'var(--color-interest)',
  'var(--color-principal-text)',
  'var(--color-ok)',
  'var(--color-warn)',
] as const

export function CostCurveChart({
  ranked,
  months = 360,
}: {
  ranked: readonly RankedOffer[]
  months?: number
}) {
  const feasible = ranked.filter((r) => r.feasible)
  if (feasible.length === 0) return null

  // ต้นทุนสะสม = ดอกเบี้ยสะสม + เงินสดที่จ่ายไปแล้ว ณ เดือนนั้น
  const maxLen = Math.min(months, Math.max(...feasible.map((r) => r.rows.length)))
  const data: Record<string, number>[] = []

  const cumulative = new Map<string, number>()
  for (const r of feasible) cumulative.set(r.bankCode, Number(r.fees.payableCashSatang) / 100)

  for (let i = 0; i < maxLen; i++) {
    const point: Record<string, number> = { month: i + 1 }
    for (const r of feasible) {
      const row = r.rows[i]
      if (row) {
        const prev = cumulative.get(r.bankCode) ?? 0
        const next = prev + Number(row.interestFixed / 1_000_000_000_000n) / 100
        cumulative.set(r.bankCode, next)
      }
      point[r.bankCode] = cumulative.get(r.bankCode) ?? 0
    }
    data.push(point)
  }

  return (
    <figure className="mt-8">
      <figcaption className="mb-1 text-[var(--text-row)]">ต้นทุนสะสมตามเวลา</figcaption>
      <p className="mb-4 text-[var(--text-meta)] text-[var(--color-ink-2)]">
        ดอกเบี้ยสะสม + ค่าธรรมเนียมที่จ่ายสด — จุดที่เส้นตัดกันคือเดือนที่อันดับพลิก
      </p>

      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--color-rule)" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: 'var(--color-ink-3)', fontSize: 12 }}
              stroke="var(--color-rule)"
              tickFormatter={(m: number) => (m % 60 === 0 ? `ปี ${String(m / 12)}` : '')}
              interval={0}
            />
            <YAxis
              tick={{ fill: 'var(--color-ink-3)', fontSize: 12 }}
              stroke="var(--color-rule)"
              width={56}
              tickFormatter={(v: number) => compactNumber(v)}
            />
            <Tooltip
              formatter={(v, name) => [
                `${Math.round(Number(v)).toLocaleString('en-US')} บาท`,
                bankName(String(name)),
              ]}
              labelFormatter={(m) => `งวดที่ ${String(m)}`}
              contentStyle={{
                background: 'var(--color-paper-raised)',
                border: '1px solid var(--color-rule)',
                borderRadius: 6,
                fontSize: 13,
              }}
            />
            <Legend formatter={(v: string) => bankName(v)} wrapperStyle={{ fontSize: 13 }} />
            {feasible.map((r, i) => (
              <Line
                key={r.bankCode}
                type="monotone"
                dataKey={r.bankCode}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length] ?? 'var(--color-interest)'}
                strokeWidth={2}
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

/**
 * Sensitivity ต่อ MRR (ข้อ 2.4)
 * ถ้าการจัดอันดับพลิกที่ MRR สมมติต่างกัน ต้องบอกผู้ใช้ตรง ๆ
 * อย่าซ่อนความไม่แน่นอนใต้ตัวเลขเดียว
 */
export function SensitivityBand({
  bands,
  flips,
}: {
  bands: readonly { deltaBps: number; ranked: RankedOffer[] }[]
  flips: readonly { deltaBps: number; from: string; to: string }[]
}) {
  if (bands.length === 0) return null

  return (
    <section className="mt-8">
      <h3 className="text-[var(--text-row)]">ถ้า MRR ขยับ</h3>
      <p className="mt-1 mb-3 text-[var(--text-meta)] text-[var(--color-ink-2)]">
        ทุก metric ที่มีช่วงลอยตัวควรอ่านเป็นแถบ ไม่ใช่จุดเดียว
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-[var(--text-meta)]">
          <thead>
            <tr className="border-b border-[var(--color-rule)]">
              <th className="py-2 pr-4 text-left font-medium text-[var(--color-ink-2)]">MRR</th>
              <th className="py-2 pr-4 text-left font-medium text-[var(--color-ink-2)]">อันดับ 1</th>
              <th className="py-2 text-right font-medium text-[var(--color-ink-2)]">Net Position</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => {
              const top = b.ranked[0]
              if (!top) return null
              return (
                <tr key={b.deltaBps} className="border-b border-[var(--color-rule)]">
                  <td className="py-2 pr-4 num">
                    {b.deltaBps === 0 ? 'ปัจจุบัน' : `${b.deltaBps > 0 ? '+' : ''}${(b.deltaBps / 100).toFixed(2)}%`}
                  </td>
                  <td className="py-2 pr-4">{bankName(top.bankCode)}</td>
                  <td className="py-2 text-right num">{bahtRounded(top.netPositionFixed)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {flips.length > 0 && (
        <p className="mt-3 rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-[var(--text-meta)] text-[var(--color-warn)]">
          ⚠️ อันดับพลิก:{' '}
          {flips.map((f, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              เมื่อ MRR ขยับ {f.deltaBps > 0 ? '+' : ''}{(f.deltaBps / 100).toFixed(2)}%{' '}
              {bankName(f.from)} แพ้ {bankName(f.to)}
            </span>
          ))}
        </p>
      )}
    </section>
  )
}
