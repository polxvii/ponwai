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

/** สิ่งที่ผู้ใช้กรอกจริง ทุกจำนวนเงินเป็นบาท */
export type OfferDraft = {
  id: string
  bankCode: string
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

export function emptyDraft(id: string, bankCode: string): OfferDraft {
  return {
    id,
    bankCode,
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

/** ข้อมูลที่ใช้ร่วมกันทุกข้อเสนอ — ต้องเท่ากันหมด ไม่งั้นเทียบคนละฐาน */
export type CommonTerms = {
  loanAmount: number | ''
  termYears: number
  startDate: ISODate
  dueDayOfMonth: number
}

export const DEFAULT_COMMON: CommonTerms = {
  loanAmount: 3_000_000,
  termYears: 30,
  startDate: isoDate('2026-10-01'),
  dueDayOfMonth: 1,
}

// ---------- ความครบถ้วนของข้อมูล (ข้อ 5A.3 วิธีที่ 4) ----------

export type Completeness = {
  /** คำนวณได้แล้วหรือยัง */
  ready: boolean
  /** รายการที่ยังขาด พร้อมผลกระทบเป็นบาท */
  missing: { label: string; impact: string }[]
}

/**
 * ให้ผลลัพธ์ตั้งแต่ยังกรอกไม่ครบ แล้วบอกว่าที่ขาดอาจคลาดเคลื่อนเท่าไหร่
 * ดีกว่าบังคับให้กรอก 40-50 ช่องก่อนถึงจะเห็นอะไรเลย
 */
export function assessCompleteness(d: OfferDraft, common: CommonTerms): Completeness {
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

  const ready =
    typeof common.loanAmount === 'number' &&
    typeof d.installment === 'number' &&
    d.installment > 0 &&
    typeof d.floatingRate === 'number' &&
    d.promoRates.some((r) => typeof r === 'number')

  return { ready, missing }
}

// ---------- แปลงเป็น LoanOffer ----------

const num = (v: number | '' | undefined): number => (typeof v === 'number' ? v : 0)
const sat = (v: number | '' | undefined): Satang => baht(num(v))

export function toLoanOffer(d: OfferDraft, common: CommonTerms): LoanOffer {
  const preset = BANK_PRESETS.find((b) => b.code === d.bankCode)
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
    bankCode: d.bankCode,
    ...(preset ? { productName: preset.nameTh } : {}),
    loanAmountSatang: baht(loanAmount),
    termMonths: common.termYears * 12,
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
            coverageYears: Math.min(15, common.termYears),
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
