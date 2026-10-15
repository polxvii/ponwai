/**
 * TV-56 — เอกสารต้องตามโค้ดทัน
 *
 * docs/ มีไว้ให้คนหรือ Claude ที่ไม่มีประวัติแชทเดิมทำงานต่อได้ (ย้าย account)
 * เอกสารที่ตกยุคอันตรายกว่าไม่มี เพราะคนอ่านจะเชื่อ
 *
 * ตรวจเฉพาะเรื่องที่ลืมบ่อยและตรวจด้วยเครื่องได้แน่นอน:
 *   1. ทุก TV ที่มีในเทสต์ ต้องมีแถวใน docs/test-vectors.md
 *   2. ทุกไฟล์ migration ต้องอยู่ใน docs/data-model.md
 *   3. ลิงก์ระหว่างไฟล์ใน docs/ ต้องไม่ชี้ไปไฟล์ที่ไม่มี
 *   4. ภาพ diagram (docs/diagrams/*.svg และที่ฝังใน project-summary.html) ต้องตรงกับต้นฉบับใน diagrams.md
 *
 * ⚠️ เทสต์นี้แดง = แค่เพิ่มแถวในเอกสาร หรือรัน `node scripts/docs-diagrams.mjs`
 *    ไม่ต้องแก้โค้ด — ข้อความ error บอกว่าขาดอะไร
 */

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

function walk(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full, keep))
    else if (keep(name)) out.push(full)
  }
  return out
}

const read = (p: string): string => readFileSync(p, 'utf8')

type Diagram = { name: string; title: string; hash: string }

/**
 * ⛔ ต้องตรงกับ diagramsOf ใน scripts/docs-diagrams.mjs ทุกตัวอักษร
 *    hash คิดจากต้นฉบับที่ตัด CRLF แล้ว — Windows (autocrlf) กับ CI บน Linux ต้องได้ค่าเดียวกัน
 */
function diagramsOf(md: string): { all: number; found: Diagram[] } {
  const text = md.replace(/\r\n/g, '\n')
  const all = (text.match(/^```mermaid$/gm) ?? []).length
  const found = [...text.matchAll(/<!-- svg: ([a-z0-9-]+) -->\n```mermaid\n([\s\S]*?)\n```/g)].map(
    (m) => {
      const source = m[2]!.trim()
      const title = /^title:\s*(.+)$/m.exec(source)?.[1]?.trim() ?? m[1]!
      const hash = createHash('sha256').update(source).digest('hex').slice(0, 16)
      return { name: m[1]!, title, hash }
    },
  )
  return { all, found }
}

const RERUN = 'รัน `node scripts/docs-diagrams.mjs` แล้ว commit ภาพที่ได้'

describe('TV-56 เอกสารตามโค้ดทัน', () => {
  it('ทุก TV ในเทสต์มีแถวใน docs/test-vectors.md', () => {
    const inTests = new Set<number>()
    for (const f of walk('src', (n) => n.endsWith('.test.ts'))) {
      for (const m of read(f).matchAll(/\bTV-(\d+)\b/g)) inTests.add(Number(m[1]))
    }
    // ต้องเจอจริง ไม่ใช่ผ่านเพราะสแกนไม่เจออะไร
    expect(inTests.size).toBeGreaterThan(40)

    const doc = read(join('docs', 'test-vectors.md'))
    const missing = [...inTests]
      .sort((a, b) => a - b)
      .filter((n) => !new RegExp(`^\\|\\s*TV-${n}\\s*\\|`, 'm').test(doc))
      .map((n) => `TV-${n}`)
    expect(missing, 'เพิ่มแถวเหล่านี้ใน docs/test-vectors.md').toEqual([])
  })

  it('ทุกไฟล์ migration อยู่ใน docs/data-model.md', () => {
    const files = readdirSync(join('supabase', 'migrations')).filter((n) => n.endsWith('.sql'))
    expect(files.length).toBeGreaterThan(0)

    const doc = read(join('docs', 'data-model.md'))
    const missing = files.filter((n) => !doc.includes(n))
    expect(missing, 'เพิ่ม migration เหล่านี้ในตารางของ docs/data-model.md').toEqual([])
  })

  it('ลิงก์ .md ใน docs/ และ CLAUDE.md ชี้ไปไฟล์ที่มีอยู่จริง', () => {
    const sources = ['CLAUDE.md', ...walk('docs', (n) => n.endsWith('.md'))]
    const broken: string[] = []
    for (const src of sources) {
      for (const m of read(src).matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
        const target = m[1]!
        if (/^https?:/.test(target)) continue
        if (!existsSync(join(dirname(src), target))) broken.push(`${src} → ${target}`)
      }
    }
    expect(broken).toEqual([])
  })
})

describe('TV-56 ภาพ diagram ตรงกับต้นฉบับ', () => {
  const { all, found } = diagramsOf(read(join('docs', 'diagrams.md')))
  const html = read(join('docs', 'project-summary.html'))

  it('ทุก block mermaid มีชื่อไฟล์ <!-- svg: ... --> และไม่ซ้ำกัน', () => {
    expect(all).toBeGreaterThan(0)
    expect(found.length, 'ใส่ <!-- svg: ชื่อไฟล์ --> เหนือ ```mermaid ทุกอัน').toBe(all)
    const names = found.map((d) => d.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('ทุก diagram มีไฟล์ svg และไม่มี svg ค้างที่ไม่มีต้นฉบับ', () => {
    const files = readdirSync(join('docs', 'diagrams')).filter((n) => n.endsWith('.svg')).sort()
    expect(files, RERUN).toEqual(found.map((d) => `${d.name}.svg`).sort())
  })

  it('docs/diagrams/README.md บอกว่าไฟล์ไหนคือเรื่องอะไรครบทุกไฟล์', () => {
    const index = read(join('docs', 'diagrams', 'README.md'))
    const missing = found.filter((d) => !index.includes(`(${d.name}.svg)`) || !index.includes(d.title))
    expect(missing.map((d) => d.name), RERUN).toEqual([])
  })

  /**
   * ⛔ ตัวนี้คือเหตุผลที่มี hash — แก้ diagram ใน .md แล้วลืมสร้างภาพใหม่
   *    ภาพใน html กับ svg จะยังเป็นของเก่า ซึ่งคนอ่านจะเชื่อ เพราะดูสวยและดูเป็นทางการ
   */
  it('ภาพที่ฝังใน project-summary.html สร้างจากต้นฉบับปัจจุบัน', () => {
    const stale = found.filter((d) => {
      const tag = new RegExp(`<img class="dg" data-diagram="${d.name}"[^>]*>`).exec(html)?.[0] ?? ''
      return !tag.includes(`data-src-hash="${d.hash}"`) || !tag.includes('src="data:image/svg+xml;base64,')
    })
    expect(stale.map((d) => d.name), RERUN).toEqual([])
  })

  it('project-summary.html เปิดได้ตอนไม่มีเน็ต — ไม่โหลด script/style/รูปจากข้างนอก', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i)
    expect(html).not.toMatch(/<link[^>]+href=/i)
    expect(html).not.toMatch(/<img[^>]+src="(?!data:)[^"]+"/i)
    expect(html).not.toMatch(/url\(\s*['"]?https?:/i)
  })
})
