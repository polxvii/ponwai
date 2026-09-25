/**
 * copy ไฟล์คอนฟิกเฉพาะ Cloudflare Pages ลง dist/ หลัง build
 *
 * ทำไมไม่วางไว้ใน public/ ให้ vite copy ให้เอง: Worker กับ Pages ใช้ dist/ ก้อนเดียวกัน
 * แต่ wrangler อ่าน dist/_redirects แล้วยัดขึ้น API เป็น metadata ของ Worker
 * ทำให้ `wrangler deploy` ตาย ทั้งที่ Worker ไม่ได้ต้องใช้ไฟล์นี้เลย
 * (มี assets.not_found_handling ใน wrangler.jsonc ทำ SPA routing อยู่แล้ว)
 *
 * เขียนเป็น node แทน cp เพราะ npm script รันบน cmd ตอนอยู่ Windows ซึ่งไม่มี cp
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'deploy', 'pages')
const to = join(root, 'dist')

mkdirSync(to, { recursive: true })
for (const name of readdirSync(from)) {
  copyFileSync(join(from, name), join(to, name))
  console.log(`pages: copied ${name} -> dist/`)
}
