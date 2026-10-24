import { describe, expect, it } from "vitest";
import { detailNamesCustomer, firstNameFromDetail, stripTitle } from "../src/names.ts";

/** Details copied from raw/statement_res_1-25.xlsx. */
function detail(payerLine: string): string {
  return `รับโอนเงิน\n${payerLine}\nบัญชีต้นทาง : X579732\nหมายเลขอ้างอิง : 1466579732`;
}

describe("firstNameFromDetail", () => {
  it("reads a Thai title after the bank code", () => {
    expect(firstNameFromDetail(detail("SCB นาย สิริวิชญ์ ดีคล้าย"))).toBe("สิริวิชญ์");
    expect(firstNameFromDetail(detail("KBANK น.ส. กัญณิกา พิลา"))).toBe("กัญณิกา");
    expect(firstNameFromDetail(detail("GSB นางสาว รักษิณา รอดพล"))).toBe("รักษิณา");
    expect(firstNameFromDetail(detail("BAAC นาง วรัญญา มณีวรรณ"))).toBe("วรัญญา");
  });

  it("reads a title glued to the name", () => {
    expect(firstNameFromDetail(detail("KTB MISS.SARANYA YOMSUTREE"))).toBe("SARANYA");
    expect(firstNameFromDetail(detail("KBANK น.ส.พิมพ์นิภา ใจดี"))).toBe("พิมพ์นิภา");
    expect(firstNameFromDetail(detail("TTB MISSWENIGA SMITH"))).toBe("WENIGA");
  });

  it("reads a title written after the name, the way BBL does", () => {
    expect(firstNameFromDetail(detail("BBL NOPPAMAS NILON MISS"))).toBe("NOPPAMAS");
    expect(firstNameFromDetail(detail("BAY PENPITCHA TEA"))).toBe("PENPITCHA");
  });

  it("keeps a name that merely ends in title letters", () => {
    expect(firstNameFromDetail(detail("BBL SOMCHAIMR JAIDEE"))).toBe("SOMCHAIMR");
  });

  it("gives nothing for an organization or a QR transfer", () => {
    expect(firstNameFromDetail(detail("SCB บริษัท ดวงเจริญอินเตอร์เทรด จำกัด"))).toBeNull();
    expect(firstNameFromDetail(detail("KBANK บจก. สี่สี่ รูม"))).toBeNull();
    expect(
      firstNameFromDetail("จ่ายคิวอาร์พร้อมเพย์\nบัญชีต้นทาง : X472720\nหมายเลขอ้างอิง : 0610472720"),
    ).toBeNull();
  });
});

describe("stripTitle", () => {
  it("drops a leading title from the report's customer name", () => {
    expect(stripTitle("นาย สมชาย ใจดี")).toBe("สมชาย ใจดี");
    expect(stripTitle("นางสาวศรัณยา โยมสุรี")).toBe("ศรัณยา โยมสุรี");
    expect(stripTitle("MISS.SARANYA YOMSUTREE")).toBe("SARANYA YOMSUTREE");
    expect(stripTitle("สมชาย ใจดี")).toBe("สมชาย ใจดี");
  });
});

describe("detailNamesCustomer", () => {
  it("matches on first-name containment, ignoring case and title", () => {
    expect(detailNamesCustomer(detail("SCB นาย สิริวิชญ์ ดีคล้าย"), "สิริวิชญ์ ดีคล้าย")).toBe(true);
    expect(detailNamesCustomer(detail("KTB MISS.SARANYA YOMSUTREE"), "นางสาวศรัณยา โยมสุรี")).toBe(false);
    expect(detailNamesCustomer(detail("KTB MISS.SARANYA YOMSUTREE"), "saranya yomsutree")).toBe(true);
  });

  it("says no when there is no payer name or no customer", () => {
    expect(detailNamesCustomer(detail("SCB บริษัท ดวงเจริญ จำกัด"), "สมชาย")).toBe(false);
    expect(detailNamesCustomer(detail("SCB นาย สมชาย"), null)).toBe(false);
  });
});
