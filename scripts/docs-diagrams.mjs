/**
 * สร้างภาพ diagram จาก docs/diagrams.md แล้วฝังลง docs/project-summary.html
 *
 *   node scripts/docs-diagrams.mjs
 *
 * ทำ 4 อย่างตามลำดับ
 *   1. อ่านทุก block ```mermaid ที่มี `<!-- svg: ชื่อไฟล์ -->` อยู่บรรทัดก่อนหน้า
 *   2. render เป็น docs/diagrams/<ชื่อไฟล์>.svg และลบ svg ที่ไม่มีต้นฉบับแล้ว
 *   3. เขียน docs/diagrams/README.md ให้เห็นว่าไฟล์ไหนคือเรื่องอะไร
 *   4. ฝังภาพลงทุก <img class="dg" data-diagram="ชื่อไฟล์"> ใน project-summary.html
 *      พร้อม data-src-hash ของต้นฉบับ — TV-56 ใช้ค่านี้จับว่าแก้ diagram แล้วลืมสร้างภาพใหม่
 *
 * ⚠️ ฝังเป็น data URI ไม่ใช่ inline <svg> — ภาพจาก mermaid ใช้ id ซ้ำกันทุกไฟล์ (my-svg)
 *    ถ้า inline หลายภาพในหน้าเดียว หัวลูกศรกับ style จะไปจับของภาพแรกแทน
 *
 * ต้องมี Chrome หรือ Edge ในเครื่อง สคริปต์หาเองแล้วส่งให้ puppeteer
 * (เครื่ององค์กรมักบล็อกไม่ให้ puppeteer ดาวน์โหลดเบราว์เซอร์ของตัวเอง)
 * ตั้ง MERMAID_CLI=<path ไปที่ @mermaid-js/mermaid-cli/src/cli.js> ได้ถ้าติดตั้งไว้แล้ว ไม่งั้นใช้ npx
 *
 * ⛔ ห้ามเอาไปรันใน CI — CI แค่ตรวจว่าภาพตรงต้นฉบับ (src/lib/docs-sync.test.ts)
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const MD = join(root, 'docs', 'diagrams.md')
const OUT = join(root, 'docs', 'diagrams')
const HTML = join(root, 'docs', 'project-summary.html')

/** ต้องตรงกับ diagramsOf ใน src/lib/docs-sync.test.ts */
function diagramsOf(md) {
  const text = md.replace(/\r\n/g, '\n')
  const all = (text.match(/^```mermaid$/gm) ?? []).length
  const found = [...text.matchAll(/<!-- svg: ([a-z0-9-]+) -->\n```mermaid\n([\s\S]*?)\n```/g)].map(
    (m) => {
      const source = m[2].trim()
      const title = /^title:\s*(.+)$/m.exec(source)?.[1]?.trim() ?? m[1]
      const hash = createHash('sha256').update(source).digest('hex').slice(0, 16)
      return { name: m[1], title, source, hash }
    },
  )
  if (found.length !== all) {
    throw new Error(`มี block mermaid ${all} อัน แต่มี <!-- svg: ... --> แค่ ${found.length} อัน`)
  }
  const dup = found.map((d) => d.name).filter((n, i, a) => a.indexOf(n) !== i)
  if (dup.length > 0) throw new Error(`ชื่อไฟล์ซ้ำ: ${dup.join(', ')}`)
  return found
}

function findBrowser() {
  const local = process.env.LOCALAPPDATA ?? ''
  const candidates = {
    win32: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  }[process.platform] ?? []
  return candidates.find((p) => existsSync(p)) ?? null
}

function mermaidCli(args) {
  if (process.env.MERMAID_CLI) {
    execFileSync(process.execPath, [process.env.MERMAID_CLI, ...args], { stdio: 'pipe' })
    return
  }
  // Windows ต้องผ่าน shell เพื่อเรียก npx.cmd — path มีช่องว่าง จึงต้องครอบเครื่องหมายคำพูดเอง
  const win = process.platform === 'win32'
  const q = (a) => (win ? `"${a}"` : a)
  execFileSync(win ? 'npx.cmd' : 'npx', ['-y', '@mermaid-js/mermaid-cli@11', ...args].map(q), {
    stdio: 'pipe',
    shell: win,
  })
}

function render(diagrams) {
  mkdirSync(OUT, { recursive: true })
  const tmp = mkdtempSync(join(tmpdir(), 'ponwai-diagrams-'))
  try {
    const browser = findBrowser()
    const extra = []
    if (browser) {
      const cfg = join(tmp, 'puppeteer.json')
      writeFileSync(cfg, JSON.stringify({ executablePath: browser, args: ['--no-sandbox'] }))
      extra.push('-p', cfg)
    }
    for (const d of diagrams) {
      const src = join(tmp, `${d.name}.mmd`)
      writeFileSync(src, d.source)
      mermaidCli(['-i', src, '-o', join(OUT, `${d.name}.svg`), '-b', 'white', ...extra])
      console.log(`render  ${d.name}.svg`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  const keep = new Set(diagrams.map((d) => `${d.name}.svg`))
  for (const f of readdirSync(OUT)) {
    if (f.endsWith('.svg') && !keep.has(f)) {
      rmSync(join(OUT, f))
      console.log(`ลบ     ${f} (ไม่มีต้นฉบับแล้ว)`)
    }
  }
}

function writeIndex(diagrams) {
  const rows = diagrams
    .map((d) => `| [${d.name}.svg](${d.name}.svg) | ${d.title} |`)
    .join('\n')
  writeFileSync(
    join(OUT, 'README.md'),
    `# ภาพ diagram

⛔ ไฟล์ในโฟลเดอร์นี้สร้างอัตโนมัติ ห้ามแก้ตรงนี้ — แก้ต้นฉบับที่ [../diagrams.md](../diagrams.md)
แล้วรัน \`node scripts/docs-diagrams.mjs\`

| ไฟล์ | เรื่อง |
|---|---|
${rows}
`,
  )
  console.log('เขียน   diagrams/README.md')
}

function embed(diagrams) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  let html = readFileSync(HTML, 'utf8')
  for (const d of diagrams) {
    const re = new RegExp(`<img class="dg" data-diagram="${d.name}"[^>]*>`)
    if (!re.test(html)) {
      throw new Error(`project-summary.html ไม่มี <img class="dg" data-diagram="${d.name}"> — เพิ่มก่อนแล้วรันใหม่`)
    }
    // ⚠️ ตัด \r ก่อนฝัง ภาพจะได้เหมือนกันทั้งบน Windows (autocrlf) และ Linux
    const raw = readFileSync(join(OUT, `${d.name}.svg`), 'utf8').replace(/\r/g, '')
    // ⚠️ mermaid เขียน width="100%" ซึ่งพอเป็น <img> แล้วเบราว์เซอร์ไม่รู้ขนาดจริง ย่อเหลือ ~300px
    //    ใส่ขนาดจาก viewBox ให้สำเนาที่ฝัง ส่วนไฟล์ .svg ที่เปิดเดี่ยว ๆ ปล่อยยืดตามหน้าต่างเหมือนเดิม
    const vb = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(raw)
    const svg = vb
      ? raw.replace(
          /^<svg([^>]*?) width="100%"/,
          `<svg$1 width="${Math.ceil(Number(vb[1]))}" height="${Math.ceil(Number(vb[2]))}"`,
        )
      : raw
    const b64 = Buffer.from(svg, 'utf8').toString('base64')
    html = html.replace(
      re,
      `<img class="dg" data-diagram="${d.name}" data-src-hash="${d.hash}" alt="${esc(d.title)}" src="data:image/svg+xml;base64,${b64}">`,
    )
  }
  writeFileSync(HTML, html)
  console.log(`ฝัง     ${diagrams.length} ภาพลง project-summary.html`)
}

const diagrams = diagramsOf(readFileSync(MD, 'utf8'))
render(diagrams)
writeIndex(diagrams)
embed(diagrams)
