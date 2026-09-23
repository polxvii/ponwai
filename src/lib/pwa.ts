/**
 * ลงทะเบียน service worker และสถานะออนไลน์
 *
 * ⚠️ ลงทะเบียนเฉพาะตอน build จริง
 *    ตอน dev การมี SW คั่นกลางทำให้ hot reload ได้ไฟล์เก่าจาก cache
 *    แล้วหลงคิดว่าโค้ดที่แก้ไม่ทำงาน ซึ่งเสียเวลาไล่หาสาเหตุผิดจุด
 */

export function registerServiceWorker(onUpdate: () => void): void {
  if (!('serviceWorker' in navigator)) return
  if (import.meta.env.DEV) return

  // ⚠️ ห้ามรอ event 'load' เฉย ๆ
  //    ฟังก์ชันนี้ถูกเรียกจาก useEffect ซึ่งมักทำงาน "หลัง" load ยิงไปแล้ว
  //    listener ที่ผูกทีหลังจะไม่มีวันถูกเรียก = SW ไม่ลงทะเบียนเลยแบบเงียบ ๆ
  //    (เคยเป็นแบบนี้จริง เช็คใน build จริงแล้วพบว่า registrations ว่างเปล่า)
  if (document.readyState === 'complete') register(onUpdate)
  else window.addEventListener('load', () => register(onUpdate), { once: true })
}

function register(onUpdate: () => void): void {
  navigator.serviceWorker.register('/sw.js').then(
    (reg) => {
      // ตัวใหม่อาจโหลดเสร็จรออยู่ก่อนเราจะผูก listener ทัน ต้องเช็คสถานะปัจจุบันด้วย
      if (reg.waiting && navigator.serviceWorker.controller) onUpdate()

      reg.addEventListener('updatefound', () => {
        const next = reg.installing
        if (!next) return
        next.addEventListener('statechange', () => {
          // มีตัวใหม่พร้อมแล้วและมีตัวเก่าคุมหน้าอยู่ = เป็นการอัปเดต ไม่ใช่ติดตั้งครั้งแรก
          if (next.state === 'installed' && navigator.serviceWorker.controller) onUpdate()
        })
      })
    },
    // ล้มเหลวเงียบ ๆ คือสิ่งที่ทำให้บั๊กข้างบนหายาก ต้องให้เห็นใน console
    (err: unknown) => console.warn('[pwa] ลงทะเบียน service worker ไม่สำเร็จ', err),
  )
}

export function applyUpdate(): void {
  void navigator.serviceWorker.getRegistration().then((reg) => {
    // ไม่มีตัวรออยู่ = มันเข้าคุมไปแล้ว รีโหลดตรง ๆ พอ
    // ⚠️ ถ้าไม่มีทางนี้ ปุ่มจะกดแล้วเงียบในเคสที่ SW activate ไปก่อนผู้ใช้กด
    if (!reg?.waiting) return location.reload()

    // รอ SW ตัวใหม่เข้าคุมก่อนค่อยรีโหลด ไม่งั้นได้ของเก่าอีกรอบ
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
      once: true,
    })
    reg.waiting.postMessage('skip-waiting')
  })
}

// ---------- ปุ่มติดตั้ง ----------

type InstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPrompt | null = null
const waiting = new Set<() => void>()

/**
 * เบราว์เซอร์ยิง beforeinstallprompt ครั้งเดียวและเร็วมาก ถ้าไม่เก็บไว้จะเรียกใช้ทีหลังไม่ได้
 * จึงต้องดักตั้งแต่ "โหลดโมดูล" ไม่ใช่ตอน component mount — เหตุผลเดียวกับ load ข้างบน
 */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPrompt
    for (const fn of waiting) fn()
  })
  // ติดตั้งแล้ว prompt เดิมใช้ไม่ได้อีก ต้องทิ้ง ไม่งั้นปุ่มค้างอยู่
  window.addEventListener('appinstalled', () => {
    deferred = null
  })
}

/** คืนฟังก์ชันเลิกติดตาม */
export function captureInstallPrompt(onAvailable: () => void): () => void {
  waiting.add(onAvailable)
  // อีเวนต์อาจมาก่อน component mount แล้ว — บอกทันทีไม่ต้องรอรอบหน้า
  if (deferred) onAvailable()
  return () => waiting.delete(onAvailable)
}

export function canInstall(): boolean {
  return deferred !== null
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable'
  await deferred.prompt()
  const { outcome } = await deferred.userChoice
  // ใช้ได้ครั้งเดียว ต้องทิ้งหลังใช้ ไม่งั้นเรียกซ้ำแล้ว error
  deferred = null
  return outcome
}

/** iOS ยังไม่รองรับ beforeinstallprompt ต้องบอกวิธีทำเอง */
export function isIosSafari(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua)
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari บน iOS ใช้คีย์ของตัวเอง ไม่ใช่ display-mode
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}
