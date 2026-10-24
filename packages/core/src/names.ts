/**
 * Who paid, read out of the statement's free-text detail.
 *
 * The real details look like this, three lines, the payer on the second:
 *
 *   รับโอนเงิน / SCB นาย สิริวิชญ์ ดีคล้าย / บัญชีต้นทาง : X579732
 *   รับโอนเงิน / BBL NOPPAMAS NILON MISS  / ...
 *   รับโอนเงิน / KTB MISS.SARANYA YOMSUTREE / ...
 *   จ่ายคิวอาร์พร้อมเพย์ / บัญชีต้นทาง : X472720 / ...   <- no payer at all
 *
 * So the title can lead, trail, or be glued to the name, and a QR PromptPay
 * transfer carries no name. Thai bank details have no reliable surname
 * position, so the rule is first-name containment.
 */

/** Sending banks seen in the statement. The code leads the payer line. */
const BANK_CODES = [
  "KBANK",
  "SCB",
  "KTB",
  "BBL",
  "TTB",
  "GSB",
  "BAY",
  "KKP",
  "BAAC",
  "UOB",
  "GHB",
  "CIMB",
  "LHBANK",
  "TISCO",
  "ICBC",
  "TMB",
];

/** Longest first, so นางสาว is never read as นาง + สาว. */
const TITLES = [
  "ว่าที่ร.ต.",
  "ว่าที่ ร.ต.",
  "ว่าที่",
  "นางสาว",
  "น.ส.",
  "ด.ญ.",
  "ด.ช.",
  "นาง",
  "นาย",
  "MISS.",
  "MISS",
  "MRS.",
  "MRS",
  "MR.",
  "MR",
  "MS.",
  "MS",
];

/** A payer line starting with one of these is an organization, not a person. */
const ORGANIZATIONS = ["บจก.", "บมจ.", "บริษัท", "หจก.", "ห้าง", "ร้าน", "กรม", "สำนักงาน"];

/** Remove every leading title, glued or spaced. */
export function stripTitle(name: string): string {
  let text = name.trim();
  for (let round = 0; round < 3; round += 1) {
    const before = text;
    for (const title of TITLES) {
      if (text.toUpperCase().startsWith(title.toUpperCase())) {
        text = text.slice(title.length).trim();
        break;
      }
    }
    if (text === before) break;
  }
  return text;
}

/** Remove a title written after the name, as BBL does: "NOPPAMAS NILON MISS". */
function stripTrailingTitle(name: string): string {
  let text = name.trim();
  for (let round = 0; round < 2; round += 1) {
    const before = text;
    for (const title of TITLES) {
      if (!text.toUpperCase().endsWith(title.toUpperCase())) continue;
      const head = text.slice(0, text.length - title.length);
      // Only a separate word is a title - "SOMCHAIMR" is just a name.
      if (head.trim() === "" || !/\s$/.test(head)) continue;
      text = head.trim();
      break;
    }
    if (text === before) break;
  }
  return text;
}

/** The line of the detail that carries the payer, or null when there is none. */
function payerLine(detail: string): string | null {
  const lines = detail
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  for (const line of lines) {
    const head = line.split(/\s+/)[0] ?? "";
    if (BANK_CODES.includes(head.toUpperCase())) return line.slice(head.length).trim();
  }
  // Some details carry the name without a bank code; the reference lines never do.
  const candidate = lines[1];
  if (candidate === undefined) return null;
  if (/^(บัญชีต้นทาง|หมายเลขอ้างอิง)/.test(candidate)) return null;
  return candidate;
}

/**
 * Does the detail name a payer at all - a person or an organization?
 * A QR PromptPay transfer names nobody, so there is nothing to disagree with.
 */
export function hasPayer(detail: string): boolean {
  return payerLine(detail) !== null;
}

/** Pull the payer's first name out of a free-text statement detail. */
export function firstNameFromDetail(detail: string): string | null {
  const line = payerLine(detail);
  if (line === null) return null;
  if (ORGANIZATIONS.some((org) => line.startsWith(org))) return null;

  const name = stripTrailingTitle(stripTitle(line));
  const first = name.split(/[\s/|,]+/).filter((part) => part !== "")[0];
  return first === undefined || first === "" ? null : first;
}

/** Does this statement detail name this customer? */
export function detailNamesCustomer(detail: string, customerName: string | null): boolean {
  if (customerName === null) return false;
  const first = firstNameFromDetail(detail);
  if (first === null) return false;
  const customer = stripTitle(customerName).toLowerCase();
  if (customer === "") return false;
  return customer.includes(first.toLowerCase());
}
