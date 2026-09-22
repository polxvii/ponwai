/**
 * เก็บสิ่งที่กรอกไว้ในเครื่อง
 *
 * ชั้นนี้ใช้ตอนยังไม่ล็อกอิน — refresh แล้วไม่หาย แต่ข้ามเครื่องไม่ได้
 * พอล็อกอินแล้วของจริงจะอยู่ที่ Supabase (M4) แล้วย้ายของจากที่นี่ขึ้นไปครั้งเดียว
 *
 * ⚠️ เก็บได้เฉพาะค่าที่เป็น JSON ล้วน
 *    ⛔ ห้ามเก็บ Satang/Fixed ที่เป็น bigint — JSON.stringify โยน TypeError ทันที
 *    ทุกหน้าจึงเก็บ "สิ่งที่ผู้ใช้กรอก" (บาทเป็น number) ไม่ใช่ผลลัพธ์ที่ engine คำนวณ
 */

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/** ขึ้นเลขเวอร์ชันเมื่อโครงสร้างที่เก็บเปลี่ยนจนของเก่าใช้ไม่ได้ */
const PREFIX = 'ponwai:v1:'

export function useLocalState<T>(
  key: string,
  initial: T,
  /** เติมฟิลด์ที่เพิ่มมาทีหลังให้ของเก่า คืน null ถ้าของที่อ่านมาใช้ไม่ได้เลย */
  revive?: (raw: unknown) => T | null,
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const full = PREFIX + key

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(full)
      if (raw === null) return initial
      const parsed: unknown = JSON.parse(raw)
      const revived = revive ? revive(parsed) : (parsed as T)
      return revived ?? initial
    } catch {
      // JSON พัง หรือเบราว์เซอร์ปิด storage — เริ่มใหม่ดีกว่าแอพพัง
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(full, JSON.stringify(value))
    } catch {
      // โควต้าเต็ม หรือโหมดส่วนตัวของ Safari ที่ setItem โยน error
      // ไม่ต้องเตือน เพราะผู้ใช้ทำอะไรไม่ได้ และของที่กรอกยังอยู่ใน state ปกติ
    }
  }, [full, value])

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(full)
    } catch {
      /* ไม่เป็นไร */
    }
    setValue(initial)
    // initial เป็นค่าคงที่ระดับโมดูล จึงไม่ต้องใส่ใน deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full])

  return [value, setValue, reset]
}

/** เติมฟิลด์ที่ขาดจาก default ใช้กับ object ชั้นเดียว */
export function mergeShape<T extends object>(raw: unknown, fallback: T): T | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  return { ...fallback, ...(raw as Partial<T>) }
}
