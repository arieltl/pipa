import { describe, expect, test } from "bun:test";
import {
  hasSequenceToken,
  periodKeyFor,
  renderNumberPattern,
  unknownNumberPatternTokens,
} from "./numbering.ts";

describe("periodKeyFor", () => {
  test("buckets by reset period", () => {
    expect(periodKeyFor("never", "2026-06-30")).toBe("all");
    expect(periodKeyFor("yearly", "2026-06-30")).toBe("2026");
    expect(periodKeyFor("monthly", "2026-06-30")).toBe("2026-06");
    expect(periodKeyFor("daily", "2026-06-30")).toBe("2026-06-30");
  });
});

describe("renderNumberPattern", () => {
  const ctx = { clientCode: "LONDONCO", invoiceDate: "2026-06-30", seq: 1 };

  test("default monthly pattern", () => {
    expect(renderNumberPattern("{CLIENT_CODE}-{YYYYMM}-{SEQ:02}", ctx)).toBe(
      "LONDONCO-202606-01",
    );
  });

  test("yearly pattern with wider padding", () => {
    expect(
      renderNumberPattern("{CLIENT_CODE}-{YYYY}-{SEQ:03}", { ...ctx, seq: 7 }),
    ).toBe("LONDONCO-2026-007");
  });

  test("all date tokens", () => {
    expect(
      renderNumberPattern("{YY}/{MM}/{DD}", { ...ctx, invoiceDate: "2026-06-09" }),
    ).toBe("26/06/09");
  });

  test("bare SEQ has no padding", () => {
    expect(renderNumberPattern("{CLIENT_CODE}-{SEQ}", { ...ctx, seq: 42 })).toBe(
      "LONDONCO-42",
    );
  });

  test("seq wider than padding is not truncated", () => {
    expect(renderNumberPattern("{SEQ:02}", { ...ctx, seq: 1234 })).toBe("1234");
  });

  test("four digit padding is a minimum width", () => {
    expect(renderNumberPattern("{SEQ:04}", { ...ctx, seq: 7 })).toBe("0007");
    expect(renderNumberPattern("{SEQ:04}", { ...ctx, seq: 12345 })).toBe(
      "12345",
    );
  });

  test("unknown tokens are left verbatim", () => {
    expect(renderNumberPattern("{CLIENT_CODE}-{BOGUS}", ctx)).toBe(
      "LONDONCO-{BOGUS}",
    );
  });
});

describe("numbering pattern validation", () => {
  test("detects sequence tokens and unsupported tokens", () => {
    expect(hasSequenceToken("{CLIENT_CODE}-{YYYY}-{SEQ:04}")).toBe(true);
    expect(hasSequenceToken("{CLIENT_CODE}-{YYYY}")).toBe(false);
    expect(unknownNumberPatternTokens("{CLIENT_CODE}-{NOPE}-{SEQ:02}")).toEqual([
      "NOPE",
    ]);
  });
});
