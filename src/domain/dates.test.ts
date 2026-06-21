import { describe, expect, test } from "bun:test";
import {
  formatDateBr,
  isValidDateString,
  monthNameEn,
  monthNamePt,
} from "./dates.ts";

describe("monthNameEn", () => {
  test("returns English month name", () => {
    expect(monthNameEn("2026-06-30")).toBe("June");
    expect(monthNameEn("2026-01-01")).toBe("January");
    expect(monthNameEn("2026-12-31")).toBe("December");
  });
});

describe("monthNamePt", () => {
  test("returns Portuguese month name", () => {
    expect(monthNamePt("2026-06-30")).toBe("junho");
    expect(monthNamePt("2026-03-10")).toBe("março");
    expect(monthNamePt("2026-12-01")).toBe("dezembro");
  });
});

describe("formatDateBr", () => {
  test("reformats to DD/MM/YYYY", () => {
    expect(formatDateBr("2026-06-30")).toBe("30/06/2026");
  });
  test("leaves malformed input unchanged", () => {
    expect(formatDateBr("nope")).toBe("nope");
  });
});

describe("isValidDateString", () => {
  test("accepts real dates and rejects rollovers", () => {
    expect(isValidDateString("2026-06-30")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("2026-6-1")).toBe(false);
  });
});
