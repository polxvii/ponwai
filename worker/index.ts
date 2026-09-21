/**
 * Cloudflare Worker — ทำ 2 หน้าที่ในตัวเดียว
 *
 *   fetch()     serve SPA จาก static assets
 *   scheduled() ping Supabase กัน project pause (spec ข้อ 5A.5)
 *
 * เหตุผลที่ keep-alive ต้องอยู่ฝั่ง Cloudflare ไม่ใช่ pg_cron:
 * ถ้า Supabase project pause ไปแล้ว cron ที่อยู่ในฐานข้อมูลนั้นก็ไม่รัน
 * ต้องมีอะไรบางอย่างจากข้างนอกมาปลุก
 */

interface Env {
  ASSETS: Fetcher
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request)
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(pingSupabase(env))
  },
} satisfies ExportedHandler<Env>

async function pingSupabase(env: Env): Promise<void> {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = env
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('keep-alive ข้าม: ยังไม่ได้ตั้ง SUPABASE_URL หรือ SUPABASE_ANON_KEY')
    return
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    })
    console.log(`keep-alive: ${res.status}`)
  } catch (err) {
    // ไม่ throw เพราะ cron ที่ fail จะ retry แล้วรกใน log เปล่า ๆ
    // ถ้า ping พลาดรอบเดียวไม่เป็นไร รอบหน้าอีก 3 วันยังอยู่ใน window 7 วัน
    console.error('keep-alive ล้มเหลว', err)
  }
}
