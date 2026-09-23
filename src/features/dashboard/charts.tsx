/**
 * กราฟของ Dashboard (spec ข้อ 4.2) — แต่ละอันตอบคำถามเดียว
 *
 *   2  Balance: แผน / จริง / ถ้าไม่โปะ   ระยะห่างคือเงินที่ประหยัด
 *   3  ดอก/ต้น รายปีเป็นแท่งซ้อน          ปีนี้จ่ายไป X จริง ๆ แล้วเป็นดอกกี่บาท
 *   6  สิทธิลดหย่อนภาษี + เส้นเพดาน       รวมทุกสัญญา ไม่ใช่แยกหลัง (ข้อ 1.9)
 */

import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { ScheduleRow } from '@engine/types.js'
import { FIXED_SCALE, type Fixed } from '@engine/money.js'
import { groupSchedule, type GroupAxis, type TaxYearSummary } from '@engine/grouping.js'
import { bahtRounded, formatMonthSpan } from '@/lib/format'

const toBaht = (v: Fixed): number => Number(v / FIXED_SCALE) / 100

const tooltipStyle = {
  background: 'var(--color-paper-raised)',
  border: '1px solid var(--color-rule)',
  borderRadius: 6,
  fontSize: 13,
}

function compact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} ล้าน`
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`
  return String(Math.round(v))
}

const axisTick = { fill: 'var(--color-ink-3)', fontSize: 12 }

// ---------- กราฟ 2 ----------

/**
 * ระยะห่างระหว่างเส้น "ถ้าไม่โปะ" กับ "จริง" คือเงินที่การโปะช่วยได้
 * ต้องเห็นเป็นพื้นที่ ไม่ใช่ตัวเลขเดียว เพราะประโยชน์ของการโปะสะสมขึ้นตามเวลา
 */
export function BalanceChart({
  actual,
  noPrepay,
}: {
  actual: readonly ScheduleRow[]
  noPrepay: readonly ScheduleRow[]
}) {
  const len = Math.max(actual.length, noPrepay.length)
  if (len === 0) return null

  const data = Array.from({ length: len }, (_, i) => ({
    month: i + 1,
    // ปิดหนี้แล้วให้เป็น 0 ไม่ใช่ปล่อยเส้นหาย — ไม่งั้นดูเหมือนข้อมูลขาด
    actual: i < actual.length ? toBaht(actual[i]!.balanceAfterFixed) : 0,
    noPrepay: i < noPrepay.length ? toBaht(noPrepay[i]!.balanceAfterFixed) : 0,
  }))

  const samePlan = actual.length === noPrepay.length

  return (
    <figure className="mt-8">
      <figcaption className="mb-1 text-[var(--text-row)]">ยอดหนี้ตามเวลา</figcaption>
      <p className="mb-4 text-[var(--text-meta)] text-[var(--color-ink-2)]">
        {samePlan
          ? 'ยังไม่มีการโปะ เส้นเดียวคือแผนตามสัญญา'
          : 'ช่องว่างระหว่างสองเส้นคือผลของการโปะ — ยิ่งห่างยิ่งประหยัด'}
      </p>

      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--color-rule)" vertical={false} />
            <XAxis
              dataKey="month"
              tick={axisTick}
              stroke="var(--color-rule)"
              tickFormatter={(m: number) => (m % 60 === 0 ? `ปี ${String(m / 12)}` : '')}
              interval={0}
            />
            <YAxis tick={axisTick} stroke="var(--color-rule)" width={56} tickFormatter={compact} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(m) => `งวดที่ ${String(m)}`}
              formatter={(v, name) => [
                `${Math.round(Number(v)).toLocaleString('en-US')} บาท`,
                name === 'actual' ? 'จ่ายจริง' : 'ถ้าไม่โปะ',
              ]}
            />
            {!samePlan && (
              <Legend
                formatter={(v: string) => (v === 'actual' ? 'จ่ายจริง' : 'ถ้าไม่โปะ')}
                wrapperStyle={{ fontSize: 13 }}
              />
            )}
            {!samePlan && (
              <Line
                type="monotone"
                dataKey="noPrepay"
                stroke="var(--color-ink-3)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
              />
            )}
            <Line
              type="monotone"
              dataKey="actual"
              stroke="var(--color-interest)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

// ---------- กราฟ 3 ----------

export type TipItem = { dataKey?: string | number | undefined; value?: unknown }
type TipProps = {
  active?: boolean | undefined
  payload?: readonly TipItem[] | undefined
  label?: unknown
}

/**
 * ดึงดอก/ต้น/รวม ออกจาก payload ของ Tooltip
 *
 * ⛔ ต้องอ่านจาก dataKey ไม่ใช่ลำดับใน payload
 *    ลำดับเปลี่ยนได้ตามการซ้อนแท่งและตอนผู้ใช้กดซ่อน series ที่ legend
 *    ถ้าอ่านตามลำดับแล้วสลับกัน ตัวเลขดอกกับต้นจะกลับหัวโดยไม่มีใครสังเกต
 */
export function tooltipTotals(payload: readonly TipItem[] | undefined): {
  interest: number
  principal: number
  total: number
} {
  const valueOf = (key: string): number => {
    const hit = payload?.find((p) => p.dataKey === key)
    return typeof hit?.value === 'number' && Number.isFinite(hit.value) ? hit.value : 0
  }
  const interest = valueOf('interest')
  const principal = valueOf('principal')
  return { interest, principal, total: interest + principal }
}

/**
 * Tooltip ของแท่งซ้อน — ต้องบอกยอดรวมเป็นตัวเลข
 *
 * แท่งซ้อนอ่านความสูงรวมด้วยตาไม่ได้ เพราะฐานของท่อนบนไม่ได้อยู่ที่ 0
 * ทั้งที่ "ปีนี้จ่ายไปเท่าไหร่" คือคำถามแรกของคนที่เปิดกราฟนี้
 * (คำบรรยายใต้หัวข้อบอกว่า "ความสูงรวมคือเงินที่จ่ายทั้งปี" — ต้องอ่านค่านั้นได้จริง)
 */
function YearBarTooltip({
  active,
  payload,
  label,
  spanOf,
}: TipProps & { spanOf: (label: string) => string }) {
  if (active !== true || !payload || payload.length === 0) return null

  const { interest, principal, total } = tooltipTotals(payload)

  return (
    <div style={{ ...tooltipStyle, padding: '8px 12px' }}>
      <div className="text-[var(--color-ink-2)]">
        {String(label)} · {spanOf(String(label))}
      </div>
      <TipRow k="ดอกเบี้ย" v={interest} dot="var(--color-interest)" />
      <TipRow k="เงินต้น" v={principal} dot="var(--color-principal)" />
      <div
        style={{
          borderTop: '1px solid var(--color-rule)',
          marginTop: 6,
          paddingTop: 6,
          fontWeight: 500,
        }}
      >
        <TipRow k="รวมจ่ายทั้งปี" v={total} />
      </div>
    </div>
  )
}

function TipRow({ k, v, dot }: { k: string; v: number; dot?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
      {dot !== undefined && (
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: 2, background: dot, flexShrink: 0 }}
        />
      )}
      <span style={{ marginRight: 'auto' }}>{k}</span>
      <span className="num tabular-nums">
        {Math.round(v).toLocaleString('en-US')} บาท
      </span>
    </div>
  )
}

export function YearBarsChart({
  rows,
  axis,
}: {
  rows: readonly ScheduleRow[]
  axis: GroupAxis
}) {
  const groups = groupSchedule(rows, axis)
  if (groups.length === 0) return null

  const data = groups.map((g) => ({
    label: g.label.replace('ปีสัญญาที่ ', 'ปี '),
    // ปีสัญญาไม่ตรงปีปฏิทิน ต้องบอกช่วงเดือนไม่งั้นอ่านแกน x แล้วไม่รู้ว่าเมื่อไหร่
    span: formatMonthSpan(g.rows[0]!.date, g.rows[g.rows.length - 1]!.date),
    interest: toBaht(g.interestFixed),
    principal: toBaht(g.principalFixed),
  }))

  const spanOf = (label: string): string => data.find((d) => d.label === label)?.span ?? ''

  return (
    <figure className="mt-8">
      <figcaption className="mb-1 text-[var(--text-row)]">จ่ายไปปีละเท่าไหร่ แยกดอก/ต้น</figcaption>
      <p className="mb-4 text-[var(--text-meta)] text-[var(--color-ink-2)]">
        ความสูงรวมคือเงินที่จ่ายทั้งปี ส่วนสีเข้มคือส่วนที่หายไปกับดอกเบี้ย
      </p>

      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--color-rule)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={axisTick}
              stroke="var(--color-rule)"
              interval="preserveStartEnd"
            />
            <YAxis tick={axisTick} stroke="var(--color-rule)" width={56} tickFormatter={compact} />
            <Tooltip
              content={(p) => {
                const t = p as unknown as TipProps
                return (
                  <YearBarTooltip
                    active={t.active}
                    payload={t.payload}
                    label={t.label}
                    spanOf={spanOf}
                  />
                )
              }}
            />
            <Legend
              formatter={(v: string) => (v === 'interest' ? 'ดอกเบี้ย' : 'เงินต้น')}
              wrapperStyle={{ fontSize: 13 }}
            />
            <Bar dataKey="interest" stackId="a" fill="var(--color-interest)" />
            <Bar dataKey="principal" stackId="a" fill="var(--color-principal)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

// ---------- กราฟ 6 ----------

/**
 * ⚠️ เพดาน 100,000 เป็นของ "คนหนึ่งคนต่อปีภาษี" ไม่ใช่ต่อสัญญา (ข้อ 1.9)
 *    ถ้าแยกคิดรายสัญญาแล้วเอามาบวกกัน จะได้สิทธิลดหย่อนที่ไม่มีอยู่จริง
 *    summariseTaxYears จึงรับสัญญาทั้งหมดเข้าไปพร้อมกัน ไม่ใช่เรียกทีละอัน
 */
export function TaxChart({
  summaries,
  capBaht,
}: {
  summaries: readonly TaxYearSummary[]
  capBaht: number
}) {
  if (summaries.length === 0) return null

  const data = summaries.map((s) => ({
    year: s.taxYear + 543,
    deductible: toBaht(s.deductibleFixed),
    excess: toBaht(s.excessFixed),
  }))

  return (
    <figure className="mt-8">
      <figcaption className="mb-1 text-[var(--text-row)]">สิทธิลดหย่อนภาษีรายปี</figcaption>
      <p className="mb-4 text-[var(--text-meta)] text-[var(--color-ink-2)]">
        รวมทุกสัญญาแล้ว เพราะเพดาน {capBaht.toLocaleString('en-US')} เป็นของคนหนึ่งคนต่อปี
        ไม่ใช่ต่อสัญญา — ส่วนที่เกินเส้นใช้สิทธิไม่ได้
      </p>

      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--color-rule)" vertical={false} />
            <XAxis
              dataKey="year"
              tick={axisTick}
              stroke="var(--color-rule)"
              interval="preserveStartEnd"
            />
            <YAxis tick={axisTick} stroke="var(--color-rule)" width={56} tickFormatter={compact} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(y) => `ปีภาษี ${String(y)}`}
              formatter={(v, name) => [
                `${Math.round(Number(v)).toLocaleString('en-US')} บาท`,
                name === 'deductible' ? 'ใช้สิทธิได้' : 'เกินเพดาน',
              ]}
            />
            <Legend
              formatter={(v: string) => (v === 'deductible' ? 'ใช้สิทธิได้' : 'เกินเพดาน')}
              wrapperStyle={{ fontSize: 13 }}
            />
            <Bar dataKey="deductible" stackId="a" fill="var(--color-principal)" />
            <Bar dataKey="excess" stackId="a" fill="var(--color-rule)" />
            <ReferenceLine
              y={capBaht}
              stroke="var(--color-warn)"
              strokeDasharray="4 3"
              label={{
                value: `เพดาน ${compact(capBaht)}`,
                position: 'insideTopRight',
                fill: 'var(--color-warn)',
                fontSize: 12,
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

export { bahtRounded }
