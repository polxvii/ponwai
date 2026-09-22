/**
 * โลโก้ PonWai
 *
 * รูปบ้านตัดมาจากไฟล์ต้นฉบับ (public/logo-src.png) — ชื่อในไฟล์เล็กเกินจนอ่านไม่ออก
 * ที่ขนาดแถบหัว จึงพิมพ์ชื่อด้วยฟอนต์จริงแทน แล้วใช้สีเดียวกับต้นฉบับ
 * ต้นฉบับเป็นการ์ดพื้นขาว จึงวางบนแผ่นขาวมนให้ดูตั้งใจ ไม่ใช่สี่เหลี่ยมขาวลอย ๆ บนพื้นกระดาษ
 */

export function Mark({ size = 30 }: { size?: number }) {
  return (
    <img
      src="/mark.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className="rounded-md border border-[var(--color-rule)] bg-white"
    />
  )
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <Mark size={size} />
      <span className="font-[family-name:var(--font-display)] text-[var(--text-lead)] font-semibold tracking-tight">
        <span className="text-[var(--color-brand-blue)]">Pon</span>
        <span className="text-[var(--color-brand-green)]">Wai</span>
      </span>
    </span>
  )
}
