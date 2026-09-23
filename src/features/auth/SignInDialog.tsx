/**
 * กล่องเข้าสู่ระบบ
 *
 * เป็น dialog ไม่ใช่หน้าแยก เพราะ Compare Mode ต้องใช้ได้โดยไม่ต้องล็อกอิน
 * บังคับล็อกอินก่อนเห็นอะไรเลย = ผู้ใช้ที่แค่อยากลองคำนวณจะปิดทิ้ง
 *
 * รองรับ 2 ทาง
 *   Google   แสดงปุ่มเฉพาะเมื่อเปิด provider ไว้จริง ดู fetchEnabledProviders
 *   อีเมล    ใช้ได้ทันทีโดยไม่ต้องตั้งค่าอะไรเพิ่ม
 */

import { useEffect, useState, type FormEvent } from 'react'
import { supabase, getRememberMe, setRememberMe } from '@/lib/supabase'
import { fetchEnabledProviders } from '@/lib/auth'

type Mode = 'signin' | 'signup'

export function SignInDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  /** null = ยังไม่รู้ ห้ามเดาว่ามี ไม่งั้นปุ่มจะกะพริบแล้วหายไป */
  const [providers, setProviders] = useState<Set<string> | null>(null)
  const [remember, setRemember] = useState(getRememberMe)

  useEffect(() => {
    let alive = true
    fetchEnabledProviders().then((p) => alive && setProviders(p))
    return () => {
      alive = false
    }
  }, [])

  /**
   * ปลดล็อกปุ่มเมื่อกลับมาจากหน้าอื่น
   *
   * ⚠️ กด OAuth แล้วเบราว์เซอร์ออกไปทั้งที่ busy = true พอกด Back
   *    Firefox คืนหน้าจาก bfcache พร้อม state เดิม ปุ่มทุกปุ่มค้าง disabled
   *    แล้วผู้ใช้กดอะไรไม่ได้เลยโดยไม่มีข้อความบอกสาเหตุ
   */
  useEffect(() => {
    const unlock = () => setBusy(false)
    window.addEventListener('pageshow', unlock)
    return () => window.removeEventListener('pageshow', unlock)
  }, [])

  async function withGoogle() {
    setBusy(true)
    setMessage(null)
    setRememberMe(remember)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      setBusy(false)
      setMessage({ tone: 'warn', text: translate(error.message) })
    }
    // สำเร็จ = เบราว์เซอร์ออกไป Google แล้ว ไม่ต้อง setBusy(false)
  }

  async function withEmail(e: FormEvent) {
    e.preventDefault()

    // ตรวจเองก่อน ไม่พึ่ง required ของเบราว์เซอร์อย่างเดียว
    // เพราะถ้า validation ของเบราว์เซอร์บล็อก ผู้ใช้จะเห็นแค่ "กดแล้วไม่มีอะไรเกิดขึ้น"
    if (email.trim() === '') return setMessage({ tone: 'warn', text: 'กรอกอีเมล' })
    if (password.length < 6) {
      return setMessage({ tone: 'warn', text: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัว' })
    }

    // ต้องตั้งก่อนล็อกอิน เพราะ storage อ่านค่านี้ตอนเขียน session
    setRememberMe(remember)
    setBusy(true)
    setMessage(null)

    const fn = mode === 'signin' ? supabase.auth.signInWithPassword : supabase.auth.signUp
    const { data, error } = await fn.call(supabase.auth, { email, password })

    setBusy(false)
    if (error) return setMessage({ tone: 'warn', text: translate(error.message) })

    // สมัครแล้วไม่ได้ session = โครงการเปิด "Confirm email" ไว้ ต้องไปกดลิงก์ในอีเมลก่อน
    if (mode === 'signup' && !data.session) {
      return setMessage({ tone: 'ok', text: 'ส่งลิงก์ยืนยันไปที่อีเมลแล้ว กดลิงก์แล้วกลับมาเข้าสู่ระบบ' })
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink)]/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="เข้าสู่ระบบ"
        className="w-full max-w-[380px] rounded-lg bg-[var(--color-paper-raised)] p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lead">
          {mode === 'signin' ? 'เข้าสู่ระบบ' : 'สมัครใช้งาน'}
        </h2>
        <p className="mt-1 text-meta text-[var(--color-ink-2)]">
          ข้อมูลสินเชื่อเป็นเรื่องส่วนตัว บัญชีนี้ทำให้เห็นได้เฉพาะคุณคนเดียว
        </p>

        {providers?.has('google') && (
          <>
            <button
              type="button"
              onClick={withGoogle}
              disabled={busy}
              className="tap mt-5 flex w-full items-center justify-center gap-2 rounded-md border border-[var(--color-rule)] px-3 py-2.5 hover:bg-[var(--color-paper)] disabled:opacity-50"
            >
              <GoogleG />
              ใช้บัญชี Google
            </button>

            <div className="my-4 flex items-center gap-3 text-meta text-[var(--color-ink-3)]">
              <span className="h-px flex-1 bg-[var(--color-rule)]" />
              หรือ
              <span className="h-px flex-1 bg-[var(--color-rule)]" />
            </div>
          </>
        )}

        <form onSubmit={withEmail} className={providers?.has('google') ? 'space-y-3' : 'mt-5 space-y-3'}>
          <label className="block">
            <span className="block text-meta text-[var(--color-ink-2)]">อีเมล</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="block text-meta text-[var(--color-ink-2)]">รหัสผ่าน</span>
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="tap flex cursor-pointer items-start gap-2 py-1">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-interest)]"
            />
            <span className="text-meta">
              จำฉันไว้
              <span className="block text-[var(--color-ink-3)]">
                {remember
                  ? 'เปิดแอพครั้งหน้าไม่ต้องล็อกอินใหม่'
                  : 'ออกจากระบบเองเมื่อปิดแท็บ — เหมาะกับเครื่องที่ใช้ร่วมกับคนอื่น'}
              </span>
            </span>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="tap w-full rounded-md bg-[var(--color-interest)] px-3 py-2.5 text-[var(--color-panel-ink)] disabled:opacity-50"
          >
            {busy ? 'กำลังดำเนินการ…' : mode === 'signin' ? 'เข้าสู่ระบบ' : 'สมัครใช้งาน'}
          </button>
        </form>

        {message && (
          <p
            className={`mt-3 rounded-md px-3 py-2 text-meta ${
              message.tone === 'warn'
                ? 'bg-[var(--color-warn)]/10 text-[var(--color-warn)]'
                : 'bg-[var(--color-ok)]/10 text-[var(--color-ok)]'
            }`}
          >
            {message.text}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between text-meta">
          <button
            type="button"
            className="tap text-[var(--color-interest)] underline-offset-2 hover:underline"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setMessage(null)
            }}
          >
            {mode === 'signin' ? 'ยังไม่มีบัญชี สมัครใหม่' : 'มีบัญชีแล้ว เข้าสู่ระบบ'}
          </button>
          <button type="button" className="tap text-[var(--color-ink-2)]" onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  )
}

const inputClass =
  'tap mt-1 w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-raised)] ' +
  'px-3 py-2 focus:border-[var(--color-interest)] focus:outline-2 focus:outline-offset-1 ' +
  'focus:outline-[var(--color-interest)]'

/** ข้อความ error ของ GoTrue เป็นอังกฤษล้วน แปลเฉพาะอันที่เจอบ่อย ที่เหลือส่งต่อดิบ ๆ */
function translate(msg: string): string {
  if (msg.includes('Invalid login credentials')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
  if (msg.includes('User already registered')) return 'อีเมลนี้สมัครไว้แล้ว ลองเข้าสู่ระบบแทน'
  if (msg.includes('Password should be at least')) return 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัว'
  if (msg.includes('Email not confirmed')) return 'ยังไม่ได้ยืนยันอีเมล กดลิงก์ในอีเมลก่อน'
  if (msg.includes('provider is not enabled')) {
    return 'ยังไม่ได้เปิด Google ใน Supabase (Authentication → Providers)'
  }
  if (msg.includes('rate limit') || msg.includes('Too many')) {
    return 'ขอบ่อยเกินไป รอสักครู่แล้วลองใหม่'
  }
  return msg
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-15.7" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-.3.1-6.8 5.2-.1.3C7.9 41 15.4 46 24 46" />
      <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4v-.3l-6.9-5.4-.2.1C2.9 17 2 20.4 2 24s.9 7 2.4 10z" />
      <path fill="#EA4335" d="M24 10.4c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.2 29.9 2 24 2 15.4 2 7.9 7 4.4 14l7.1 5.6c1.8-5.3 6.7-9.2 12.5-9.2" />
    </svg>
  )
}
