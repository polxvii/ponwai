/**
 * ตรวจว่า Supabase ต่อได้จริง แยกแยะสาเหตุเมื่อพัง
 *
 *   schema ไม่ถูก expose  -> PGRST106 "The schema must be one of the following"
 *   ตารางไม่มี            -> PGRST205 / 42P01
 *   RLS บล็อก             -> ต่อได้ คืน [] (ถูกต้อง เพราะ anon ไม่มีสิทธิ์)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(process.argv[2], 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
console.log(`URL: ${url}`)
console.log(`key: ${key.slice(0, 22)}...`)
console.log()

const sb = createClient(url, key, { db: { schema: 'ponwai' } })

let failed = false

async function probe(label, fn) {
  const { data, error, count } = await fn()
  if (error) {
    console.log(`  ✗ ${label}`)
    console.log(`     code: ${error.code}  ${error.message}`)
    if (error.code === 'PGRST106') {
      console.log("     -> ยังไม่ได้เพิ่ม 'ponwai' ใน Settings > API > Exposed schemas")
    }
    if (error.code === 'PGRST205' || error.code === '42P01') {
      console.log('     -> ยังไม่ได้รัน migration หรือรันผิด schema')
    }
    failed = true
    return null
  }
  console.log(`  ✓ ${label}${count !== null && count !== undefined ? `  (นับได้ ${count})` : ''}`)
  return data
}

console.log('เชื่อมต่อและอ่านตาราง')
await probe('banks เข้าถึงได้', () => sb.from('banks').select('bank_code').limit(1))
await probe('active_loans เข้าถึงได้', () => sb.from('active_loans').select('id').limit(1))
await probe('bank_holidays เข้าถึงได้', () => sb.from('bank_holidays').select('holiday_date').limit(1))

console.log()
console.log('ตรวจว่า RLS กันจริง (anon ต้องไม่เห็นข้อมูลของใคร)')
const { data: props, error: pErr } = await sb.from('properties').select('id')
if (pErr) {
  console.log(`  ✗ properties: ${pErr.code} ${pErr.message}`)
  failed = true
} else if (props.length === 0) {
  console.log('  ✓ properties คืน 0 แถว — RLS ทำงาน (anon ไม่มีสิทธิ์)')
} else {
  console.log(`  ✗ properties คืน ${props.length} แถวให้ anon — RLS ไม่ทำงาน!`)
  failed = true
}

console.log()
console.log('ตรวจว่าเขียนไม่ได้ถ้าไม่ล็อกอิน')
const { error: wErr } = await sb.from('properties').insert({ name: 'ทดสอบ' })
if (wErr) {
  console.log(`  ✓ insert ถูกปฏิเสธ — ${wErr.code}`)
} else {
  console.log('  ✗ anon เขียนได้! RLS มีช่องโหว่')
  failed = true
}

console.log()
console.log(failed ? '=== มีปัญหา ดูด้านบน ===' : '=== ผ่านทั้งหมด Supabase พร้อมใช้ ===')
process.exit(failed ? 1 : 0)
