import type { IssuerSettings } from "../../db/schema.ts";
import { formString, str, type FormBody } from "../../web/form-values.ts";
import type { IssuerFormValues } from "./components/issuer-form.tsx";

/** DB row (or empty) to form values for rendering the issuer form. */
export function issuerFormValuesFromRow(
  row: IssuerSettings | null,
): IssuerFormValues {
  return {
    name: str(row?.name),
    legalName: str(row?.legalName),
    cnpj: str(row?.cnpj),
    address: str(row?.address),
    email: str(row?.email),
    bankBeneficiary: str(row?.bankBeneficiary),
    bankBeneficiaryAddress: str(row?.bankBeneficiaryAddress),
    bankIban: str(row?.bankIban ?? row?.bankAccountNumber),
    bankSwiftCode: str(row?.bankSwiftCode),
    bankName: str(row?.bankName),
    bankAddress: str(row?.bankAddress),
    bankDetails: str(row?.bankDetails),
    pixKey: str(row?.pixKey),
    defaultCurrency: row?.defaultCurrency ?? "GBP",
    defaultPdfFilenameTemplate: str(row?.defaultPdfFilenameTemplate),
  };
}

/** Raw submitted body to form values, for re-rendering after a 422. */
export function issuerFormValuesFromBody(body: FormBody): IssuerFormValues {
  return {
    name: formString(body.name),
    legalName: formString(body.legalName),
    cnpj: formString(body.cnpj),
    address: formString(body.address),
    email: formString(body.email),
    bankBeneficiary: formString(body.bankBeneficiary),
    bankBeneficiaryAddress: formString(body.bankBeneficiaryAddress),
    bankIban: formString(body.bankIban),
    bankSwiftCode: formString(body.bankSwiftCode),
    bankName: formString(body.bankName),
    bankAddress: formString(body.bankAddress),
    bankDetails: formString(body.bankDetails),
    pixKey: formString(body.pixKey),
    defaultCurrency: formString(body.defaultCurrency) || "GBP",
    defaultPdfFilenameTemplate: formString(body.defaultPdfFilenameTemplate),
  };
}
