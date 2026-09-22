import { useState } from 'react'
import { Logo } from './components/Logo'
import { ComparePage } from './features/compare/ComparePage'
import { RefinancePage } from './features/refinance/RefinancePage'

/**
 * 2 โหมดหลัก ใช้ engine คำนวณตัวเดียวกัน (spec ข้อ 0)
 *
 * Compare   ก่อนเซ็นสัญญา
 * Refinance ไม่ใช่ feature ย่อย แต่เป็นโหมดหลักเท่ากับ Compare
 *           เพราะผู้ใช้จะกลับมาใช้ทุก 3 ปีตลอดอายุสัญญา (ข้อ 2A)
 */
type Tab = 'compare' | 'refinance'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'compare', label: 'เปรียบเทียบ', hint: 'ก่อนเซ็นสัญญา' },
  { id: 'refinance', label: 'รีไฟแนนซ์', hint: 'ผ่อนอยู่แล้ว' },
]

export function App() {
  const [tab, setTab] = useState<Tab>('compare')

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
        </div>
      </nav>

      {tab === 'compare' ? <ComparePage /> : <RefinancePage />}
    </>
  )
}
