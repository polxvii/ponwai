/**
 * สถานะการล็อกอิน
 *
 * ⚠️ Compare Mode ใช้ได้โดยไม่ต้องล็อกอิน — เป็นเครื่องคิดเลข ไม่มีข้อมูลส่วนตัว
 *    สิ่งที่ต้องล็อกอินคือการ "บันทึก" และ Track Mode ทั้งหมด
 *    เพราะ RLS ทุก policy กรองด้วย auth.uid() ถ้าไม่มี session จะไม่เห็นอะไรเลย
 *
 * ⚠️ auth.users ใช้ร่วมกับอีกแอพใน Supabase project เดียวกัน (GoTrue มีชุดเดียวต่อ project)
 *    ผู้ใช้ของอีกแอพล็อกอินเข้ามาได้ แต่เห็นหน้าว่าง เพราะ RLS กรองด้วย user_id
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, supabasePublishableKey, supabaseUrl } from './supabase'

type AuthState = {
  /** null = ยังไม่ได้ล็อกอิน, undefined ไม่มี — loading แยกตัวแปร */
  user: User | null
  session: Session | null
  /** ยังอ่าน session จาก storage ไม่เสร็จ — อย่าเพิ่งตัดสินว่าไม่ได้ล็อกอิน */
  loading: boolean
}

const AuthContext = createContext<AuthState>({ user: null, session: null, loading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, session: null, loading: true })

  useEffect(() => {
    let alive = true

    supabase.auth.getSession().then(({ data }) => {
      if (alive) setState({ user: data.session?.user ?? null, session: data.session, loading: false })
    })

    // ครอบคลุมทั้ง sign in / sign out / token refresh / กลับมาจาก OAuth redirect
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ user: session?.user ?? null, session, loading: false })
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

/**
 * provider ที่เปิดใช้อยู่จริงในโครงการ
 *
 * ⚠️ จำเป็น ไม่ใช่ของแถม — signInWithOAuth ไม่ได้ยิง API แล้วรอผล
 *    มันเซ็ต window.location.href ไปที่ GoTrue ตรง ๆ ถ้า provider ปิด
 *    GoTrue ตอบ JSON 400 แล้วเบราว์เซอร์แสดง JSON ดิบให้ผู้ใช้เห็น
 *    โค้ดแปล error ฝั่งเราไม่มีโอกาสทำงานเพราะออกจากหน้าไปแล้ว
 *    ทางเดียวคือไม่แสดงปุ่มที่กดไปแล้วพัง
 */
export async function fetchEnabledProviders(): Promise<Set<string>> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabasePublishableKey },
    })
    if (!res.ok) return new Set()
    const json = (await res.json()) as { external?: Record<string, boolean> }
    return new Set(
      Object.entries(json.external ?? {})
        .filter(([, on]) => on)
        .map(([name]) => name),
    )
  } catch {
    // ออฟไลน์หรือ endpoint เปลี่ยน — ถือว่าไม่มี provider นอก ยังล็อกอินด้วยอีเมลได้
    return new Set()
  }
}
