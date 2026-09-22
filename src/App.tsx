import { useState } from 'react'
import { Logo } from './components/Logo'
import { AuthProvider, useAuth, signOut } from './lib/auth'
import { SignInDialog } from './features/auth/SignInDialog'
import { ComparePage } from './features/compare/ComparePage'
import { RefinancePage } from './features/refinance/RefinancePage'

/**
 * 2 โหมดหลัก ใช้ engine คำนวณตัวเดียวกัน (spec ข้อ 0)
 *
 * Compare   ก่อนเซ็นสัญญา
 * Refinance ไม่ใช่ feature ย่อย แต่เป็นโหมดหลักเท่ากับ Compare
 *           เพราะผู้ใช้จะกลับมาใช้ทุก 3 ปีตลอดอายุสัญญา (ข้อ 2A)
 *
 * ทั้งสองโหมดใช้ได้โดยไม่ต้องล็อกอิน — เป็นเครื่องคิดเลข ไม่มีข้อมูลส่วนตัว
 * การบันทึกและ Track Mode ถึงจะต้องมีบัญชี
 */
type Tab = 'compare' | 'refinance'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'compare', label: 'เปรียบเทียบ', hint: 'ก่อนเซ็นสัญญา' },
  { id: 'refinance', label: 'รีไฟแนนซ์', hint: 'ผ่อนอยู่แล้ว' },
]

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}

function Shell() {
  const [tab, setTab] = useState<Tab>('compare')
  const [signingIn, setSigningIn] = useState(false)

  return (
    <>
      <nav className="border-b border-[var(--color-rule)]">
        <div className="mx-auto flex max-w-[1440px] items-end gap-1 px-4 sm:px-6 lg:px-8">
          <span className="mr-4 py-2.5">
            <Logo />
          </span>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`tap -mb-px border-b-2 px-3 pt-3 pb-2 text-left ${
                tab === t.id
                  ? 'border-[var(--color-principal)] text-[var(--color-ink)]'
                  : 'border-transparent text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
              }`}
            >
              <span className="block text-[var(--text-row)]">{t.label}</span>
              <span className="block text-[var(--text-micro)] text-[var(--color-ink-3)]">
                {t.hint}
              </span>
            </button>
          ))}

          <AccountButton onSignIn={() => setSigningIn(true)} />
        </div>
      </nav>

      {tab === 'compare' ? <ComparePage /> : <RefinancePage />}

      {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
    </>
  )
}

function AccountButton({ onSignIn }: { onSignIn: () => void }) {
  const { user, loading } = useAuth()

  // ระหว่างอ่าน session ห้ามโชว์ "เข้าสู่ระบบ" ชั่วคราวแล้วเด้งเป็นอีเมล — กะพริบทุกครั้งที่โหลด
  if (loading) return <span className="ml-auto py-3" />

  if (!user) {
    return (
      <button
        onClick={onSignIn}
        className="tap ml-auto py-3 text-[var(--text-meta)] text-[var(--color-interest)] hover:underline"
      >
        เข้าสู่ระบบ
      </button>
    )
  }

  return (
    <span className="ml-auto flex items-center gap-3 py-3 text-[var(--text-meta)]">
      <span className="text-[var(--color-ink-2)]" title={user.email ?? ''}>
        {user.email ?? 'เข้าสู่ระบบแล้ว'}
      </span>
      <button onClick={() => void signOut()} className="tap text-[var(--color-ink-3)] hover:underline">
        ออก
      </button>
    </span>
  )
}
