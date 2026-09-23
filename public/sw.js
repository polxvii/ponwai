/**
 * Service worker ของ PonWai
 *
 * เป้าหมาย: เปิดแอพได้ตอนไม่มีเน็ต และเครื่องคิดเลข (เปรียบเทียบ/รีไฟแนนซ์) ใช้ได้เต็ม
 * เพราะทั้งสองโหมดคำนวณในเครื่องล้วน ไม่ต้องพึ่งเซิร์ฟเวอร์
 *
 * ⛔ ห้าม cache อะไรก็ตามที่ไปหา Supabase
 *    1. เป็นข้อมูลการเงินส่วนตัว ถ้าลงไปอยู่ใน Cache Storage จะล้างยากตอนออกจากระบบ
 *       และติดอยู่ในเครื่องแม้เปลี่ยนผู้ใช้
 *    2. ยอดหนี้ที่เก่าเงียบ ๆ อันตรายกว่าไม่มีข้อมูล เพราะผู้ใช้เอาไปตัดสินใจจริง
 *    ตอนออฟไลน์จึงยอมให้หน้า "ติดตาม" ฟ้องว่าต่อเน็ตไม่ได้ ดีกว่าโชว์เลขเก่า
 *
 * ⚠️ ขึ้นเลข VERSION ทุกครั้งที่แก้ไฟล์นี้ ไม่งั้น cache เก่าไม่ถูกล้าง
 */

const VERSION = 'v1'
const SHELL = `ponwai-shell-${VERSION}`
const ASSETS = `ponwai-assets-${VERSION}`

/** ไฟล์คงที่ที่ต้องมีเสมอ ส่วนชื่อ bundle มี hash จึงต้องอ่านจาก index.html ตอนติดตั้ง */
const SHELL_URLS = ['/manifest.webmanifest', '/icon-192.png', '/favicon-32.png']

/**
 * ⚠️ ต้อง precache ตัว bundle ด้วย ไม่ใช่หวังว่าจะติดมาเองตอนโหลดครั้งแรก
 *    SW ลงทะเบียนหลัง load ยิงแล้ว จึงยังไม่ได้คุมหน้าในรอบแรก
 *    ทุก request ของ /assets/* รอบนั้นเลยไม่ผ่าน fetch handler และไม่เข้า cache
 *    ผลคือเปิดออฟไลน์ครั้งแรกได้ shell แต่สคริปต์โหลดไม่ได้ = หน้าขาว
 *    (บิลด์นี้ไม่มี code splitting จึงไม่มี request หลัง load มา backfill ให้ด้วย)
 */
async function precache() {
  const shell = await caches.open(SHELL)
  // ไฟล์ใดไฟล์หนึ่งพังต้องไม่ทำให้ติดตั้งล้มทั้งชุด
  await Promise.allSettled(SHELL_URLS.map((u) => shell.add(u)))

  const res = await fetch('/', { cache: 'reload' })
  if (!res.ok) return
  const html = await res.text()
  await shell.put('/', new Response(html, { headers: res.headers }))

  const urls = [...new Set([...html.matchAll(/["'](\/assets\/[^"']+)["']/g)].map((m) => m[1]))]
  const assets = await caches.open(ASSETS)
  await Promise.allSettled(urls.map((u) => assets.add(u)))
}

self.addEventListener('install', (event) => {
  // ⛔ ห้ามเรียก skipWaiting() ตรงนี้
  //    ตัวใหม่จะข้ามสถานะ waiting ไปเลย แล้ว reg.waiting เป็น null ตลอด
  //    ปุ่ม "โหลดใหม่" ที่ส่ง postMessage ไปหา waiting จึงกลายเป็นปุ่มตาย
  //    ปล่อยให้รออยู่ แล้วค่อย skip ตอนผู้ใช้กดเองผ่าน message handler ข้างล่าง
  event.waitUntil(precache())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('ponwai-') && k !== SHELL && k !== ASSETS)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  const sameOrigin = url.origin === self.location.origin

  // ⛔ Supabase และทุกอย่างข้ามโดเมนที่ไม่ใช่ฟอนต์ — ปล่อยผ่าน ไม่แตะ cache
  const isFont =
    url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'
  if (!sameOrigin && !isFont) return

  // หน้าเว็บ: เอาของใหม่ก่อน ถ้าไม่มีเน็ตค่อยใช้ของที่เก็บไว้
  // ทำแบบนี้เพื่อให้ผู้ใช้ได้เวอร์ชันใหม่ทันทีที่ออนไลน์ ไม่ต้องรอ cache หมดอายุ
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // ⛔ ห้ามเก็บ response ที่ไม่ใช่ 200 เป็น app shell
          //    หน้า 5xx ตอน deploy หรือหน้า challenge จะถูกเสิร์ฟแทนแอพตอนออฟไลน์
          //    และ offlinePage() จะไม่มีวันได้ทำงาน เพราะ cache hit เป็น truthy
          //    ส่วน redirected ใส่ cache ไม่ได้ ตอนดึงมาใช้กับ navigate จะ error
          if (res.ok && !res.redirected) {
            const copy = res.clone()
            void caches
              .open(SHELL)
              .then((c) => c.put('/', copy))
              .catch(() => {
                /* Vary: * หรือ 206 ใส่ไม่ได้ ปล่อยผ่าน ดีกว่า unhandled rejection */
              })
          }
          return res
        })
        .catch(() => caches.match('/').then((r) => r ?? offlinePage())),
    )
    return
  }

  // ไฟล์ static: ชื่อมี hash อยู่แล้ว เนื้อหาไม่มีวันเปลี่ยน เอาจาก cache ได้เลย
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req)
          .then((res) => {
            // ฟอนต์จาก Google เป็น opaque ไม่ได้ (index.html ใส่ crossorigin แล้ว)
            // ถ้าเจอ opaque แปลว่าลืม crossorigin — เก็บไว้ไม่ได้เพราะเช็คความถูกต้องไม่ได้
            if (res.ok && (sameOrigin || isFont)) {
              const copy = res.clone()
              void caches.open(ASSETS).then((c) => c.put(req, copy)).catch(() => {})
            }
            return res
          })
          // ออฟไลน์แล้วไม่มีใน cache — ตอบ 504 ไปตรง ๆ
          // ปล่อยให้ respondWith reject จะกลายเป็น net::ERR_FAILED ซึ่งดีบั๊กยากกว่ามาก
          .catch(() => new Response('', { status: 504, statusText: 'offline' })),
    ),
  )
})

function offlinePage() {
  return new Response(
    `<!doctype html><html lang="th"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>PonWai — ออฟไลน์</title>
     <style>
       body{font-family:system-ui,sans-serif;background:#f5f5f1;color:#161a18;
            display:grid;place-items:center;height:100vh;margin:0;padding:24px;text-align:center}
       p{color:#5c625e;line-height:1.7}
     </style></head><body><div>
     <h1>ยังต่อเน็ตไม่ได้</h1>
     <p>เปิดแอพครั้งแรกต้องมีเน็ตก่อน<br>หลังจากนั้นจะใช้ได้แม้ออฟไลน์</p>
     </div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
  )
}
