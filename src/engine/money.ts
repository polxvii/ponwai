/**
 * เงินในระบบนี้มี 2 ชั้น (spec ข้อ 5A.5 + 3.3)
 *
 *   Satang  — จำนวนเต็มสตางค์ ใช้เป็น public API และเก็บลง DB
 *   Fixed   — bigint ที่ scale ด้วย 10^12 ต่อ 1 สตางค์ ใช้ระหว่างคำนวณเท่านั้น
 *
 * เหตุผลที่ต้องมี Fixed: ดอกเบี้ยรายวันคือ balance × rate ÷ 365 ซึ่งหารไม่ลงตัว
 * spec บังคับว่า "สะสมระหว่างงวดเป็น exact ห้ามปัด แล้วปัดครั้งเดียวตอนจบงวด"
 * ถ้าสะสมด้วย number (float64) จะมี error สะสมที่มองไม่เห็น
 *
 * ห้ามใช้ number กับเงินที่ไหนเลยนอกจากตอน format ออกหน้าจอ
 */

/** จำนวนเต็มสตางค์ 100 = 1 บาท */
export type Satang = bigint & { readonly __brand: 'Satang' }

/** สตางค์ที่ scale แล้ว 1 สตางค์ = 10^12 หน่วย */
export type Fixed = bigint & { readonly __brand: 'Fixed' }

/** จำนวนหน่วย Fixed ต่อ 1 สตางค์ */
export const FIXED_SCALE = 1_000_000_000_000n

/** basis point 10000 bps = 100% */
export type Bps = number & { readonly __brand: 'Bps' }

export const BPS_DENOM = 10_000n

export type RoundingMode = 'floor_baht' | 'floor_satang' | 'round_satang' | 'none'

// ---------- ตัวสร้าง ----------

export function satang(n: bigint | number): Satang {
  if (typeof n === 'number') {
    if (!Number.isInteger(n)) throw new Error(`satang() ต้องเป็นจำนวนเต็ม ได้ ${n}`)
    return BigInt(n) as Satang
  }
  return n as Satang
}

/** แปลงบาท (อาจมีทศนิยม 2 ตำแหน่ง) เป็นสตางค์ — ใช้กับ input ของผู้ใช้และใน test เท่านั้น */
export function baht(n: number): Satang {
  const scaled = Math.round(n * 100)
  if (Math.abs(scaled - n * 100) > 1e-6) {
    throw new Error(`baht() รับทศนิยมได้ไม่เกิน 2 ตำแหน่ง ได้ ${n}`)
  }
  return BigInt(scaled) as Satang
}

export function bps(n: number): Bps {
  if (!Number.isInteger(n)) throw new Error(`bps() ต้องเป็นจำนวนเต็ม ได้ ${n}`)
  return n as Bps
}

export const ZERO_FIXED = 0n as Fixed
export const ZERO_SATANG = 0n as Satang

// ---------- แปลงไปมา ----------

export function toFixed(s: Satang): Fixed {
  return (s * FIXED_SCALE) as Fixed
}

export function addF(a: Fixed, b: Fixed): Fixed {
  return (a + b) as Fixed
}

export function subF(a: Fixed, b: Fixed): Fixed {
  return (a - b) as Fixed
}

export function minF(a: Fixed, b: Fixed): Fixed {
  return (a < b ? a : b) as Fixed
}

export function maxF(a: Fixed, b: Fixed): Fixed {
  return (a > b ? a : b) as Fixed
}

// ---------- ปัดเศษ ----------

/** หารแบบปัดลงจริง (floor) ไม่ใช่ตัดเศษเข้าหาศูนย์แบบ bigint `/` */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b
  return a % b !== 0n && (a < 0n) !== (b < 0n) ? q - 1n : q
}

/** หารแบบปัดครึ่งขึ้น (half-up) รองรับค่าติดลบอย่างสมมาตร */
function roundHalfUpDiv(a: bigint, b: bigint): bigint {
  if (a < 0n) return -roundHalfUpDiv(-a as bigint, b)
  return (2n * a + b) / (2n * b)
}

/**
 * ปัด Fixed ตามโหมดที่กำหนด แล้วคืนเป็น Fixed (ยังอยู่หน่วยเดิม)
 * โหมด 'none' คืนค่าเดิมทั้งหมด — จำเป็นสำหรับ test vector ทั้งชุด (spec ข้อ 9.1)
 */
export function roundFixed(v: Fixed, mode: RoundingMode): Fixed {
  switch (mode) {
    case 'none':
      return v
    case 'round_satang':
      return (roundHalfUpDiv(v, FIXED_SCALE) * FIXED_SCALE) as Fixed
    case 'floor_satang':
      return (floorDiv(v, FIXED_SCALE) * FIXED_SCALE) as Fixed
    case 'floor_baht': {
      const perBaht = FIXED_SCALE * 100n
      return (floorDiv(v, perBaht) * perBaht) as Fixed
    }
  }
}

/** ปัดเป็นจำนวนเต็มสตางค์เพื่อเก็บลง DB หรือแสดงผล — ใช้ half-up เสมอ */
export function fixedToSatang(v: Fixed): Satang {
  return roundHalfUpDiv(v, FIXED_SCALE) as Satang
}

// ---------- แสดงผล ----------

/**
 * Fixed -> สตริงบาท เช่น '7,643.84'
 * ใช้ใน test และ debug เท่านั้น ตัว format สำหรับ UI อยู่คนละชั้น (ต้องรองรับ พ.ศ. และ locale)
 */
export function formatFixedBaht(v: Fixed, decimals = 2): string {
  const satangScaled = roundHalfUpDiv(v * 10n ** BigInt(decimals), FIXED_SCALE * 100n)
  return formatScaled(satangScaled, decimals)
}

/** Satang -> สตริงบาท */
export function formatSatangBaht(v: Satang, decimals = 2): string {
  const scaled = roundHalfUpDiv(v * 10n ** BigInt(decimals), 100n)
  return formatScaled(scaled, decimals)
}

function formatScaled(scaled: bigint, decimals: number): string {
  const neg = scaled < 0n
  const abs = neg ? -scaled : scaled
  const d = 10n ** BigInt(decimals)
  const whole = abs / d
  const frac = abs % d
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const out = decimals > 0 ? `${wholeStr}.${frac.toString().padStart(decimals, '0')}` : wholeStr
  return neg ? `-${out}` : out
}
