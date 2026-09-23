/**
 * แถบแจ้งเตือนระดับแอพ — ออฟไลน์ / มีเวอร์ชันใหม่ / ชวนติดตั้ง
 *
 * วางไว้ล่างจอบนมือถือ เพราะนิ้วอยู่ล่าง และไม่ไปเบียดแถบแท็บด้านบน
 * ⚠️ ต้องเผื่อ safe-area ของ iPhone ไม่งั้นทับแถบ home indicator จนกดไม่โดน
 */

import { useEffect, useState } from 'react'
import {
  applyUpdate, canInstall, captureInstallPrompt, isIosSafari, isStandalone, promptInstall,
  registerServiceWorker,
} from '@/lib/pwa'

const DISMISS_KEY = 'ponwai:v1:install-dismissed'

export function AppBanners() {
  const [offline, setOffline] = useState(!navigator.onLine)
  const [updateReady, setUpdateReady] = useState(false)
  const [installable, setInstallable] = useState(false)
  const [showIosHint, setShowIosHint] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    registerServiceWorker(() => setUpdateReady(true))
    const unsubscribe = captureInstallPrompt(() => setInstallable(true))

    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      unsubscribe()
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* โหมดส่วนตัวเขียนไม่ได้ ไม่เป็นไร */
    }
  }

  // ติดตั้งไปแล้วไม่ต้องชวนอีก
  const showInstall =
    !dismissed && !isStandalone() && (installable || canInstall() || isIosSafari())

  if (!offline && !updateReady && !showInstall) return null

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex flex-col gap-2 p-3"
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
    >
      {offline && (
        <Banner tone="warn">
          <span>
            ออฟไลน์อยู่ — เปรียบเทียบกับรีไฟแนนซ์ใช้ได้ปกติ
            แต่ข้อมูลสัญญาที่บันทึกไว้จะโหลดไม่ได้จนกว่าจะต่อเน็ต
          </span>
        </Banner>
      )}

      {updateReady && (
        <Banner tone="info">
          <span>มีเวอร์ชันใหม่แล้ว</span>
          <button onClick={applyUpdate} className="tap shrink-0 font-medium underline">
            โหลดใหม่
          </button>
        </Banner>
      )}

      {showInstall && !offline && (
        <Banner tone="info">
          {showIosHint ? (
            <span>
              กดปุ่มแชร์ด้านล่างของ Safari แล้วเลือก &quot;เพิ่มไปยังหน้าจอโฮม&quot;
            </span>
          ) : (
            <span>ติดตั้งลงหน้าจอโฮม เปิดได้เร็วขึ้นและใช้ได้ตอนออฟไลน์</span>
          )}
          {!showIosHint && (
            <button
              onClick={() => {
                if (isIosSafari() && !canInstall()) return setShowIosHint(true)
                void promptInstall().then((r) => {
                  if (r !== 'dismissed') dismiss()
                  setInstallable(false)
                })
              }}
              className="tap shrink-0 font-medium underline"
            >
              ติดตั้ง
            </button>
          )}
          <button
            onClick={dismiss}
            aria-label="ปิดคำชวนติดตั้ง"
            className="tap shrink-0 opacity-70"
          >
            ✕
          </button>
        </Banner>
      )}
    </div>
  )
}

function Banner({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  const style =
    tone === 'warn'
      ? 'bg-[var(--color-warn)] text-[var(--color-panel-ink)]'
      : 'bg-[var(--color-panel)] text-[var(--color-panel-ink)]'
  return (
    <div
      role="status"
      className={`mx-auto flex w-full max-w-[560px] items-center gap-3 rounded-lg px-4 py-3 text-[var(--text-meta)] shadow-lg ${style}`}
    >
      {children}
    </div>
  )
}
