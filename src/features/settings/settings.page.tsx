import { PageHeader } from "../../web/components/page-header.tsx";
import { IssuerForm, type IssuerFormValues } from "./components/issuer-form.tsx";
import type { PdfTemplate } from "../../db/schema.ts";

export function IssuerSettingsPage({ values, pdfTemplates }: { values: IssuerFormValues; pdfTemplates: PdfTemplate[] }) {
  return (
    <div>
      <PageHeader
        title="Issuer settings"
        description="Your details as they appear on every invoice. Used as defaults for new clients and PDFs."
      />
      <IssuerForm values={values} pdfTemplates={pdfTemplates} />
    </div>
  );
}
