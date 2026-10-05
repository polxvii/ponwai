/**
 * Track Mode — สัญญาที่ผ่อนอยู่จริง
 *
 * โหมดเดียวที่ต้องล็อกอิน เพราะเป็นข้อมูลส่วนตัวและ RLS ทุก policy กรองด้วย auth.uid()
 * รองรับหลายหลัง คนหนึ่งมีสินเชื่อได้หลายสัญญา
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { baht, formatDuration, formatThaiDate } from '@/lib/format'
import { BankMark } from '@/components/BankMark'
import { deleteLoan, getAllLoansFull, type LoanFull, type LoanListItem } from '@/lib/db'
import { CLOSING_REASON_LABELS, rowsUntilClose } from '@/lib/closing'
import { DashboardPage, type LoanBundle } from '../dashboard/DashboardPage'
import { PrepayPage } from '../prepay/PrepayPage'
import { ReconcilePage } from '../reconcile/ReconcilePage'
import { buildSchedule } from '@engine/schedule.js'
import { toLoanTerms, toPaymentEvents } from '@/lib/db'
import { LoanForm } from './LoanForm'
import { LoanDetail } from './LoanDetail'
import { todayISO, toLoanDraft } from './model'

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
  | { kind: 'reconcile'; item: LoanListItem }
  | { kind: 'edit'; item: LoanListItem; full: LoanFull }

export function TrackPage({ onSignIn }: { onSignIn: () => void }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <Shell><p className="text-[var(--color-ink-2)]">กำลังตรวจสอบบัญชี…</p></Shell>
  }

  if (!user) {
    return (
      <Shell>
        <div className="max-w-[520px] rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-6">
          <h1 className="text-lead">ติดตามสินเชื่อต้องเข้าสู่ระบบ</h1>
          <p className="mt-2 text-[var(--color-ink-2)]">
            ยอดหนี้ ค่างวด และประวัติการจ่าย เป็นข้อมูลส่วนตัว
            เก็บไว้ในบัญชีของคุณเพื่อให้เปิดจากเครื่องไหนก็เห็นข้อมูลเดิม และไม่มีใครอื่นเห็น
          </p>
          <p className="mt-2 text-meta text-[var(--color-ink-3)]">
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

  /**
   * ตารางของสัญญาหนึ่ง ตัดที่วันปิดแล้ว
   *
   * ⛔ ใช้ตัวนี้ทุกครั้งที่ส่ง rows ของสัญญา "อื่น" ไปคิดเพดานลดหย่อนร่วม
   *    สัญญาที่ปิดไปแล้วยังมีงวดในอนาคตอยู่ในตาราง ถ้าไม่ตัด หน้าโปะจะบอกว่า
   *    สิทธิลดหย่อนเต็มแล้ว ทั้งที่หนี้ก้อนนั้นย้ายไปสัญญาใหม่ตั้งแต่ปีที่แล้ว
   */
  const rowsOf = (b: LoanBundle) =>
    rowsUntilClose(
      buildSchedule(toLoanTerms(b.full), toPaymentEvents(b.full), b.plan ?? undefined).rows,
      b.item.status === 'closed' ? b.item.closedDate : null,
    )

  const items = bundles?.map((b) => b.item) ?? null
  const active = items?.filter((i) => i.status === 'active') ?? []
  const closed = items?.filter((i) => i.status === 'closed') ?? []

  if (view.kind === 'detail') {
    /* ⚠️ view.item เป็นสำเนาตอนกดเข้ามา ปิด/เปิดสัญญาแล้วต้องหยิบตัวใหม่จาก bundles
       ไม่งั้นกดปิดเสร็จแล้วหน้ายังบอกว่ายังผ่อนอยู่ ทั้งที่ DB เปลี่ยนไปแล้ว */
    const fresh = items?.find((i) => i.loanId === view.item.loanId) ?? view.item
    return (
      <LoanDetail
        item={fresh}
        allLoans={items ?? []}
        onClosedChanged={reload}
        /* เพดานลดหย่อนเป็นของคนหนึ่งคน รายงานที่ส่งออกต้องนับสัญญาอื่นด้วย (ข้อ 1.9) */
        otherLoans={(bundles ?? [])
          .filter((b) => b.item.loanId !== view.item.loanId)
          .map((b) => ({ loanId: b.item.loanId, rows: rowsOf(b) }))}
        onBack={() => {
          setView({ kind: 'dashboard' })
          reload()
        }}
        /* ⚠️ ต้อง reload ก่อนออกจากหน้านี้
           bundles ถูกโหลดครั้งเดียวตอน mount ส่วนหน้ารายละเอียดโหลดสัญญาของตัวเองแยก
           แก้ยอดจ่ายที่นี่แล้วเด้งไปวางแผนโปะ จะได้ข้อมูลเก่าที่ยังไม่มีการแก้
           ซึ่งทำให้ยอดที่จ่ายเกินค่างวดไม่ขึ้นในปฏิทิน ทั้งที่บันทึกไปแล้ว */
        onPlanPrepay={() => {
          reload()
          setView({ kind: 'prepay', item: view.item })
        }}
        onReconcile={() => {
          reload()
          setView({ kind: 'reconcile', item: view.item })
        }}
        onEdit={(full) => setView({ kind: 'edit', item: view.item, full })}
      />
    )
  }

  if (view.kind === 'edit') {
    return (
      <Shell>
        <LoanForm
          edit={{
            loanId: view.item.loanId,
            draft: toLoanDraft(view.full),
            conventionConfirmed: !view.full.conventionAssumed,
          }}
          onCancel={() => setView({ kind: 'detail', item: view.item })}
          onDone={() => {
            // กลับไปหน้ารายการ ไม่ใช่หน้ารายละเอียด
            // เพราะ item ที่ถืออยู่เป็นของเก่า ยอด/ชื่อที่เพิ่งแก้จะยังไม่อัปเดต
            setView({ kind: 'list' })
            reload()
          }}
        />
      </Shell>
    )
  }

  if (view.kind === 'prepay' && bundles !== null) {
    const bundle = bundles.find((b) => b.item.loanId === view.item.loanId)
    if (bundle) {
      // เพดานลดหย่อนภาษีเป็นของคนหนึ่งคน ต้องส่งสัญญาอื่นไปด้วย ไม่งั้นบอกว่า
      // โปะแล้วเสียสิทธิ ทั้งที่สิทธิเต็มไปแล้วจากอีกสัญญา (ข้อ 1.9)
      // ใส่แผนโปะของสัญญานั้นด้วย ไม่งั้นเพดานภาษีคิดจากดอกที่ไม่ตรงกับหน้าอื่น
      const others = bundles
        .filter((b) => b.item.loanId !== view.item.loanId)
        .map((b) => ({ loanId: b.item.loanId, rows: rowsOf(b) }))
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

  if (view.kind === 'reconcile' && bundles !== null) {
    const bundle = bundles.find((b) => b.item.loanId === view.item.loanId)
    if (bundle) {
      return (
        <ReconcilePage
          item={bundle.item}
          full={bundle.full}
          today={todayISO()}
          onBack={() => setView({ kind: 'detail', item: view.item })}
          onApplied={reload}
        />
      )
    }
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
          <h1 className="text-hero">สินเชื่อของฉัน</h1>
          <p className="mt-1 text-meta text-[var(--color-ink-2)]">
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
          <h2 className="text-lead">ยังไม่มีสัญญา</h2>
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

      {/* ⚠️ สัญญาที่ปิดแล้วต้องแยกกอง ไม่ใช่ปนกับสัญญาที่ยังผ่อนอยู่
          คนที่รีไฟแนนซ์แล้วจะมีสัญญาเก่าค้างอยู่ตลอดไป ถ้าปนกันจะอ่านไม่ออกว่าหลังไหนยังมีหนี้ */}
      {items !== null && items.length > 0 && (
        <>
          {active.length > 0 ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((it) => (
                <LoanCard
                  key={it.loanId}
                  item={it}
                  onOpen={() => setView({ kind: 'detail', item: it })}
                  onDeleted={reload}
                />
              ))}
            </ul>
          ) : (
            <p className="text-meta text-[var(--color-ink-2)]">
              ไม่มีสัญญาที่กำลังผ่อนอยู่ — ทุกสัญญาถูกปิดไปแล้ว
            </p>
          )}

          {closed.length > 0 && (
            <section className="mt-8">
              <h2 className="text-row">ปิดแล้ว ({closed.length})</h2>
              <p className="mb-3 text-meta text-[var(--color-ink-2)]">
                ไม่ถูกนับในยอดหนี้รวม และงวดหลังวันปิดไม่เข้าสิทธิลดหย่อน —
                ประวัติยังอยู่ครบ กดเข้าไปเปิดกลับมาได้
              </p>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {closed.map((it) => (
                  <LoanCard
                    key={it.loanId}
                    item={it}
                    supersededBy={items.find((l) => l.supersedesLoanId === it.loanId) ?? null}
                    onOpen={() => setView({ kind: 'detail', item: it })}
                    onDeleted={reload}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
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
          className={`tap rounded-md px-3 py-1.5 text-meta ${
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
  supersededBy = null,
  onOpen,
  onDeleted,
}: {
  item: LoanListItem
  /** สัญญาใหม่ที่มารับช่วงต่อ — มีเฉพาะการ์ดของสัญญาที่ปิดไปแล้ว */
  supersededBy?: LoanListItem | null
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
    <li
      className={`rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-4 ${
        item.status === 'closed' ? 'opacity-75' : ''
      }`}
    >
      <button onClick={onOpen} className="tap block w-full text-left">
        <div className="flex items-start gap-3">
          <BankMark code={item.bankCode} name={item.bankLabel} />
          <div className="min-w-0">
            <h2 className="text-lead">{item.propertyName}</h2>
            <p className="text-meta text-[var(--color-ink-2)]">
              {item.bankLabel} · {ORIGIN_LABELS[item.origin]}
            </p>
            {item.status === 'closed' && (
              <p className="mt-0.5 text-micro text-[var(--color-ink-3)]">
                ปิดแล้ว
                {item.closedDate !== null && ` ${formatThaiDate(item.closedDate, 'short')}`}
                {item.closingReason !== null &&
                  ` · ${CLOSING_REASON_LABELS[item.closingReason]}`}
                {supersededBy !== null && ` → ${supersededBy.propertyName}`}
              </p>
            )}
          </div>
        </div>

        <dl className="mt-3 space-y-1 text-meta">
          <Row k="วงเงิน" v={baht(item.disbursedSatang)} />
          <Row k="ค่างวด" v={baht(item.installmentSatang)} />
          <Row k="ระยะเวลา" v={formatDuration(item.termMonths)} />
          <Row k="งวดแรก" v={formatThaiDate(item.firstDueDate)} />
        </dl>
      </button>

      <div className="mt-3 flex items-center justify-between border-t border-[var(--color-rule)] pt-3">
        <button
          onClick={onOpen}
          className="tap text-meta text-[var(--color-interest)] hover:underline"
        >
          ดูตารางผ่อน →
        </button>

        {confirming ? (
          <span className="flex items-center gap-2 text-meta">
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
            className="tap text-meta text-[var(--color-ink-3)] hover:text-[var(--color-warn)]"
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
