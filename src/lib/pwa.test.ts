/**
 * TV-36 — service worker ต้องลงทะเบียนจริง
 *
 * ที่มา: เคยเขียนเป็น window.addEventListener('load', …) เฉย ๆ
 * แต่ฟังก์ชันนี้ถูกเรียกจาก useEffect ซึ่งทำงานหลัง load ยิงไปแล้ว
 * listener จึงไม่ถูกเรียกเลย → SW ไม่ลงทะเบียน และไม่มี error ให้เห็นด้วย
 * ตรวจพบตอนเปิด build จริงแล้วพบว่า getRegistrations() ว่างเปล่า
 *
 * ไฟล์นี้รันบน node จึงต้องปั้น window/document/navigator เองก่อน import โมดูล
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

type Listener = () => void

function fakeDom(readyState: 'loading' | 'complete') {
  const registered: string[] = []
  const listeners = new Map<string, Listener[]>()

  // navigator ของ node เป็น getter อย่างเดียว กำหนดค่าตรง ๆ ไม่ได้ ต้อง defineProperty
  const put = (key: string, value: unknown) =>
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })

  put('window', {
    addEventListener: (type: string, fn: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn])
    },
    removeEventListener: () => {},
  })
  put('document', { readyState })
  put('navigator', {
    serviceWorker: {
      controller: null,
      addEventListener: () => {},
      register: (url: string) => {
        registered.push(url)
        return Promise.resolve({ addEventListener: () => {}, waiting: null, installing: null })
      },
    },
  })

  return {
    registered,
    /** จำลองว่า load เพิ่งยิงตอนนี้ */
    fireLoad: () => (listeners.get('load') ?? []).forEach((fn) => fn()),
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const key of ['window', 'document', 'navigator']) {
    Reflect.deleteProperty(globalThis, key)
  }
})

async function loadPwa() {
  vi.resetModules()
  return import('@/lib/pwa')
}

describe('registerServiceWorker', () => {
  it('ลงทะเบียนทันทีถ้าหน้าโหลดเสร็จไปแล้ว (เคสที่เคยพลาด)', async () => {
    vi.stubEnv('DEV', false)
    const dom = fakeDom('complete')
    const { registerServiceWorker } = await loadPwa()

    registerServiceWorker(() => {})

    expect(dom.registered).toEqual(['/sw.js'])
  })

  it('ถ้าหน้ายังโหลดไม่เสร็จ ให้รอ load ก่อนแล้วค่อยลงทะเบียน', async () => {
    vi.stubEnv('DEV', false)
    const dom = fakeDom('loading')
    const { registerServiceWorker } = await loadPwa()

    registerServiceWorker(() => {})
    expect(dom.registered).toEqual([])

    dom.fireLoad()
    expect(dom.registered).toEqual(['/sw.js'])
  })

  it('ไม่ลงทะเบียนตอน dev เพราะ cache ของ SW จะบังโค้ดใหม่จน hot reload หลอก', async () => {
    vi.stubEnv('DEV', true)
    const dom = fakeDom('complete')
    const { registerServiceWorker } = await loadPwa()

    registerServiceWorker(() => {})

    expect(dom.registered).toEqual([])
  })
})
