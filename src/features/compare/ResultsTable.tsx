/**
 * ตารางเปรียบเทียบ (spec ข้อ 2.3)
 *
 * ⛔ ห้ามแสดง metric เดียว — เว็บเปรียบเทียบไทยเกือบทั้งหมดจัดอันดับด้วย
 *    "ดอกเบี้ยเฉลี่ย 3 ปี" ซึ่งไม่รวมค่าธรรมเนียม ไม่สนใจ spread หลังพ้นโปร
 *    และเทียบ cash flow คนละชุดเพราะค่างวดแต่ละธนาคารไม่เท่ากัน
 */

import type { RankedOffer } from '@engine/compare.js'
import type { Fixed } from '@engine/money.js'
import { bahtFixed, bahtRounded, baht, pct, formatPeriods } from '@/lib/format'
import { SplitBar } from '@/components/SplitBar'

export function ResultsTable({
  ranked,
  horizonMonths,
  nameOf,
}: {
  ranked: readonly RankedOffer[]
  horizonMonths: number
  /** engine รู้จักข้อเสนอด้วย id ไม่ใช่รหัสธนาคาร — แปลงกลับเป็นชื่อที่หน้าเรียกใช้ */
  nameOf: (key: string) => string
}) {
  if (ranked.length === 0) return null
  const best = ranked.find((r) => r.feasible)

  return (
    <div>
      {/* มือถือ: การ์ดเรียงลง / desktop: ตารางจริง */}
      <div className="grid gap-4 lg:hidden">
        {ranked.map((r) => (
          <OfferCardMobile key={r.bankCode} r={r} best={best} horizonMonths={horizonMonths} nameOf={nameOf} />
        ))}
      </div>

      <div className="hidden lg:block">
        <table className="w-full border-collapse text-row">
          <thead>
            <tr className="border-b border-[var(--color-rule)] text-left">
              <th className="py-3 pr-4 font-medium text-meta text-[var(--color-ink-2)]">
                อันดับ
              </th>
              <th className="py-3 pr-4 font-medium text-meta text-[var(--color-ink-2)]">
                ธนาคาร
              </th>
              <Th title={`เงินต้นคงเหลือ + เงินสดที่จ่ายจริง ณ เดือนที่ ${horizonMonths}`}>
                Net Position
              </Th>
              <Th>ดอกเบี้ย {horizonMonths} งวด</Th>
              <Th>เงินต้นคงเหลือ</Th>
              <Th title="อัตราผลตอบแทนที่แท้จริง รวมค่าธรรมเนียมแล้ว">EIR</Th>
              <Th title="ค่างวดขั้นต่ำเดือนแรกหลังพ้นโปร — ตัวเลขที่คนมักไม่ดู">พ้นโปรต้องจ่าย</Th>
              <Th>ผ่อนทั้งหมด</Th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <tr
                key={r.bankCode}
                className={`border-b border-[var(--color-rule)] ${
                  !r.feasible ? 'opacity-60' : ''
                }`}
              >
                <td className="py-3 pr-4 num">{r.feasible ? r.rank : '—'}</td>
                <td className="py-3 pr-4">
                  <span className="font-medium">{nameOf(r.bankCode)}</span>
                  {r.rank === 1 && r.feasible && (
                    <span className="ml-2 rounded-sm bg-[var(--color-principal-tint)] px-1.5 py-0.5 text-micro text-[var(--color-principal-text)]">
                      ถูกที่สุด
                    </span>
                  )}
                  {!r.feasible && (
                    <span className="ml-2 rounded-sm bg-[var(--color-warn)]/12 px-1.5 py-0.5 text-micro text-[var(--color-warn)]">
                      จ่ายไม่ไหว
                    </span>
                  )}
                </td>
                <Td strong>{bahtRounded(r.netPositionFixed)}</Td>
                <Td>{bahtRounded(r.interestPaidToHorizonFixed)}</Td>
                <Td>{bahtRounded(r.balanceAtHorizonFixed)}</Td>
                <Td>{r.eirBps === null ? '—' : pct(r.eirBps)}</Td>
                <Td>{baht(r.minInstallmentAfterPromoSatang, 0)}</Td>
                <Td>{formatPeriods(r.totalPeriods)}</Td>
              </tr>
            ))}
          </tbody>
        </table>

        {ranked.some((r) => !r.feasible) && (
          <p className="mt-3 text-meta text-[var(--color-warn)]">
            {ranked.filter((r) => !r.feasible).map((r) => (
              <span key={r.bankCode} className="block">
                {nameOf(r.bankCode)}: {r.infeasibleReason}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  )
}

function Th({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <th
      className="py-3 pr-4 text-right font-medium text-meta text-[var(--color-ink-2)]"
      title={title}
    >
      {children}
    </th>
  )
}

function Td({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <td className={`py-3 pr-4 text-right num ${strong ? 'font-medium' : ''}`}>{children}</td>
  )
}

function OfferCardMobile({
  r,
  best,
  horizonMonths,
  nameOf,
}: {
  r: RankedOffer
  best: RankedOffer | undefined
  horizonMonths: number
  nameOf: (key: string) => string
}) {
  const gap = best && r.bankCode !== best.bankCode
    ? ((r.netPositionFixed - best.netPositionFixed) as Fixed)
    : null

  return (
    <article
      className={`rounded-lg border p-4 ${
        r.rank === 1 && r.feasible
          ? 'border-[var(--color-principal)] bg-[var(--color-paper-raised)]'
          : 'border-[var(--color-rule)]'
      } ${!r.feasible ? 'opacity-70' : ''}`}
    >
      <header className="flex items-baseline justify-between">
        <h3 className="text-lead">
          {r.feasible && <span className="num mr-2 text-[var(--color-ink-3)]">{r.rank}</span>}
          {nameOf(r.bankCode)}
        </h3>
        {r.rank === 1 && r.feasible && (
          <span className="text-meta text-[var(--color-principal-text)]">
            ถูกที่สุด
          </span>
        )}
      </header>

      {!r.feasible ? (
        <p className="mt-2 text-meta text-[var(--color-warn)]">{r.infeasibleReason}</p>
      ) : (
        <>
          <p className="mt-3 num text-figure">{bahtRounded(r.netPositionFixed)}</p>
          <p className="text-meta text-[var(--color-ink-2)]">
            Net Position ณ เดือนที่ {horizonMonths}
            {gap !== null && gap > 0n && (
              <span className="text-[var(--color-warn)]"> · แพงกว่าอันดับ 1 {bahtRounded(gap)}</span>
            )}
          </p>

          <SplitBar
            className="mt-3"
            interest={r.interestPaidToHorizonFixed}
            principal={r.balanceAtHorizonFixed}
            height={8}
          />

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-meta">
            <Row k={`ดอกเบี้ย ${horizonMonths} งวด`} v={bahtRounded(r.interestPaidToHorizonFixed)} />
            <Row k="เงินต้นคงเหลือ" v={bahtRounded(r.balanceAtHorizonFixed)} />
            <Row k="EIR" v={r.eirBps === null ? '—' : pct(r.eirBps)} />
            <Row k="พ้นโปรต้องจ่าย" v={baht(r.minInstallmentAfterPromoSatang, 0)} />
            <Row k="ผ่อนทั้งหมด" v={formatPeriods(r.totalPeriods)} />
            <Row k="ดอกเบี้ยรวมตลอดสัญญา" v={bahtFixed(r.totalInterestFixed, 0)} />
          </dl>
        </>
      )}
    </article>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-[var(--color-ink-2)]">{k}</dt>
      <dd className="text-right num">{v}</dd>
    </>
  )
}
