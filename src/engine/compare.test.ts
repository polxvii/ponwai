import { describe, it, expect } from 'vitest'
import { baht, bps, formatFixedBaht, formatSatangBaht, type Satang, type Fixed } from './money.js'
import { isoDate } from './date.js'
import { evaluateOffer, rankOffers, firstPostPromoMonth, type LoanOffer } from './compare.js'
import { xirr } from './xirr.js'
import { fixedStep, defaultConventions } from './test-helpers.js'
import type { OfferFee } from './fees.js'

const f = (v: Fixed) => formatFixedBaht(v)
const fs = (v: Satang) => formatSatangBaht(v)
const s = (n: number): Satang => baht(n)

const START = isoDate('2026-10-01')

function offer(o: Partial<LoanOffer> & { bankCode: string }): LoanOffer {
  return {
    loanAmountSatang: s(3_000_000),
    termMonths: 360,
    startDate: START,
    dueDayOfMonth: 1,
    rateSteps: [fixedStep(3.0, 1, 36), fixedStep(5.5, 37, null)],
    referenceRates: [],
    conventions: defaultConventions('2026-10-01'),
    installmentQuotedSatang: s(20_000),
    fees: [],
    lockinMonths: 36,
    prepayPenaltyBps: bps(300),
    ...o,
  }
}

const flatFee = (type: string, amountBaht: number, financed = false): OfferFee => ({
  feeType: type,
  basis: 'flat',
  amountSatang: s(amountBaht),
  isWaived: false,
  isFinanced: financed,
})

describe('TV-11 Equal-payment comparison', () => {
  // A: ดอกถูกกว่า แต่ค่าธรรมเนียมแพงกว่ามาก
  const bankA = offer({
    bankCode: 'A',
    rateSteps: [fixedStep(2.75, 1, 36), fixedStep(5.5, 37, null)],
    fees: [flatFee('ค่าธรรมเนียมจัดการ', 60_000)],
  })
  // B: ดอกแพงกว่า แต่แทบไม่มีค่าธรรมเนียม
  const bankB = offer({
    bankCode: 'B',
    rateSteps: [fixedStep(3.15, 1, 36), fixedStep(5.5, 37, null)],
    fees: [flatFee('ค่าประเมิน', 3_000)],
  })

  const opts = { equalPaymentSatang: s(20_000) }
  const a = evaluateOffer(bankA, opts)
  const b = evaluateOffer(bankB, opts)

  it('ค่างวดเท่ากันทั้งคู่ — เทียบบนฐานเดียวกันจริง', () => {
    expect(a.installmentUsedSatang).toBe(s(20_000))
    expect(b.installmentUsedSatang).toBe(s(20_000))
  })

  it('A ดอกถูกกว่า B ตลอด 36 งวด', () => {
    expect(a.interestPaidToHorizonFixed).toBeLessThan(b.interestPaidToHorizonFixed)
    expect(a.balanceAtHorizonFixed).toBeLessThan(b.balanceAtHorizonFixed)
  })

  it('แต่ตัดสินด้วย Net Position ไม่ใช่ดอกเบี้ยอย่างเดียว — A แพ้เพราะค่าธรรมเนียม', () => {
    expect(a.netPositionFixed).toBeGreaterThan(b.netPositionFixed)
    const ranked = rankOffers([bankA, bankB], opts)
    expect(ranked[0]!.bankCode).toBe('B')
    expect(ranked[1]!.bankCode).toBe('A')
  })

  it('Net Position = เงินต้นคงเหลือ + เงินสดที่จ่ายจริง', () => {
    expect(a.netPositionFixed).toBe(
      (a.balanceAtHorizonFixed + a.fees.payableCashSatang * 1_000_000_000_000n) as Fixed,
    )
  })

  it('ถ้าค่าธรรมเนียมของ A ลดลงเหลือใกล้ B อันดับต้องพลิกกลับ', () => {
    const cheaperA = { ...bankA, fees: [flatFee('ค่าธรรมเนียมจัดการ', 3_000)] }
    const ranked = rankOffers([cheaperA, bankB], opts)
    expect(ranked[0]!.bankCode).toBe('A')
  })
})

describe('⛔ ห้ามนับของที่ financed ซ้ำใน Net Position (ข้อ 2.2)', () => {
  const cash = offer({
    bankCode: 'CASH',
    creditLife: {
      kind: 'MRTA', premiumSatang: s(100_000), coverageYears: 15,
      financed: false, rateDiscountBps: bps(0), isRequired: false,
    },
  })
  const financed = offer({
    bankCode: 'FIN',
    creditLife: {
      kind: 'MRTA', premiumSatang: s(100_000), coverageYears: 15,
      financed: true, rateDiscountBps: bps(0), isRequired: false,
    },
  })

  const opts = { equalPaymentSatang: s(20_000) }
  const c = evaluateOffer(cash, opts)
  const fi = evaluateOffer(financed, opts)

  it('ฝั่ง financed วงเงินต้องโตขึ้น 100,000 ส่วนฝั่งเงินสดไม่โต', () => {
    expect(fs(fi.effectivePrincipalSatang)).toBe('3,100,000.00')
    expect(fs(c.effectivePrincipalSatang)).toBe('3,000,000.00')
  })

  it('เบี้ยที่ financed อยู่ในเงินต้นแล้ว ต้องไม่ถูกบวกเป็นเงินสดอีก', () => {
    expect(fi.fees.payableCashSatang).toBe(0n)
    // Net Position ของฝั่ง financed = เงินต้นคงเหลืออย่างเดียว
    expect(fi.netPositionFixed).toBe(fi.balanceAtHorizonFixed)
  })

  it('ส่วนต่างต้องสมเหตุสมผล ไม่ใช่ห่างกันเต็ม 100,000', () => {
    // ฝั่ง financed เสียดอกเบี้ยของเบี้ยด้วย จึงแพงกว่าเล็กน้อย ไม่ใช่แพงกว่าทั้งก้อน
    const gap = fi.netPositionFixed - c.netPositionFixed
    expect(gap).toBeGreaterThan(0n)
    expect(gap).toBeLessThan(100_000n * 100n * 1_000_000_000_000n)
  })
})

describe('shock test: ค่างวดขั้นต่ำหลังพ้นโปร (ข้อ 2.3)', () => {
  it('หา งวดแรกที่พ้นโปร ได้ถูกต้อง', () => {
    expect(firstPostPromoMonth([fixedStep(3.0, 1, 36), fixedStep(5.5, 37, null)])).toBe(37)
    expect(firstPostPromoMonth([
      fixedStep(2.5, 1, 12), fixedStep(3.25, 13, 24), fixedStep(4.83, 25, null),
    ])).toBe(25)
  })

  it('ค่างวดขั้นต่ำหลังพ้นโปรต้องสูงกว่าตอนต้น — นี่คือตัวเลขที่คนมักไม่ดู', () => {
    const m = evaluateOffer(offer({ bankCode: 'X' }), { equalPaymentSatang: s(20_000) })
    expect(m.firstPostPromoMonth).toBe(37)
    expect(m.minInstallmentAfterPromoSatang).toBeGreaterThan(m.minInstallmentMonth1Satang)
  })
})

describe('infeasible ต้อง mark ไม่ใช่ซ่อน (ข้อ 2.2)', () => {
  it('ค่างวดล็อกต่ำกว่าดอกเบี้ย -> feasible = false พร้อมเหตุผล', () => {
    const m = evaluateOffer(
      offer({ bankCode: 'LOW', rateSteps: [fixedStep(7.0, 1, null)] }),
      { equalPaymentSatang: s(10_000) },
    )
    expect(m.feasible).toBe(false)
    expect(m.infeasibleReason).toMatch(/ค่างวดต่ำกว่าดอกเบี้ย/)
  })

  it('ข้อเสนอที่ infeasible ต้องยังอยู่ในผลลัพธ์ แต่ไปอยู่ท้าย', () => {
    const ok = offer({ bankCode: 'OK' })
    const bad = offer({ bankCode: 'BAD', rateSteps: [fixedStep(7.0, 1, null)] })
    const ranked = rankOffers([bad, ok], { equalPaymentSatang: s(10_000) })
    expect(ranked).toHaveLength(2)
    expect(ranked[0]!.bankCode).toBe('OK')
    expect(ranked[1]!.bankCode).toBe('BAD')
    expect(ranked[1]!.feasible).toBe(false)
  })
})

describe('XIRR', () => {
  it('กู้ 100 คืน 110 ใน 1 ปี = 10%', () => {
    const r = xirr([
      { date: isoDate('2026-01-01'), amount: 100 },
      { date: isoDate('2027-01-01'), amount: -110 },
    ])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.rate).toBeCloseTo(0.1, 4)
  })

  it('ไม่มี sign change -> ต้องบอกว่าคำนวณไม่ได้ ไม่ใช่คืนเลขมั่ว', () => {
    const r = xirr([
      { date: isoDate('2026-01-01'), amount: -100 },
      { date: isoDate('2027-01-01'), amount: -110 },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no_sign_change')
  })

  it('EIR ของข้อเสนอที่มีค่าธรรมเนียม ต้องสูงกว่าข้อเสนอที่ไม่มี ทั้งที่เรตเท่ากัน', () => {
    const opts = { equalPaymentSatang: s(20_000) }
    const noFee = evaluateOffer(offer({ bankCode: 'NOFEE' }), opts)
    const withFee = evaluateOffer(
      offer({ bankCode: 'FEE', fees: [flatFee('จัดการสินเชื่อ', 60_000)] }), opts,
    )
    expect(noFee.eirBps).not.toBeNull()
    expect(withFee.eirBps).not.toBeNull()
    expect(withFee.eirBps!).toBeGreaterThan(noFee.eirBps!)
  })

  it('EIR ต้องสูงกว่าเรตในสัญญา เพราะรวมค่าธรรมเนียมเข้าไปด้วย', () => {
    const m = evaluateOffer(
      offer({ bankCode: 'X', fees: [flatFee('จัดการสินเชื่อ', 60_000)] }),
      { equalPaymentSatang: s(20_000) },
    )
    expect(m.eirBps!).toBeGreaterThan(300) // เรตโปร 3.00%
  })
})

describe('ประกันอัคคีภัยต้องเข้า Net Position ที่เวลาจริง', () => {
  it('เบี้ยที่ยังไม่ถึงกำหนดจ่ายในช่วง 36 เดือน ต้องไม่ถูกนับ', () => {
    const withFire = offer({
      bankCode: 'FIRE',
      fireInsurance: {
        kind: 'fire', premiumSatang: s(3_000), termYears: 3,
        waivedFirstNYears: 3, escalationBpsPerRenewal: bps(0),
      },
    })
    const m = evaluateOffer(withFire, { equalPaymentSatang: s(20_000) })
    // ฟรี 3 ปีแรก งวดแรกที่ต้องจ่ายคือปีสัญญาที่ 4 ซึ่งอยู่นอก horizon 36 เดือน
    expect(m.fireSchedule[0]!.contractYear).toBe(4)
    expect(m.netPositionFixed).toBe(m.balanceAtHorizonFixed)
    // แต่ต้องถูกนับใน TCO ตลอดสัญญา
    expect(fs(m.nonInterestCostSatang)).toBe('27,000.00')
  })
})
