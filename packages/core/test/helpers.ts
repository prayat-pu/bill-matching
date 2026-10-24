import type { Receipt, ReportLine, StatementRow } from "../src/types.ts";
import { parseDayFirstDate, parseDayFirstDateTime } from "../src/dates.ts";

interface ReportLineInput {
  id: string;
  date: string;
  totalPaymentDue: number;
  room?: string | null;
  customerName?: string | null;
  reportStatus?: string | null;
  sourceRow?: number;
}

export function reportLine(input: ReportLineInput): ReportLine {
  return {
    id: input.id,
    date: parseDayFirstDate(input.date)!,
    room: input.room ?? null,
    totalPaymentDue: input.totalPaymentDue,
    customerName: input.customerName ?? null,
    reportStatus: input.reportStatus ?? null,
    sourceRow: input.sourceRow ?? 6,
  };
}

interface ReceiptInput {
  id: string;
  date: string;
  time: string;
  totalPaymentDue?: number | null;
  paymentInfo?: string | null;
  room?: string | null;
}

export function receipt(input: ReceiptInput): Receipt {
  return {
    id: input.id,
    datetime: parseDayFirstDateTime(input.date, input.time)!,
    room: input.room ?? null,
    totalPaymentDue: input.totalPaymentDue ?? null,
    paymentInfo: input.paymentInfo ?? null,
    company: null,
  };
}

interface StatementRowInput {
  date: string;
  time: string;
  amount: number;
  detail?: string;
}

export function statementRow(index: number, input: StatementRowInput): StatementRow {
  return {
    index,
    datetime: parseDayFirstDateTime(input.date, input.time)!,
    amount: input.amount,
    detail: input.detail ?? "",
    sourceRow: 9 + index,
  };
}
