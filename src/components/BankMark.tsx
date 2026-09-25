/**
 * เครื่องหมายประจำธนาคาร — สี่เหลี่ยมมนสีประจำแบงก์พร้อมตัวย่อ
 *
 * ⛔ ไม่ใช่โลโก้จริง และต้องไม่ทำให้ดูเหมือนโลโก้จริง
 *    โลโก้ธนาคารเป็นเครื่องหมายการค้า เอามาใส่ในแอพที่เปิดซอร์สสาธารณะไม่ได้
 *    สิ่งที่ผู้ใช้ต้องการจริงคือกวาดตาหาแบงก์ในลิสต์ให้เร็วขึ้น ซึ่งสีทำงานแทนได้
 *    ถ้าวันหลังมีไฟล์โลโก้ที่ได้รับอนุญาต ให้สลับมาโหลดจาก /banks/<code>.svg ที่นี่จุดเดียว
 *
 * ⚠️ aria-hidden เสมอ — ชื่อธนาคารเป็นข้อความอยู่ข้าง ๆ ทุกที่ที่เรียกใช้
 *    ถ้าอ่านออกเสียงด้วยจะกลายเป็นพูดชื่อแบงก์ซ้ำสองรอบ
 */

type Mark = { bg: string; fg?: string; text: string }

/**
 * สีประจำแบรนด์ แต่เลือกให้ต่างกันพอแยกออกบนจอเล็กด้วย
 * ⚠️ พื้นสีอ่อนอย่าง BAY ต้องกำหนด fg เป็นสีเข้ม ไม่งั้นตัวอักษรขาวอ่านไม่ออก
 */
const MARKS: Readonly<Record<string, Mark>> = {
  BBL:   { bg: '#1A4A9C', text: 'BBL' },
  SCB:   { bg: '#4E2A84', text: 'SCB' },
  KBANK: { bg: '#0F8A2E', text: 'K' },
  BAY:   { bg: '#FDB913', fg: '#3A2B00', text: 'BAY' },
  KTB:   { bg: '#00A0E3', text: 'KTB' },
  TTB:   { bg: '#0B4EA2', text: 'ttb' },
  UOB:   { bg: '#0B3D91', text: 'UOB' },
  GHB:   { bg: '#F26F21', text: 'ธอส' },
  GSB:   { bg: '#E6007E', text: 'GSB' },
  CIMBT: { bg: '#A6192E', text: 'CIMB' },
  LHB:   { bg: '#E35205', text: 'LH' },
  BAAC:  { bg: '#00833E', text: 'ธกส' },
}

export function BankMark({
  code,
  name,
  size = 28,
}: {
  code?: string | null
  /** ใช้เมื่อไม่รู้จักรหัส เช่นผู้ให้กู้ที่ผู้ใช้พิมพ์ชื่อเอง */
  name?: string
  size?: number
}) {
  const m = code ? MARKS[code] : undefined
  const text = m?.text ?? name?.trim().slice(0, 1) ?? '?'
  // ตัวย่อยาวต้องเล็กลง ไม่งั้นล้นกรอบบนจอ 380px
  const scale = text.length >= 4 ? 0.28 : text.length >= 2 ? 0.36 : 0.5

  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-md font-medium leading-none tracking-tight"
      style={{
        width: size,
        height: size,
        background: m?.bg ?? 'var(--color-ink-3)',
        color: m?.fg ?? '#fff',
        fontSize: Math.round(size * scale),
      }}
    >
      {text}
    </span>
  )
}
