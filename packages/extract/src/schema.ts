import { Type } from "@google/genai";
import { z } from "zod";

/**
 * The model returns an enum, not free text. The old app matched substrings of
 * whatever the model felt like writing; this removes that whole failure mode.
 */
export const BANKS = [
  "ธ.กรุงไทย",
  "ธ.กรุงศรี",
  "เงินสด",
  "บัตรเครดิต",
  "โอนขาด",
  "โอนเกิน",
  "คืนประกัน",
  "zuzuจ่าย ณ ที่พัก",
  "เข้าระบบZUZU",
  "ไม่ทราบ",
] as const;
export type Bank = (typeof BANKS)[number];

export const CONFIDENCE = ["sure", "unsure"] as const;

/** Where the tick sits on the handwritten slip. Naming the box before naming
 *  the bank makes the model look at the paper instead of guessing. */
export const MARKED_BOX = ["upper", "lower", "none"] as const;

/** What one receipt image yields. Field names match the receipt record contract. */
export const extractedReceiptSchema = z.object({
  id: z.string(),
  date: z.string(),
  time: z.string(),
  room: z.string(),
  total_payment_due: z.string(),
  /** The payment date as written by hand on the slip. Staff get this wrong, so
   *  it is kept for the audit trail only - `date` is the printed one. */
  slip_date: z.string(),
  marked_box: z.enum(MARKED_BOX),
  bank: z.enum(BANKS),
  bank_confidence: z.enum(CONFIDENCE),
  customer_name: z.string(),
  company: z.string(),
});
export type ExtractedReceipt = z.infer<typeof extractedReceiptSchema>;

export const extractionResponseSchema = z.object({
  receipts: z.array(extractedReceiptSchema),
});

/** The same shape, in the form Gemini's structured output wants. */
export const geminiResponseSchema = {
  type: Type.OBJECT,
  properties: {
    receipts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "เลขที่(ID) ที่พิมพ์ไว้ เช่น RCD202605000002" },
          date: { type: Type.STRING, description: "วันที่ชำระเงิน รูปแบบ DD/MM/YYYY ค.ศ." },
          time: { type: Type.STRING, description: "เวลาที่ชำระเงิน รูปแบบ HH:MM แบบ 24 ชั่วโมง" },
          room: { type: Type.STRING, description: "ห้อง(Room)" },
          total_payment_due: { type: Type.STRING, description: "ยอดเงินสุทธิ ตัวเลขเท่านั้น" },
          slip_date: { type: Type.STRING, description: "วันที่ชำระที่เขียนด้วยลายมือ ตามที่เห็นจริง เช่น 1/4/69" },
          marked_box: { type: Type.STRING, enum: [...MARKED_BOX] },
          bank: { type: Type.STRING, enum: [...BANKS] },
          bank_confidence: { type: Type.STRING, enum: [...CONFIDENCE] },
          customer_name: { type: Type.STRING, description: "ลูกค้า(Customer)" },
          company: { type: Type.STRING, description: "ชื่อบริษัทที่หัวใบเสร็จ" },
        },
        required: [
          "id",
          "date",
          "time",
          "room",
          "total_payment_due",
          "slip_date",
          "marked_box",
          "bank",
          "bank_confidence",
          "customer_name",
          "company",
        ],
        propertyOrdering: [
          "id",
          "date",
          "time",
          "room",
          "total_payment_due",
          "slip_date",
          "marked_box",
          "bank",
          "bank_confidence",
          "customer_name",
          "company",
        ],
      },
    },
  },
  required: ["receipts"],
} as const;
