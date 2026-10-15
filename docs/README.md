# เอกสารโปรเจกต์ PonWai

เขียนไว้ให้คนหรือ Claude ที่มาทำต่อ **โดยไม่มีประวัติแชทเดิม** ทำงานต่อได้ทันที

**อยากเห็นภาพรวมเร็ว ๆ:** เปิด [project-summary.html](project-summary.html) ด้วยเบราว์เซอร์ — ไฟล์เดียวจบ มี diagram ครบ เปิดออฟไลน์ได้

## ลำดับการอ่าน

| # | ไฟล์ | อ่านเมื่อ |
|---|---|---|
| 1 | [overview.md](overview.md) | ครั้งแรก — แอพนี้คืออะไร URL อะไร stack อะไร ไฟล์อยู่ไหน |
| 2 | [domain-rules.md](domain-rules.md) | **ก่อนแตะ engine หรือตัวเลขใด ๆ** — กฎที่เคยผิดมาแล้วทั้งหมด |
| 3 | [architecture.md](architecture.md) | ก่อนแก้โค้ด — แต่ละโฟลเดอร์/ไฟล์ทำอะไร |
| 4 | [data-model.md](data-model.md) | ก่อนแก้ DB หรือ `db.ts` |
| 5 | [operations.md](operations.md) | จะรัน ทดสอบ deploy หรือแก้ปัญหา production |
| 6 | [account-migration.md](account-migration.md) | จะย้าย Claude / GitHub / Cloudflare / Supabase account |
| – | [diagrams.md](diagrams.md) | ต้นฉบับ diagram (Mermaid) · ภาพแยกไฟล์อยู่ใน [diagrams/](diagrams/README.md) ตั้งชื่อตามเรื่อง |
| – | [project-summary.html](project-summary.html) | สรุปทั้งโปรเจกต์หน้าเดียว + diagram ฝังในตัว |
| – | [test-vectors.md](test-vectors.md) | TV ไหนตรึงกฎอะไร อยู่ไฟล์ไหน |
| – | [history.md](history.md) | ทำไมถึงเป็นแบบนี้ — การตัดสินใจและเหตุการณ์สำคัญ |
| – | [backlog.md](backlog.md) | ของที่ยังขาด |

แหล่งอ้างอิงเดิม: [`../home-loan-app-spec.md`](../home-loan-app-spec.md) — spec ตั้งต้น เลข "ข้อ x.y" ในคอมเมนต์โค้ดอ้างไฟล์นี้
ถ้า spec กับเอกสารนี้ขัดกัน **เอกสารนี้ใหม่กว่า** (spec ไม่ได้อัปเดตตามการเปลี่ยนแปลงระหว่างใช้งานจริง)

## การดูแลเอกสาร — ต้องอัปเดตใน commit เดียวกับโค้ด

| เปลี่ยนอะไร | อัปเดตที่ |
|---|---|
| เพิ่ม/แก้กฎการคำนวณ หรือแก้บั๊กตัวเลข | `domain-rules.md` + เพิ่ม TV ใหม่ + แถวใน `test-vectors.md` |
| เพิ่ม migration | ตาราง migrations ใน `data-model.md` (+ ER ใน `diagrams.md` ถ้ามีตาราง/คอลัมน์ใหม่) |
| เพิ่ม/ย้ายไฟล์หรือหน้าจอ | `architecture.md` (+ `diagrams.md` §2–3) |
| เปลี่ยน CI, deploy, URL, secret, ตั้งค่า Supabase | `operations.md` + `account-migration.md` (+ `diagrams.md` §1, §8) |
| ตัดสินใจเรื่องใหญ่ / ผู้ใช้สั่งเอาอะไรออก | `history.md` |
| เจอของที่ยังไม่ทำ / ทำเสร็จจาก backlog | `backlog.md` |
| แก้ / เพิ่ม diagram | `diagrams.md` แล้วรัน `node scripts/docs-diagrams.mjs` (สร้าง svg + ฝังลง html ให้เอง) |
| เปลี่ยนเรื่องระดับภาพรวม (URL, บริการ, stack, กฎหลัก, backlog หลัก) | `project-summary.html` ด้วย — เนื้อหาหน้านี้เขียนมือ |

`src/lib/docs-sync.test.ts` (TV-56) ตรวจเรื่องที่ลืมบ่อยที่สุด — ไม่ครบ CI แดงและไม่ deploy
- ทุก TV ในเทสต์ต้องอยู่ใน `test-vectors.md` · ทุกไฟล์ migration ต้องอยู่ใน `data-model.md`
- ลิงก์ระหว่างไฟล์ใน docs/ ต้องไม่เสีย
- ภาพ svg และภาพที่ฝังใน `project-summary.html` ต้องสร้างจาก `diagrams.md` ฉบับปัจจุบัน (เทียบ hash ของต้นฉบับ)

## ข้อห้ามเรื่องข้อมูลในเอกสาร

repo นี้ **public** — ห้ามใส่ใน docs: credential ทุกชนิด, อีเมล/รหัสบัญชีทดสอบ, ตัวเลขสัญญาจริงของผู้ใช้
(ยอดหนี้ ค่างวด อัตรา ธนาคาร) — ใช้ตัวเลขสมมติแทนเสมอ
