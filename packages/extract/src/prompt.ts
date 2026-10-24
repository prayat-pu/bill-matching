import { BANKS } from "./schema.ts";

/**
 * Receipt layouts differ by company: 44 เรสซิเดนซ์ and 44 เฮ้า have two bank
 * checkboxes on the handwritten slip, the others list payment methods at the
 * bottom left.
 */
export type ReceiptLayout = "bank-checkbox" | "method-list";

export function layoutForCompany(company: string): ReceiptLayout {
  const text = company.toLowerCase();
  const bankCheckbox = ["44 residence", "44 เรสซิเดนซ์", "44 house", "44 เฮ้า"];
  return bankCheckbox.some((name) => text.includes(name.toLowerCase())) ? "bank-checkbox" : "method-list";
}

const LAYOUT_HINT: Record<ReceiptLayout, string> = {
  "bank-checkbox": `ช่องทางการชำระเงินอยู่ในสลิปลายมือด้านบนซ้ายของใบเสร็จ
สลิปมีช่องสี่เหลี่ยมสองช่องวางซ้อนกันในแนวตั้ง
- ช่องบน คู่กับข้อความ "โอนเข้า ธ.กรุงไทย"
- ช่องล่าง คู่กับข้อความ "โอนเข้า ธ.กรุงศรี"

ขั้นที่ 1 ให้ดูทีละช่องว่าภายในกรอบมีรอยเขียนทับหรือไม่
รอยอาจเป็น X ขีดทแยง ขีดตรง วงกลม หรือรอยขีดใด ๆ ก็ได้
ระวัง เส้นขอบของกรอบเองไม่นับเป็นรอย และรอยที่อยู่ "นอกกรอบ" ไม่นับ
ขั้นที่ 2 ตอบ marked_box
- "upper" ถ้ารอยอยู่ในช่องบน
- "lower" ถ้ารอยอยู่ในช่องล่าง
- "none" ถ้าไม่มีช่องใดมีรอย หรือดูไม่ออก
ขั้นที่ 3 ตอบ bank ให้ตรงกับ marked_box
- upper -> "ธ.กรุงไทย"
- lower -> "ธ.กรุงศรี"
- none  -> "ไม่ทราบ"
ห้ามเดาธนาคารจากใบอื่น ให้ดูเฉพาะใบนี้`,
  "method-list": `ช่องทางการชำระเงินอยู่ที่มุมล่างซ้ายของใบเสร็จ เป็นรายการวิธีชำระเงิน
ให้ดูว่ารายการไหนถูกทำเครื่องหมาย เครื่องหมายอาจเป็น X ขีดทแยง วงกลม หรือรอยขีดใด ๆ
ตอบ marked_box เป็น "none" เสมอสำหรับใบแบบนี้
ถ้าดูไม่ออกจริง ๆ ให้ตอบ bank เป็น "ไม่ทราบ"`,
};

export function buildPrompt(company: string): string {
  const layout = layoutForCompany(company);
  return `คุณกำลังอ่านรูปถ่ายใบเสร็จรับเงิน/ใบกำกับภาษีของบริษัท ${company}
รูปหนึ่งรูปมีใบเสร็จหนึ่งใบ แต่บางรูปอาจมีมากกว่าหนึ่งใบ ให้ตอบทุกใบที่เห็น
อ่านเฉพาะสิ่งที่เห็นจริงในรูป ห้ามเดา

ค่าที่ต้องอ่าน

1. id = เลขที่(ID) ที่ "พิมพ์" ไว้มุมขวาบน เช่น RCD202605000002 คัดลอกทุกตัวอักษร
2. date = "วันที่(Date)" ที่ "พิมพ์" ไว้มุมขวาบน รูปแบบ DD/MM/YYYY เป็นปี ค.ศ.
   ใช้วันที่ที่พิมพ์เท่านั้น ห้ามใช้วันที่ลายมือ เพราะลายมือมักเขียนผิดเดือน
3. slip_date = วันที่ชำระที่ "เขียนด้วยลายมือ" ในสลิป ตอบตามที่เห็นจริง เช่น "1/4/69"
   ถ้าไม่มีลายมือ ตอบ ""
4. time = "เวลา" ที่เขียนด้วยลายมือในสลิป เช่น 9.24 คือ 09:24
   ตอบ HH:MM แบบ 24 ชั่วโมง ถ้าไม่มี ตอบ ""
5. room = ห้อง(Room) ที่พิมพ์ไว้
6. total_payment_due = ยอดเงินสุทธิ (Total Payment Due) ที่พิมพ์ไว้ ตัวเลขอย่างเดียว ไม่ใส่คอมมา
7. customer_name = ลูกค้า(Customer)
8. company = ชื่อบริษัทที่หัวใบเสร็จ
9. marked_box และ bank
${LAYOUT_HINT[layout]}
   bank ต้องเป็นค่าใดค่าหนึ่งนี้เท่านั้น: ${BANKS.join(" / ")}
10. bank_confidence = "sure" ถ้าเห็นรอยในกรอบชัดเจน, "unsure" ถ้าไม่ชัด
    ถ้า marked_box เป็น "none" ต้องตอบ "unsure"

ข้อห้าม
- ห้ามเดาตัวเลขที่อ่านไม่ออก ถ้าอ่านไม่ออกให้ตอบ ""
- ห้ามปัดเศษหรือแปลงหน่วยเงิน
- รูปอาจเอียงหรือถ่ายไม่ตรง ให้พยายามอ่านตามจริง`;
}
