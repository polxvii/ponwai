/**
 * ค่างวดที่ต่างกันตามช่วงของใบเสนอ
 *
 * ธนาคารไทยมักคิดค่างวดช่วงโปรต่ำกว่าช่วงลอยตัว ถ้าบังคับให้กรอกค่าเดียว
 * ต้นทุนจริงของใบเสนอจะเพี้ยนตั้งแต่งวดที่พ้นโปรเป็นต้นไป
 *
 * ⚠️ ซ่อนไว้ใน details เพราะใบเสนอส่วนใหญ่ค่างวดเท่ากันตลอด
 *    ถ้ากางไว้ตลอดจะเพิ่ม 4 ช่องให้ทุกคนกรอก เพื่อคนส่วนน้อยที่ต้องใช้
 *    แต่เปิดกางไว้เองเมื่อมีค่าอยู่แล้ว ไม่งั้นค่าที่กรอกไว้จะหายไปจากสายตา
 * ⚠️ ช่องเรตที่เว้นว่างไม่นับเป็นช่วง จึงไม่แสดงช่องค่างวดของปีนั้น
 *    ขอบเขตเดือนของสองชุดต้องตรงกันเสมอ
 *
 * ⛔ ต้องบอกให้รู้เมื่อยังไม่มีช่องรายปีให้กรอก
 *    ฟอร์มเปล่าจะกางออกมาเจอแค่ "ค่างวดหลังพ้นโปร" ช่องเดียว
 *    ผู้ใช้อ่านว่าฟีเจอร์ไม่มีจริง ทั้งที่แค่ยังไม่ได้กรอกเรตของปีนั้น
 */

import { Field, NumberField } from '@/components/Field'

export function InstallmentBands({
  promoRates,
  promoInstallments,
  floatingInstallment,
  fallback,
  onChange,
}: {
  promoRates: readonly (number | '')[]
  promoInstallments: readonly (number | '')[]
  floatingInstallment: number | ''
  /** ค่างวดหลักที่จะถูกใช้เมื่อช่องนั้นเว้นว่าง — ใช้เป็น placeholder */
  fallback: number | ''
  onChange: (p: {
    promoInstallments?: (number | '')[]
    floatingInstallment?: number | ''
  }) => void
}) {
  const hasAny =
    promoInstallments.some((v) => typeof v === 'number') ||
    typeof floatingInstallment === 'number'
  const ph = fallback === '' ? '' : String(fallback)
  const noBands = !promoRates.some((r) => typeof r === 'number')

  const setPromo = (i: number, v: number | '') => {
    const next = [...promoInstallments]
    next[i] = v
    onChange({ promoInstallments: next })
  }

  return (
    <details className="mt-3" open={hasAny}>
      <summary className="tap cursor-pointer text-meta text-[var(--color-ink-2)]">
        ค่างวดแต่ละปีไม่เท่ากัน
        <span className="ml-2 text-micro text-[var(--color-ink-3)]">
          เว้นว่าง = ใช้ค่างวดด้านบนทุกช่วง
        </span>
      </summary>

      {noBands && (
        <p className="mt-3 text-meta text-[var(--color-ink-3)]">
          กรอกเรตโปรปีที่ 1–3 ด้านบนก่อน แล้วช่องค่างวดของปีนั้นจะขึ้นมาให้กรอกตรงนี้ —
          ช่วงของค่างวดต้องตรงกับช่วงของเรตเสมอ
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {promoRates.map((r, i) =>
          typeof r === 'number' ? (
            <Field key={i} label={`ค่างวดปีที่ ${i + 1}`} suffix="บาท">
              <NumberField
                value={promoInstallments[i] ?? ''}
                placeholder={ph}
                onChange={(v) => setPromo(i, v)}
              />
            </Field>
          ) : null,
        )}
        <Field label="ค่างวดหลังพ้นโปร" suffix="บาท">
          <NumberField
            value={floatingInstallment}
            placeholder={ph}
            onChange={(v) => onChange({ floatingInstallment: v })}
          />
        </Field>
      </div>
    </details>
  )
}
