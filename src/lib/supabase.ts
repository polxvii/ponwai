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

export const supabase = createClient(url, key, {
  db: { schema: 'ponwai' },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export type SupabaseClient = typeof supabase
