/**
 * ส่งออกเป็นรายงาน HTML ไฟล์เดียวจบ
 *
 * ทำไมไม่ใช่ PDF: ต้องลง library ที่ฝังฟอนต์ไทยเองทั้งชุด ซึ่งใหญ่กว่าแอพทั้งตัว
 * HTML เปิดด้วยเบราว์เซอร์อะไรก็ได้ แล้วสั่งพิมพ์เป็น PDF ต่อได้ทันที
 * CSV เดิมยังอยู่ สำหรับคนที่จะเอาไปคำนวณต่อใน Excel
 *
 * ⛔ ห้ามอ้างอิงไฟล์ภายนอกทุกชนิด (ฟอนต์ รูป สไตล์)
 *    ไฟล์นี้ถูกเปิดตอนไม่มีเน็ตหรือส่งต่อทางแชทได้ ถ้าโหลดของนอกไม่ได้จะพังทั้งหน้า
 *    ฟอนต์จึงใช้ของที่มีในเครื่อง และกราฟเป็น SVG ที่เขียนลงไปในไฟล์เลย
 *
 * ⚠️ ทุกค่าที่มาจากผู้ใช้ต้อง escape ก่อนเสมอ ชื่อทรัพย์สินกับหมายเหตุพิมพ์อะไรก็ได้
 */

import type { Fixed, Satang } from '@engine/money.js'
import { FIXED_SCALE } from '@engine/money.js'
import type { ScheduleRow } from '@engine/types.js'
import type { YearGroup } from '@engine/grouping.js'
import type { ISODate } from '@engine/date.js'
import { formatThaiDate, formatAccrualRange } from './format'
import type { StoredPayment } from './db'

const C = {
  paper: '#f5f5f1',
  card: '#ffffff',
  rule: '#dcdcd4',
  ink: '#161a18',
  ink2: '#5c625e',
  ink3: '#717874',
  interest: '#2b4570',
  principal: '#d98b2b',
  panel: '#182742',
  panelInk: '#fbfaf7',
  panelInk2: '#9db0cc',
}

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}

/** บาทมีคอมมา — รายงานนี้ให้คนอ่าน ส่วนการเอาไปคำนวณต่อเป็นหน้าที่ของ CSV */
function money(v: Fixed | Satang | bigint, scale: bigint, decimals: 0 | 2): string {
  const satang = scale === FIXED_SCALE ? v / FIXED_SCALE : v
  const neg = satang < 0n
  const abs = neg ? -satang : satang
  const baht = abs / 100n
  const cents = abs % 100n
  const whole = baht.toLocaleString('en-US')
  const tail = decimals === 2 ? `.${String(cents).padStart(2, '0')}` : ''
  return `${neg ? '-' : ''}${whole}${tail}`
}

const b0 = (v: Fixed): string => money(v, FIXED_SCALE, 0)
const b2 = (v: Fixed): string => money(v, FIXED_SCALE, 2)
const s2 = (v: Satang | bigint): string => money(v, 1n, 2)

const sum = (xs: readonly Fixed[]): Fixed => xs.reduce((a, b) => (a + b) as Fixed, 0n as Fixed)

/**
 * กราฟแท่งรายปี ดอกเบี้ยทับเงินต้น — เขียน SVG สดเพราะคอมโพเนนต์ของแอพเป็น React
 * ถ้าจะ reuse ต้องลาก react-dom/server เข้า bundle เพื่อฟีเจอร์เดียว ไม่คุ้ม
 */
function yearChart(groups: readonly YearGroup[]): string {
  if (groups.length === 0) return ''
  const W = 960
  const H = 220
  const padX = 8
  const padTop = 8
  const padBottom = 26
  const plotH = H - padTop - padBottom
  const gap = groups.length > 40 ? 1 : 3
  const bw = (W - padX * 2 - gap * (groups.length - 1)) / groups.length
  const max = groups.reduce((m, g) => (g.paymentFixed > m ? g.paymentFixed : m), 1n as Fixed)

  const bars = groups
    .map((g, i) => {
      const x = padX + i * (bw + gap)
      // คิดสัดส่วนด้วย bigint ก่อนค่อยแปลงเป็น number — Fixed ใหญ่เกิน Number.MAX_SAFE_INTEGER
      const h = (Number((g.paymentFixed * 10_000n) / max) / 10_000) * plotH
      const ih =
        g.paymentFixed === 0n
          ? 0
          : (Number((g.interestFixed * 10_000n) / g.paymentFixed) / 10_000) * h
      const yTop = padTop + plotH - h
      return (
        `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${ih.toFixed(1)}" fill="${C.interest}"/>` +
        `<rect x="${x.toFixed(1)}" y="${(yTop + ih).toFixed(1)}" width="${bw.toFixed(1)}" height="${(h - ih).toFixed(1)}" fill="${C.principal}"/>`
      )
    })
    .join('')

  // ป้ายปีเฉพาะหัวท้าย — 30 ป้ายเรียงกันจะชนกันจนอ่านไม่ออก
  const first = groups[0]
  const last = groups[groups.length - 1]
  const labels =
    `<text x="${padX}" y="${H - 8}" font-size="11" fill="${C.ink3}">${esc(first?.label ?? '')}</text>` +
    (groups.length > 1
      ? `<text x="${W - padX}" y="${H - 8}" font-size="11" fill="${C.ink3}" text-anchor="end">${esc(last?.label ?? '')}</text>`
      : '')

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="ยอดจ่ายรายปี แยกดอกเบี้ยกับเงินต้น">${bars}${labels}</svg>`
}

function table(
  head: readonly string[],
  rows: readonly (readonly string[])[],
  rightFrom: number,
): string {
  const th = head.map((h, i) => `<th${i >= rightFrom ? ' class="r"' : ''}>${esc(h)}</th>`).join('')
  const tb = rows
    .map(
      (r) =>
        `<tr>${r
          .map((c, i) => `<td${i >= rightFrom ? ' class="r num"' : ''}>${esc(c)}</td>`)
          .join('')}</tr>`,
    )
    .join('')
  return `<table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`
}

export type ReportInput = {
  propertyName: string
  bankLabel: string
  contractDate: ISODate
  disbursedSatang: Satang
  installmentSatang: Satang
  rows: readonly ScheduleRow[]
  groups: readonly YearGroup[]
  payments: readonly StoredPayment[]
  /** จำนวนงวดที่ถือว่าจ่ายจริงไปแล้ว ใช้แยกอดีตออกจากประมาณการ */
  settled: number
  today: ISODate
}

const KIND: Record<string, string> = {
  installment: 'ค่างวดปกติ',
  partial_prepay: 'โปะบางส่วน',
  full_redemption: 'ปิดบัญชี',
  fee: 'ค่าธรรมเนียม',
}

export function loanReportHtml(x: ReportInput): string {
  const done = x.rows.slice(0, x.settled)
  const paidInterest = sum(done.map((r) => r.interestFixed))
  const paidPrincipal = sum(done.map((r) => r.principalFixed))
  const paidTotal = sum(done.map((r) => r.paymentFixed))
  // ยังไม่ได้จ่ายสักงวด ยอดหนี้คือวงเงินที่เบิกเต็มจำนวน
  const balance =
    done[done.length - 1]?.balanceAfterFixed ?? ((x.disbursedSatang * FIXED_SCALE) as Fixed)
  const payoff = x.rows[x.rows.length - 1]

  const cards: readonly (readonly [string, string, string])[] = [
    ['ยังเป็นหนี้อยู่', b0(balance), `ณ งวดที่ ${x.settled} จาก ${x.rows.length}`],
    ['จ่ายไปแล้ว', b0(paidTotal), `${x.settled} งวด`],
    ['หายไปกับดอกเบี้ย', b0(paidInterest), 'ส่วนที่ไม่ได้ลดหนี้'],
    ['กลายเป็นของเราแล้ว', b0(paidPrincipal), 'เงินต้นที่ตัดไปแล้ว'],
    ['ปิดหนี้', payoff ? formatThaiDate(payoff.date, 'monthYear') : '—', 'ตามแผนปัจจุบัน'],
  ]

  const yearRows = x.groups.map((g) => [
    g.label,
    String(g.periodCount) + (g.isPartialYear ? ' (ไม่ครบปี)' : ''),
    b2(g.interestFixed),
    b2(g.principalFixed),
    b2(g.paymentFixed),
    `${(g.effectiveRateBps / 100).toFixed(2)}%`,
    b2(g.closingBalanceFixed),
  ])

  const schedRows = x.rows.map((r) => [
    String(r.index),
    formatThaiDate(r.date, 'short'),
    `${(r.effectiveRateBps / 100).toFixed(2)}%`,
    b2(r.principalFixed),
    b2(r.interestFixed),
    r.prepayFixed > 0n ? b2(r.prepayFixed) : '—',
    b2(r.paymentFixed),
    b2(r.balanceAfterFixed),
    formatAccrualRange(r.accrualFrom, r.date),
    String(r.accrualDays),
  ])

  const payRows = [...x.payments]
    .sort((a, b) => (a.paidDate < b.paidDate ? 1 : -1))
    .map((p) => [
      formatThaiDate(p.paidDate, 'short'),
      KIND[p.kind] ?? p.kind,
      s2(p.amountSatang),
      p.note ?? '',
    ])

  const cardsHtml = cards
    .map(
      ([k, v, n]) =>
        `<div class="card"><p class="k">${esc(k)}</p><p class="v">${esc(v)}</p><p class="n">${esc(n)}</p></div>`,
    )
    .join('')

  const paymentsSection =
    payRows.length > 0
      ? `<h2>บันทึกการจ่าย</h2><div class="scroll">${table(['วันที่จ่าย', 'ประเภท', 'จำนวนเงิน', 'หมายเหตุ'], payRows, 2)}</div>`
      : ''

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(x.propertyName)} — รายงานสินเชื่อ</title>
<style>
  /* ⛔ ฟอนต์ต้องเป็นของที่มีในเครื่องเท่านั้น ไฟล์นี้ต้องเปิดได้ตอนไม่มีเน็ต */
  :root { color-scheme: light }
  * { box-sizing: border-box }
  body {
    margin: 0; padding: 32px 24px; background: ${C.paper}; color: ${C.ink};
    font-family: 'IBM Plex Sans Thai', 'Noto Sans Thai', 'Leelawadee UI', 'Sarabun', system-ui, sans-serif;
    font-size: 14px; line-height: 1.55;
  }
  .wrap { max-width: 1100px; margin: 0 auto }
  h1 { font-size: 26px; margin: 0 0 4px }
  h2 { font-size: 17px; margin: 32px 0 10px }
  .sub { color: ${C.ink2}; margin: 0 0 24px }
  .cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); margin-bottom: 28px }
  .card { background: ${C.panel}; color: ${C.panelInk}; border-radius: 10px; padding: 14px 16px }
  .card .k { font-size: 12px; color: ${C.panelInk2}; margin: 0 }
  .card .v { font-size: 22px; font-variant-numeric: tabular-nums; margin: 4px 0 2px }
  .card .n { font-size: 11px; color: ${C.panelInk2}; margin: 0 }
  .panel { background: ${C.card}; border: 1px solid ${C.rule}; border-radius: 10px; padding: 14px }
  .legend { font-size: 12px; color: ${C.ink2}; margin-top: 6px }
  .sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin: 0 4px 0 12px }
  .legend .sw:first-child { margin-left: 0 }
  table { width: 100%; border-collapse: collapse; background: ${C.card}; font-size: 12.5px }
  th, td { padding: 6px 8px; border-bottom: 1px solid ${C.rule}; text-align: left; white-space: nowrap }
  th { color: ${C.ink2}; font-weight: 500; background: #fbfbf8 }
  .r { text-align: right }
  .num { font-variant-numeric: tabular-nums }
  .scroll { overflow-x: auto; border: 1px solid ${C.rule}; border-radius: 10px }
  footer { margin-top: 32px; font-size: 11px; color: ${C.ink3} }
  /* สั่งพิมพ์เป็น PDF ได้เลย — หัวตารางซ้ำทุกหน้า และไม่ตัดแถวกลางตัว */
  @media print {
    body { background: #fff; padding: 0 }
    .scroll { overflow: visible; border: 0 }
    thead { display: table-header-group }
    tr { break-inside: avoid }
    h2 { break-after: avoid }
  }
</style>
</head>
<body><div class="wrap">
  <h1>${esc(x.propertyName)}</h1>
  <p class="sub">${esc(x.bankLabel)} · ทำสัญญา ${formatThaiDate(x.contractDate, 'long')} · วงเงิน ${s2(x.disbursedSatang)} · ค่างวดตามสัญญา ${s2(x.installmentSatang)}</p>

  <div class="cards">${cardsHtml}</div>

  <h2>จ่ายไปปีละเท่าไหร่ แยกดอกเบี้ยกับเงินต้น</h2>
  <div class="panel">
    ${yearChart(x.groups)}
    <p class="legend"><span class="sw" style="background:${C.interest}"></span>ดอกเบี้ย<span class="sw" style="background:${C.principal}"></span>เงินต้น</p>
  </div>

  <h2>สรุปรายปี</h2>
  <div class="scroll">${table(['ปี', 'งวด', 'ดอกเบี้ย', 'เงินต้น', 'ยอดจ่ายจริง', 'อัตราที่จ่ายจริง', 'คงเหลือสิ้นปี'], yearRows, 1)}</div>

  ${paymentsSection}

  <h2>ตารางผ่อนรายงวด</h2>
  <div class="scroll">${table(['งวด', 'วันตัด', 'อัตรา', 'เงินต้น', 'ดอกเบี้ย', 'โปะ', 'ยอดชำระ', 'คงเหลือ', 'ช่วงคิดดอก', 'วัน'], schedRows, 2)}</div>

  <footer>
    สร้างจาก PonWai เมื่อ ${formatThaiDate(x.today, 'long')} ·
    งวดที่ ${x.settled + 1} เป็นต้นไปเป็นประมาณการจากค่างวดตามสัญญาและแผนโปะที่บันทึกไว้ ไม่ใช่ยอดที่จ่ายจริง ·
    ดอกเบี้ยคิดรายวันในช่วง (วันตัดงวดก่อน, วันตัดงวดนี้] โดยรวมวันตัดด้วย
  </footer>
</div></body>
</html>`
}

export function downloadHtml(filename: string, html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.html') ? filename : `${filename}.html`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // ปล่อย object URL ทิ้ง ไม่งั้นค้างในหน่วยความจำจนกว่าจะปิดแท็บ
  URL.revokeObjectURL(url)
}
