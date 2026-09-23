/**
 * แถบแจ้งเตือนระดับแอพ — ออฟไลน์ / มีเวอร์ชันใหม่ / ชวนติดตั้ง
 *
 * วางไว้ล่างจอบนมือถือ เพราะนิ้วอยู่ล่าง และไม่ไปเบียดแถบแท็บด้านบน
 * ⚠️ ต้องเผื่อ safe-area ของ iPhone ไม่งั้นทับแถบ home indicator จนกดไม่โดน
 */

import { useEffect, useState } from 'react'
import {
  applyUpdate, canInstall, captureInstallPrompt, isIosSafari, isStandalone, promptInstall,
  registerServiceWorker, wasInstalled,
} from '@/lib/pwa'
import { PREFIX } from '@/lib/persist'

// ใช้ PREFIX ร่วมกับที่อื่น เพื่อให้ถูกล้างพร้อมกันตอนขึ้นเวอร์ชัน storage
const DISMISS_KEY = `${PREFIX}install-dismissed`

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
    // อ่านสถานะจริงทุกครั้งที่เปลี่ยน ไม่ใช่ตั้งเป็น true อย่างเดียว
    // ไม่งั้นติดตั้งจากเมนูเบราว์เซอร์แล้วแบนเนอร์ค้าง
    const unsubscribe = captureInstallPrompt(() => setInstallable(canInstall()))

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

  // ติดตั้งไปแล้วไม่ต้องชวนอีก — wasInstalled ครอบเคสที่ติดตั้งจากเมนูเบราว์เซอร์
  // ซึ่งแท็บเดิมยังไม่ใช่ standalone จึงเช็คจาก isStandalone() อย่างเดียวไม่พอ
  const showInstall =
    !dismissed && !isStandalone() && !wasInstalled() && (installable || isIosSafari())

  if (!offline && !updateReady && !showInstall) return null

  return (
    <div
      /* pointer-events-none จำเป็น: กล่องกว้างเต็มจอแต่แบนเนอร์กว้างแค่ 560px
         ที่ว่างสองข้างจะกินคลิกของหน้าเว็บทั้งแถบล่างจอถ้าไม่ปิด */
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col gap-2 p-3"
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
                // ⛔ เขียนธง "ไม่ต้องชวนอีก" เฉพาะตอนติดตั้งสำเร็จจริงเท่านั้น
                //    'unavailable' แปลว่าไม่มี prompt ให้แสดงด้วยซ้ำ ผู้ใช้ไม่เคยเห็นอะไรเลย
                //    ถ้านับเป็นสำเร็จ จะปิดคำชวนถาวรทั้งที่ยังไม่ได้ติดตั้ง
                void promptInstall()
                  .then((r) => {
                    if (r === 'accepted') dismiss()
                    setInstallable(canInstall())
                  })
                  .catch(() => setInstallable(canInstall()))
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
      className={`pointer-events-auto mx-auto flex w-full max-w-[560px] items-center gap-3 rounded-lg px-4 py-3 text-meta shadow-lg ${style}`}
    >
      {children}
    </div>
  )
}
