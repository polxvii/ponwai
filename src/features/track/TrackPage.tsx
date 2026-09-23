/**
 * Track Mode — สัญญาที่ผ่อนอยู่จริง
 *
 * โหมดเดียวที่ต้องล็อกอิน เพราะเป็นข้อมูลส่วนตัวและ RLS ทุก policy กรองด้วย auth.uid()
 * รองรับหลายหลัง คนหนึ่งมีสินเชื่อได้หลายสัญญา
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { baht, formatDuration, formatThaiDate } from '@/lib/format'
import { deleteLoan, getAllLoansFull, type LoanListItem } from '@/lib/db'
import { DashboardPage, type LoanBundle } from '../dashboard/DashboardPage'
import { PrepayPage } from '../prepay/PrepayPage'
import { buildSchedule } from '@engine/schedule.js'
import { toLoanTerms, toPaymentEvents } from '@/lib/db'
import { LoanForm } from './LoanForm'
import { LoanDetail } from './LoanDetail'
import { todayISO } from './model'

/**
 * Dashboard เป็นหน้าแรกเมื่อมีสัญญาแล้ว ไม่ใช่รายการสัญญา
 * เพราะคนที่ผ่อนอยู่เปิดแอพมาเพื่อดูว่า "ตอนนี้เหลือเท่าไหร่" ไม่ใช่เพื่อเลือกสัญญา
 */
type View =
  | { kind: 'dashboard' }
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'detail'; item: LoanListItem }
  | { kind: 'prepay'; item: LoanListItem }

export function TrackPage({ onSignIn }: { onSignIn: () => void }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <Shell><p className="text-[var(--color-ink-2)]">กำลังตรวจสอบบัญชี…</p></Shell>
  }

  if (!user) {
    return (
      <Shell>
        <div className="max-w-[520px] rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-6">
          <h1 className="text-[var(--text-lead)]">ติดตามสินเชื่อต้องเข้าสู่ระบบ</h1>
          <p className="mt-2 text-[var(--color-ink-2)]">
            ยอดหนี้ ค่างวด และประวัติการจ่าย เป็นข้อมูลส่วนตัว
            เก็บไว้ในบัญชีของคุณเพื่อให้เปิดจากเครื่องไหนก็เห็นข้อมูลเดิม และไม่มีใครอื่นเห็น
          </p>
          <p className="mt-2 text-[var(--text-meta)] text-[var(--color-ink-3)]">
            หน้าเปรียบเทียบกับรีไฟแนนซ์ใช้ได้เลยโดยไม่ต้องมีบัญชี
          </p>
          <button
            onClick={onSignIn}
            className="tap mt-4 rounded-md bg-[var(--color-interest)] px-4 py-2.5 text-[var(--color-panel-ink)]"
          >
            เข้าสู่ระบบ
          </button>
        </div>
      </Shell>
    )
  }

  return <TrackShell />
}

function TrackShell() {
  const [view, setView] = useState<View>({ kind: 'dashboard' })
  const [bundles, setBundles] = useState<LoanBundle[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setError(null)
    getAllLoansFull()
      .then(setBundles)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(reload, [reload])

  const items = bundles?.map((b) => b.item) ?? null

  if (view.kind === 'detail') {
    return (
      <LoanDetail
        item={view.item}
        onBack={() => {
          setView({ kind: 'dashboard' })
          reload()
        }}
        onPlanPrepay={() => setView({ kind: 'prepay', item: view.item })}
      />
    )
  }

  if (view.kind === 'prepay' && bundles !== null) {
    const bundle = bundles.find((b) => b.item.loanId === view.item.loanId)
    if (bundle) {
      // เพดานลดหย่อนภาษีเป็นของคนหนึ่งคน ต้องส่งสัญญาอื่นไปด้วย ไม่งั้นบอกว่า
      // โปะแล้วเสียสิทธิ ทั้งที่สิทธิเต็มไปแล้วจากอีกสัญญา (ข้อ 1.9)
      const others = bundles
        .filter((b) => b.item.loanId !== view.item.loanId)
        .map((b) => ({
          loanId: b.item.loanId,
          rows: buildSchedule(toLoanTerms(b.full), toPaymentEvents(b.full)).rows,
        }))
      return (
        <PrepayPage
          item={bundle.item}
          full={bundle.full}
          otherLoans={others}
          today={todayISO()}
          onBack={() => setView({ kind: 'detail', item: view.item })}
        />
      )
    }
  }

  if (view.kind === 'dashboard' && bundles !== null && bundles.length > 0) {
    return (
      <>
        <SubNav view="dashboard" onChange={(v) => setView({ kind: v })} />
        <DashboardPage
          bundles={bundles}
          today={todayISO()}
          onOpenLoan={(item) => setView({ kind: 'detail', item })}
        />
      </>
    )
  }

  if (view.kind === 'new') {
    return (
      <Shell>
        <LoanForm
          onCancel={() => setView({ kind: 'list' })}
          onDone={() => {
            setView({ kind: 'list' })
            reload()
          }}
        />
      </Shell>
    )
  }

  return (
    <>
      {items !== null && items.length > 0 && (
        <SubNav view="list" onChange={(v) => setView({ kind: v })} />
      )}
      <Shell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[var(--text-hero)]">สินเชื่อของฉัน</h1>
          <p className="mt-1 text-[var(--text-meta)] text-[var(--color-ink-2)]">
            ตารางผ่อนที่คิดจากการจ่ายจริง ไม่ใช่ตารางตั้งต้นของธนาคาร
          </p>
        </div>
        {items !== null && items.length > 0 && (
          <button
            onClick={() => setView({ kind: 'new' })}
            className="tap shrink-0 rounded-md bg-[var(--color-interest)] px-4 py-2.5 text-[var(--color-panel-ink)]"
          >
            + เพิ่มสัญญา
          </button>
        )}
      </header>

      {error && (
        <p className="rounded-md bg-[var(--color-warn)]/10 px-3 py-2 text-[var(--color-warn)]">
          {error}
        </p>
      )}

      {items === null && !error && <p className="text-[var(--color-ink-2)]">กำลังโหลด…</p>}

      {items !== null && items.length === 0 && (
        <div className="max-w-[520px] rounded-lg border border-dashed border-[var(--color-rule)] p-6">
          <h2 className="text-[var(--text-lead)]">ยังไม่มีสัญญา</h2>
          <p className="mt-2 text-[var(--color-ink-2)]">
            เอาสัญญาเงินกู้กับใบแจ้งยอดล่าสุดมากรอก แล้วแอพจะสร้างตารางผ่อนรายวันให้
            ตรงกับใบแจ้งยอดระดับสตางค์
          </p>
          <button
            onClick={() => setView({ kind: 'new' })}
            className="tap mt-4 rounded-md bg-[var(--color-interest)] px-4 py-2.5 text-[var(--color-panel-ink)]"
          >
            + เพิ่มสัญญาแรก
          </button>
        </div>
      )}

      {items !== null && items.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <LoanCard
              key={it.loanId}
              item={it}
              onOpen={() => setView({ kind: 'detail', item: it })}
              onDeleted={reload}
            />
          ))}
        </ul>
      )}
      </Shell>
    </>
  )
}

function SubNav({
  view,
  onChange,
}: {
  view: 'dashboard' | 'list'
  onChange: (v: 'dashboard' | 'list') => void
}) {
  return (
    <div className="mx-auto flex max-w-[1440px] gap-1 px-4 pt-4 sm:px-6 lg:px-8">
      {([
        { id: 'dashboard' as const, label: 'ภาพรวม' },
        { id: 'list' as const, label: 'สัญญาทั้งหมด' },
      ]).map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          aria-current={view === t.id ? 'page' : undefined}
          className={`tap rounded-md px-3 py-1.5 text-[var(--text-meta)] ${
            view === t.id
              ? 'bg-[var(--color-interest-tint)] text-[var(--color-interest)]'
              : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

const ORIGIN_LABELS: Record<LoanListItem['origin'], string> = {
  new_purchase: 'ซื้อใหม่',
  refinance: 'รีไฟแนนซ์',
  retention: 'ขอลดดอก',
}

function LoanCard({
  item,
  onOpen,
  onDeleted,
}: {
  item: LoanListItem
  onOpen: () => void
  onDeleted: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function drop() {
    setBusy(true)
    try {
      await deleteLoan(item.loanId)
      onDeleted()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-4">
      <button onClick={onOpen} className="tap block w-full text-left">
        <h2 className="text-[var(--text-lead)]">{item.propertyName}</h2>
        <p className="text-[var(--text-meta)] text-[var(--color-ink-2)]">
          {item.bankLabel} · {ORIGIN_LABELS[item.origin]}
          {item.status === 'closed' && ' · ปิดแล้ว'}
        </p>

        <dl className="mt-3 space-y-1 text-[var(--text-meta)]">
          <Row k="วงเงิน" v={baht(item.disbursedSatang, 0)} />
          <Row k="ค่างวด" v={baht(item.installmentSatang, 0)} />
          <Row k="ระยะเวลา" v={formatDuration(item.termMonths)} />
          <Row k="งวดแรก" v={formatThaiDate(item.firstDueDate)} />
        </dl>
      </button>

      <div className="mt-3 flex items-center justify-between border-t border-[var(--color-rule)] pt-3">
        <button
          onClick={onOpen}
          className="tap text-[var(--text-meta)] text-[var(--color-interest)] hover:underline"
        >
          ดูตารางผ่อน →
        </button>

        {confirming ? (
          <span className="flex items-center gap-2 text-[var(--text-meta)]">
            <button
              onClick={() => void drop()}
              disabled={busy}
              className="tap text-[var(--color-warn)] disabled:opacity-50"
            >
              ลบทั้งสัญญา
            </button>
            <button onClick={() => setConfirming(false)} className="tap text-[var(--color-ink-3)]">
              ยกเลิก
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="tap text-[var(--text-meta)] text-[var(--color-ink-3)] hover:text-[var(--color-warn)]"
          >
            ลบ
          </button>
        )}
      </div>
    </li>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-[var(--color-ink-2)]">{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">{children}</div>
}
