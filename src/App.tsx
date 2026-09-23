import { useState } from 'react'
import { Logo } from './components/Logo'
import { AppBanners } from './components/AppBanners'
import { AuthProvider, useAuth, signOut } from './lib/auth'
import { SignInDialog } from './features/auth/SignInDialog'
import { ComparePage } from './features/compare/ComparePage'
import { RefinancePage } from './features/refinance/RefinancePage'
import { TrackPage } from './features/track/TrackPage'

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
type Tab = 'compare' | 'refinance' | 'track'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'compare', label: 'เปรียบเทียบ', hint: 'ก่อนเซ็นสัญญา' },
  { id: 'refinance', label: 'รีไฟแนนซ์', hint: 'ผ่อนอยู่แล้ว' },
  { id: 'track', label: 'ติดตาม', hint: 'สัญญาของฉัน' },
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
      {/*
        ⛔ ห้ามปล่อยให้แถบนี้ห่อบรรทัด
           คำอธิบายใต้แท็บกินความกว้างเกินที่จอแคบมี แล้วข้อความตัดกลางคำ
           เช่น "ก่อนเซ็น / สัญญา" ซึ่งอ่านยากกว่าไม่มีคำอธิบายเลย
           จอแคบจึงซ่อนคำอธิบาย เหลือป้ายบรรทัดเดียว และเลื่อนแนวนอนได้ถ้ายังไม่พอ
      */}
      <nav className="border-b border-[var(--color-rule)]">
        <div className="mx-auto flex max-w-[1440px] items-stretch gap-1 px-4 sm:px-6 lg:px-8">
          <span className="flex shrink-0 items-center py-2.5 sm:mr-4">
            <Logo />
          </span>

          <div className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                title={t.hint}
                className={`tap -mb-px shrink-0 border-b-2 px-1.5 pt-3 pb-2 text-left whitespace-nowrap sm:px-3 ${
                  tab === t.id
                    ? 'border-[var(--color-principal)] text-[var(--color-ink)]'
                    : 'border-transparent text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
                }`}
              >
                {/* จอแคบใช้ขนาดเล็กลง ไม่งั้น 3 แท็บ + ปุ่มบัญชี ล้นจนป้ายถูกตัดกลางคำ */}
                <span className="block text-[var(--text-meta)] sm:text-[var(--text-row)]">
                  {t.label}
                </span>
                <span className="hidden text-[var(--text-micro)] text-[var(--color-ink-3)] sm:block">
                  {t.hint}
                </span>
              </button>
            ))}
          </div>

          <AccountButton onSignIn={() => setSigningIn(true)} />
        </div>
      </nav>

      {tab === 'compare' && <ComparePage />}
      {tab === 'refinance' && <RefinancePage />}
      {tab === 'track' && <TrackPage onSignIn={() => setSigningIn(true)} />}

      {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
      <AppBanners />
    </>
  )
}

function AccountButton({ onSignIn }: { onSignIn: () => void }) {
  const { user, loading } = useAuth()

  // ระหว่างอ่าน session ห้ามโชว์ "เข้าสู่ระบบ" ชั่วคราวแล้วเด้งเป็นอีเมล — กะพริบทุกครั้งที่โหลด
  if (loading) return <span className="ml-auto shrink-0 py-3" />

  if (!user) {
    return (
      <button
        onClick={onSignIn}
        className="tap ml-auto shrink-0 py-3 text-[var(--text-meta)] whitespace-nowrap text-[var(--color-interest)] hover:underline"
      >
        เข้าสู่ระบบ
      </button>
    )
  }

  return (
    <span className="ml-auto flex shrink-0 items-center gap-3 py-3 text-[var(--text-meta)]">
      {/* อีเมลยาวกินที่ทั้งแถบ จอแคบซ่อนไว้ใน title ของปุ่มออกแทน */}
      <span
        className="hidden max-w-[180px] truncate text-[var(--color-ink-2)] md:inline"
        title={user.email ?? ''}
      >
        {user.email ?? 'เข้าสู่ระบบแล้ว'}
      </span>
      <button
        onClick={() => void signOut()}
        title={user.email ?? ''}
        className="tap whitespace-nowrap text-[var(--color-ink-3)] hover:underline"
      >
        ออก
      </button>
    </span>
  )
}
