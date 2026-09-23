/**
 * State ของหน้า Compare — แปลงจากสิ่งที่ผู้ใช้กรอก เป็น LoanOffer ที่ engine รับได้
 *
 * ผู้ใช้กรอกเรตเป็น "ปีที่ 1 / 2 / 3 แล้วลอยตัว" ไม่ใช่ from_month/to_month (ข้อ 5A.3 วิธีที่ 2)
 * และกรอกเงินเป็นบาท ไม่ใช่สตางค์ — แปลงที่ชั้นนี้ที่เดียว
 */

import { baht, bps, type Satang } from '@engine/money.js'
import { isoDate, type ISODate } from '@engine/date.js'
import { rateStepsFromYearlyRates } from '@engine/import.js'
import { defaultImportConvention } from '@engine/import.js'
import type { LoanOffer } from '@engine/compare.js'
import type { OfferFee } from '@engine/fees.js'

export type BankPreset = {
  code: string
  nameTh: string
  isSfi: boolean
  mrrBps?: number
  mrrAsOf?: ISODate
}

/** seed เดียวกับ supabase/seed.sql — ⛔ ห้ามใส่อัตราโปรโมชั่นรายผลิตภัณฑ์ (ข้อ 2.5) */
export const BANK_PRESETS: readonly BankPreset[] = [
  { code: 'BBL',   nameTh: 'กรุงเทพ',          isSfi: false, mrrBps: 6500, mrrAsOf: isoDate('2026-08-07') },
  { code: 'SCB',   nameTh: 'ไทยพาณิชย์',        isSfi: false, mrrBps: 6575, mrrAsOf: isoDate('2026-08-07') },
  { code: 'KBANK', nameTh: 'กสิกรไทย',         isSfi: false, mrrBps: 6580, mrrAsOf: isoDate('2026-08-07') },
  { code: 'BAY',   nameTh: 'กรุงศรีอยุธยา',      isSfi: false, mrrBps: 6670, mrrAsOf: isoDate('2026-08-07') },
  { code: 'KTB',   nameTh: 'กรุงไทย',           isSfi: false, mrrBps: 6845, mrrAsOf: isoDate('2026-08-07') },
  { code: 'TTB',   nameTh: 'ทหารไทยธนชาต',      isSfi: false, mrrBps: 7105, mrrAsOf: isoDate('2026-08-07') },
  { code: 'UOB',   nameTh: 'ยูโอบี',            isSfi: false, mrrBps: 8075, mrrAsOf: isoDate('2026-08-07') },
  { code: 'GHB',   nameTh: 'ธอส.',             isSfi: true },
  { code: 'GSB',   nameTh: 'ออมสิน',           isSfi: true },
  { code: 'CIMBT', nameTh: 'ซีไอเอ็มบี ไทย',    isSfi: false },
  { code: 'LHB',   nameTh: 'แลนด์ แอนด์ เฮ้าส์', isSfi: false },
  { code: 'BAAC',  nameTh: 'ธ.ก.ส.',           isSfi: true },
] as const

/** ธนาคารที่ไม่อยู่ในรายการ — ผู้ใช้พิมพ์ชื่อเอง (ผู้ให้กู้ท้องถิ่น สหกรณ์ หรือแบงก์ที่เพิ่งเข้าตลาด) */
export const OTHER_BANK = 'OTHER'

/** ยังไม่ได้เลือก — ต้องมี ไม่งั้นช่อง select จะโชว์ธนาคารแรกเหมือนผู้ใช้เลือกไว้เอง */
export const NO_BANK = ''

/**
 * ตัวเลือกในช่องเลือกธนาคาร — ธนาคารจริงล้วน ปิดท้ายด้วย "อื่น ๆ"
 *
 * ⛔ ห้ามใส่ตัวเลือกว่างไว้ในนี้
 *    ค่าคงที่ตัวนี้ใช้ร่วมกับหน้าสร้างสัญญาในโหมดติดตามด้วย
 *    ซึ่ง bank_code เป็น FK ไปตาราง banks — ค่าว่างจะทำให้ insert พังที่ระดับ DB
 *    หน้าไหนอยากให้เว้นว่างได้ ส่ง placeholder ให้ SelectField เอง
 */
export const BANK_OPTIONS: readonly { value: string; label: string }[] = [
  ...BANK_PRESETS.map((b) => ({ value: b.code, label: b.isSfi ? `${b.nameTh} (รัฐ)` : b.nameTh })),
  { value: OTHER_BANK, label: 'อื่น ๆ — พิมพ์ชื่อเอง' },
]

/** สิ่งที่ผู้ใช้กรอกจริง ทุกจำนวนเงินเป็นบาท */
export type OfferDraft = {
  id: string
  bankCode: string
  /** ใช้เมื่อ bankCode = OTHER_BANK เท่านั้น */
  customName: string
  /** เรตรายปีของช่วงโปร เป็น % เช่น 2.5 */
  promoRates: (number | '')[]
  /** เรตหลังพ้นโปร */
  floatingRate: number | ''
  installment: number | ''
  /** ค่าธรรมเนียมจ่ายสด */
  mortgageFeePct: number | ''
  mortgageFeeWaivedCap: number | ''
  stampDuty: boolean
  appraisalFee: number | ''
  otherFee: number | ''
  /** MRTA */
  mrtaPremium: number | ''
  mrtaFinanced: boolean
  mrtaRateDiscount: number | ''
  /** ประกันอัคคีภัย */
  firePremium: number | ''
  fireTermYears: number
  fireWaivedYears: number
  lockinMonths: number
}

export function emptyDraft(id: string, bankCode: string = NO_BANK): OfferDraft {
  return {
    id,
    bankCode,
    customName: '',
    promoRates: ['', '', ''],
    floatingRate: '',
    installment: '',
    mortgageFeePct: 1,
    mortgageFeeWaivedCap: '',
    stampDuty: true,
    appraisalFee: '',
    otherFee: '',
    mrtaPremium: '',
    mrtaFinanced: true,
    mrtaRateDiscount: '',
    firePremium: '',
    fireTermYears: 3,
    fireWaivedYears: 0,
    lockinMonths: 36,
  }
}

/** เทียบพร้อมกันได้สูงสุดกี่ธนาคาร — เกินกว่านี้กราฟอ่านไม่ออกและสีเส้นเริ่มซ้ำ */
export const MAX_OFFERS = 5
/** ต่ำกว่านี้ไม่เรียกว่าเปรียบเทียบ */
export const MIN_OFFERS = 2

/**
 * เริ่มต้นเป็นการ์ดเปล่า MIN_OFFERS ใบ
 *
 * ⛔ ห้ามใส่ตัวเลขตัวอย่างไว้ ผู้ใช้แยกไม่ออกว่าอันไหนของตัวเองอันไหนของแอพ
 *    แล้วเผลอตัดสินใจจากเลขที่ไม่ใช่ใบเสนอจริง
 */
export const EMPTY_DRAFTS: OfferDraft[] = [emptyDraft('a'), emptyDraft('b')]

/** ชื่อที่จะโชว์ในตารางและกราฟ */
export function offerLabel(d: OfferDraft): string {
  if (d.bankCode === OTHER_BANK) return d.customName.trim() || 'ธนาคารอื่น'
  if (d.bankCode === NO_BANK) return 'ยังไม่เลือกธนาคาร'
  return bankName(d.bankCode)
}

/** ข้อมูลที่ใช้ร่วมกันทุกข้อเสนอ — ต้องเท่ากันหมด ไม่งั้นเทียบคนละฐาน */
export type CommonTerms = {
  loanAmount: number | ''
  termYears: number | ''
  startDate: ISODate
  dueDayOfMonth: number
}

/**
 * startDate/dueDayOfMonth ไม่มีช่องให้กรอกในหน้านี้ เพราะการเทียบเป็นการเทียบ "เชิงเปรียบเทียบ"
 * ทุกข้อเสนอใช้วันเดียวกันหมด วันที่แน่นอนจึงไม่เปลี่ยนลำดับ — ค่าคงที่ตรงนี้ไม่ใช่ default ที่ผู้ใช้ต้องแก้
 */
export const EMPTY_COMMON: CommonTerms = {
  loanAmount: '',
  termYears: '',
  startDate: isoDate('2026-10-01'),
  dueDayOfMonth: 1,
}

// ---------- ความครบถ้วนของข้อมูล (ข้อ 5A.3 วิธีที่ 4) ----------

export type Completeness = {
  /** คำนวณได้แล้วหรือยัง */
  ready: boolean
  /** ช่องที่ขาดแล้วคำนวณไม่ได้เลย — ชื่อต้องตรงกับ label ในฟอร์ม */
  blocking: string[]
  /** รายการที่ยังขาด พร้อมผลกระทบเป็นบาท — ขาดได้ ผลยังขึ้น แต่คลาดเคลื่อน */
  missing: { label: string; impact: string }[]
}

/**
 * ให้ผลลัพธ์ตั้งแต่ยังกรอกไม่ครบ แล้วบอกว่าที่ขาดอาจคลาดเคลื่อนเท่าไหร่
 * ดีกว่าบังคับให้กรอก 40-50 ช่องก่อนถึงจะเห็นอะไรเลย
 */
export function assessCompleteness(
  d: OfferDraft,
  common: CommonTerms,
  /** true = ล็อกค่างวดไว้แล้ว ค่างวดของข้อเสนอนี้จึงไม่จำเป็นต่อการคำนวณ */
  hasLockedPayment = false,
): Completeness {
  const missing: Completeness['missing'] = []
  const loan = typeof common.loanAmount === 'number' ? common.loanAmount : 0

  if (d.mortgageFeePct === '' && d.mortgageFeeWaivedCap === '') {
    missing.push({
      label: 'ค่าจดจำนอง',
      impact: `อาจคลาดเคลื่อนถึง ${(loan * 0.01).toLocaleString('en-US')} บาท`,
    })
  }
  if (d.appraisalFee === '') {
    missing.push({ label: 'ค่าประเมินหลักประกัน', impact: 'ปกติ 3,000–10,000 บาท' })
  }
  if (d.firePremium === '') {
    missing.push({ label: 'เบี้ยประกันอัคคีภัย', impact: 'ราว 2,000–4,000 บาทต่อ 3 ปี ตลอด 30 ปี' })
  }
  if (d.mrtaPremium === '') {
    missing.push({ label: 'เบี้ย MRTA', impact: 'ถ้ารวมในวงเงิน ต้นทุนจริงอาจสูงกว่าเบี้ยหลายเท่า' })
  }

  // ⛔ ขาดข้อไหนก็คำนวณไม่ได้ ต้องบอกชื่อช่องตรง ๆ ไม่ใช่ปล่อยหน้าว่าง
  //    ไม่งั้นผู้ใช้กรอกไปสามช่องแล้วนั่งรอผลที่ไม่มีวันขึ้น
  const blocking: string[] = []
  if (!(typeof common.loanAmount === 'number' && common.loanAmount > 0)) blocking.push('วงเงินกู้')
  if (!(typeof common.termYears === 'number' && common.termYears > 0)) blocking.push('ระยะเวลา')
  // ไม่เลือกธนาคาร = ทุกแถวชื่อเหมือนกันหมด อ่านไม่ออกว่าใครชนะ
  // และคำเตือนอันดับพลิกจะกลายเป็น "ยังไม่เลือกธนาคาร แพ้ ยังไม่เลือกธนาคาร"
  if (d.bankCode === NO_BANK) blocking.push('ธนาคาร')
  if (hasLockedPayment) {
    // ค่างวดที่ล็อกไว้ถูกตรวจที่ระดับหน้า ไม่ใช่รายข้อเสนอ
  } else if (!(typeof d.installment === 'number' && d.installment > 0)) {
    blocking.push('ค่างวดที่จะจ่าย')
  }
  const gap = promoGap(d.promoRates)
  if (gap !== null) blocking.push(`เรตปีที่ ${gap} (เว้นว่างตรงกลางไม่ได้)`)
  else if (!d.promoRates.some((r) => typeof r === 'number')) blocking.push('เรตปีที่ 1–3')
  if (typeof d.floatingRate !== 'number') blocking.push('หลังพ้นโปร')

  return { ready: blocking.length === 0, blocking, missing }
}

// ---------- แปลงเป็น LoanOffer ----------

const num = (v: number | '' | undefined): number => (typeof v === 'number' ? v : 0)
/** baht() รับทศนิยมไม่เกิน 2 ตำแหน่ง — ช่องกรอกยอมให้พิมพ์ละเอียดกว่านั้นได้ จึงต้องปัดก่อน */
const sat = (v: number | '' | undefined): Satang => baht(Math.round(num(v) * 100) / 100)

export function toLoanOffer(d: OfferDraft, common: CommonTerms): LoanOffer {
  const loanAmount = num(common.loanAmount)

  const promo = d.promoRates
    .filter((r): r is number => typeof r === 'number')
    .map((r) => bps(Math.round(r * 100)))

  const fees: OfferFee[] = []

  if (num(d.mortgageFeePct) > 0) {
    fees.push({
      feeType: 'ค่าจดจำนอง',
      basis: 'pct_of_loan',
      pctBps: bps(Math.round(num(d.mortgageFeePct) * 100)),
      isWaived: d.mortgageFeeWaivedCap !== '',
      ...(d.mortgageFeeWaivedCap !== ''
        ? { waiverCapSatang: sat(d.mortgageFeeWaivedCap) }
        : {}),
      isFinanced: false,
    })
  }

  if (d.stampDuty) {
    fees.push({
      feeType: 'อากรแสตมป์',
      basis: 'pct_of_loan',
      pctBps: bps(5),               // 0.05%
      capSatang: baht(10_000),      // เพดานตามกฎหมาย
      isWaived: false,
      isFinanced: false,
    })
  }

  if (num(d.appraisalFee) > 0) {
    fees.push({
      feeType: 'ค่าประเมินหลักประกัน',
      basis: 'flat',
      amountSatang: sat(d.appraisalFee),
      isWaived: false,
      isFinanced: false,
    })
  }

  if (num(d.otherFee) > 0) {
    fees.push({
      feeType: 'ค่าธรรมเนียมอื่น',
      basis: 'flat',
      amountSatang: sat(d.otherFee),
      isWaived: false,
      isFinanced: false,
    })
  }

  const startDate = common.startDate

  return {
    // ⛔ ห้ามใช้ bankCode เป็นคีย์ — เทียบ 2 ผลิตภัณฑ์ของแบงก์เดียวกัน หรือเลือก "อื่น ๆ"
    //    สองอันจะชนกันทันที เพราะ engine ใช้ bankCode เป็น identity ของข้อเสนอ
    bankCode: d.id,
    productName: offerLabel(d),
    loanAmountSatang: sat(common.loanAmount),
    termMonths: num(common.termYears) * 12,
    startDate,
    dueDayOfMonth: common.dueDayOfMonth,
    rateSteps: rateStepsFromYearlyRates(promo, bps(Math.round(num(d.floatingRate) * 100))),
    referenceRates: [],
    conventions: [defaultImportConvention(startDate)],
    installmentQuotedSatang: sat(d.installment),
    fees,
    ...(num(d.firePremium) > 0
      ? {
          fireInsurance: {
            kind: 'fire' as const,
            premiumSatang: sat(d.firePremium),
            termYears: d.fireTermYears,
            waivedFirstNYears: d.fireWaivedYears,
            escalationBpsPerRenewal: bps(0),
          },
        }
      : {}),
    ...(num(d.mrtaPremium) > 0
      ? {
          creditLife: {
            kind: 'MRTA' as const,
            premiumSatang: sat(d.mrtaPremium),
            coverageYears: Math.min(15, num(common.termYears)),
            financed: d.mrtaFinanced,
            rateDiscountBps: bps(Math.round(num(d.mrtaRateDiscount) * 100)),
            isRequired: false,
          },
        }
      : {}),
    lockinMonths: d.lockinMonths,
    prepayPenaltyBps: bps(300),
  }
}

export function bankName(code: string): string {
  return BANK_PRESETS.find((b) => b.code === code)?.nameTh ?? code
}

// ---------- อ่านของที่เก็บไว้ในเครื่อง ----------

/**
 * ของที่เก็บไว้อาจมาจากเวอร์ชันก่อนที่ยังไม่มีบางฟิลด์
 * เติมจาก default ให้ครบเสมอ ไม่งั้น `undefined` จะหลุดเข้า engine แล้วพังตอนคำนวณ
 */
export function reviveDrafts(raw: unknown): OfferDraft[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out = raw
    .filter((d): d is Partial<OfferDraft> => typeof d === 'object' && d !== null)
    .slice(0, MAX_OFFERS)
    .map((d, i) => {
      const base = emptyDraft(d.id ?? String(i), d.bankCode ?? NO_BANK)
      if (typeof d.customName !== 'string') delete d.customName
      const merged = { ...base, ...d }
      // promoRates ต้องเป็น array เสมอ ถ้าของเก่าเพี้ยนให้กลับไปใช้ของ default
      if (!Array.isArray(merged.promoRates)) merged.promoRates = base.promoRates
      return merged
    })
  return out.length > 0 ? out : null
}

export function reviveCommon(raw: unknown): CommonTerms | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  return { ...EMPTY_COMMON, ...(raw as Partial<CommonTerms>) }
}

/**
 * ปีที่เว้นว่างทั้งที่มีปีหลังกรอกไว้ — คืนเลขปี (1-based) หรือ null ถ้าไม่มีช่องโหว่
 *
 * ⛔ ห้ามปล่อยให้เว้นกลางได้
 *    rateStepsFromYearlyRates ให้ช่วงเวลาตาม "ลำดับใน array" ล้วน ๆ
 *    และ toLoanOffer filter ค่าว่างทิ้งก่อนส่งให้ ปีหลังจึงเลื่อนขึ้นมาแทนที่
 *    กรอกปี 1 กับปี 3 แล้วเว้นปี 2 จะได้ปี 2 = เรตของปี 3 และหมดโปรที่เดือน 25 แทน 37
 */
export function promoGap(rates: readonly (number | '')[]): number | null {
  let last = -1
  rates.forEach((r, i) => {
    if (typeof r === 'number') last = i
  })
  if (last < 0) return null
  for (let i = 0; i < last; i++) if (typeof rates[i] !== 'number') return i + 1
  return null
}

/** จำนวนปีที่มีเรตโปร — ใช้บอกว่าเรตลอยตัวกินเวลาเท่าไหร่ของสัญญา */
export function promoYears(d: OfferDraft): number {
  return d.promoRates.filter((r) => typeof r === 'number').length
}
