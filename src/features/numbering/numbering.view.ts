import { formString, type FormBody } from "../../web/form-values.ts";
import type { NumberingProfile } from "../../db/schema.ts";

export type NumberingProfileFormValues = {
  name: string;
  pattern: string;
  resetPeriod: string;
};

export function emptyNumberingProfileFormValues(): NumberingProfileFormValues {
  return {
    name: "",
    pattern: "{CLIENT_CODE}-{YYYYMM}-{SEQ:02}",
    resetPeriod: "monthly",
  };
}

export function numberingProfileFormValuesFromBody(
  body: FormBody,
): NumberingProfileFormValues {
  return {
    name: formString(body.name),
    pattern: formString(body.pattern),
    resetPeriod: formString(body.resetPeriod) || "monthly",
  };
}

export function numberingProfileFormValuesFromRow(
  row: NumberingProfile,
): NumberingProfileFormValues {
  return {
    name: row.name,
    pattern: row.pattern,
    resetPeriod: row.resetPeriod,
  };
}
