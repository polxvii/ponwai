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

export function setRememberMe(on: boolean): void {
  try {
    localStorage.setItem(REMEMBER_KEY, on ? '1' : '0')
  } catch {
    /* โหมดส่วนตัวเขียนไม่ได้ ถือว่าไม่จำ */
  }
}

export function getRememberMe(): boolean {
  try {
    // ค่าตั้งต้นคือจำ เพราะเป็นแอพที่เปิดซ้ำทุกเดือน ไม่ใช่เครื่องสาธารณะ
    return localStorage.getItem(REMEMBER_KEY) !== '0'
  } catch {
    return false
  }
}

const sessionStore: Storage | undefined =
  typeof window === 'undefined' ? undefined : window.sessionStorage

const switchableStorage = {
  getItem: (k: string): string | null =>
    localStorage.getItem(k) ?? sessionStore?.getItem(k) ?? null,
  setItem: (k: string, v: string): void => {
    if (getRememberMe()) {
      localStorage.setItem(k, v)
      sessionStore?.removeItem(k)
    } else {
      sessionStore?.setItem(k, v)
      localStorage.removeItem(k)
    }
  },
  removeItem: (k: string): void => {
    localStorage.removeItem(k)
    sessionStore?.removeItem(k)
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
