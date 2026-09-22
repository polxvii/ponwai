import { createClient } from '@supabase/supabase-js'

/**
 * Supabase client
 *
 * ⚠️ แอพนี้ใช้ Supabase project ร่วมกับแอพอื่น (free tier ให้ 2 project)
 *    ตารางทั้งหมดอยู่ใน schema `ponwai` ไม่ใช่ `public`
 *    ถ้าไม่ตั้ง db.schema จะ query ไม่เจออะไรเลยและ error ไม่ได้บอกสาเหตุตรง ๆ
 *
 * ⚠️ auth.users ใช้ร่วมกับอีกแอพ — GoTrue มีชุดเดียวต่อ project
 *    ผู้ใช้ของอีกแอพล็อกอินเข้ามาได้ แต่เห็นหน้าว่างเพราะ RLS กรองด้วย user_id
 */

const url = import.meta.env['VITE_SUPABASE_URL']
const key = import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY']

if (!url || !key) {
  throw new Error(
    'ไม่พบ VITE_SUPABASE_URL หรือ VITE_SUPABASE_PUBLISHABLE_KEY — คัดลอก .env.example เป็น .env แล้วเติมค่า',
  )
}

/** ต้องใช้ตอนเรียก endpoint ของ GoTrue ตรง ๆ ที่ client library ไม่ได้ห่อไว้ */
export const supabaseUrl = url
export const supabasePublishableKey = key

/**
 * "จำฉันไว้"
 *
 * Supabase เลือกที่เก็บ session ตอนสร้าง client ซึ่งเกิดก่อนผู้ใช้จะติ๊กช่อง
 * จึงต้องใช้ storage ที่ตัดสินใจตอนเขียน ไม่ใช่ตอนสร้าง
 *   จำ    -> localStorage   อยู่ข้ามการปิดเบราว์เซอร์
 *   ไม่จำ -> sessionStorage หายเมื่อปิดแท็บ
 * ต้องลบอีกฝั่งทุกครั้งที่เขียน ไม่งั้นค่าเก่าค้างแล้วกลายเป็น "จำ" ทั้งที่ไม่ได้ติ๊ก
 */
const REMEMBER_KEY = 'ponwai:auth:remember'

/**
 * ⚠️ ห้ามอ้าง localStorage/sessionStorage ตรง ๆ
 *    ไฟล์นี้ถูก import ในเทสต์ที่รันบน Node ซึ่งไม่มีทั้งสองตัว
 *    อ้างตรง ๆ แล้วจะได้ ReferenceError ตอน import ไม่ใช่ตอนเรียกใช้
 *    และพังทั้งไฟล์ก่อนที่เทสต์ตัวแรกจะได้รัน
 */
/**
 * ที่เก็บสำรองในหน่วยความจำ
 * ใช้เมื่อไม่มี Web Storage เลย เช่นตอนรันเทสต์บน Node
 * ถ้าไม่มีตัวนี้ getSession() จะคืนค่าว่างทั้งที่ล็อกอินสำเร็จ
 * เพราะ supabase-js อ่าน session จาก storage ไม่ใช่จากตัวแปรในหน่วยความจำ
 */
const memoryStore = new Map<string, string>()

function store(kind: 'local' | 'session'): Storage | null {
  if (typeof globalThis === 'undefined') return null
  try {
    const s = kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage
    return s ?? null
  } catch {
    return null
  }
}

export function setRememberMe(on: boolean): void {
  try {
    store('local')?.setItem(REMEMBER_KEY, on ? '1' : '0')
  } catch {
    /* โหมดส่วนตัวเขียนไม่ได้ ถือว่าไม่จำ */
  }
}

export function getRememberMe(): boolean {
  // ค่าตั้งต้นคือจำ เพราะเป็นแอพที่เปิดซ้ำทุกเดือน ไม่ใช่เครื่องสาธารณะ
  return store('local')?.getItem(REMEMBER_KEY) !== '0'
}

const hasWebStorage = (): boolean => store('local') !== null || store('session') !== null

const switchableStorage = {
  getItem: (k: string): string | null => {
    if (!hasWebStorage()) return memoryStore.get(k) ?? null
    return store('local')?.getItem(k) ?? store('session')?.getItem(k) ?? null
  },
  setItem: (k: string, v: string): void => {
    if (!hasWebStorage()) {
      memoryStore.set(k, v)
      return
    }
    // ลบอีกฝั่งทุกครั้ง ไม่งั้นค่าเก่าค้างแล้วกลายเป็น "จำ" ทั้งที่ไม่ได้ติ๊ก
    if (getRememberMe()) {
      store('local')?.setItem(k, v)
      store('session')?.removeItem(k)
    } else {
      store('session')?.setItem(k, v)
      store('local')?.removeItem(k)
    }
  },
  removeItem: (k: string): void => {
    memoryStore.delete(k)
    store('local')?.removeItem(k)
    store('session')?.removeItem(k)
  },
}

export const supabase = createClient(url, key, {
  db: { schema: 'ponwai' },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: switchableStorage,
  },
})

export type SupabaseClient = typeof supabase
