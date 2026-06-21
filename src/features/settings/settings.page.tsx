import { PageHeader } from "../../web/components/page-header.tsx";
import { IssuerForm, type IssuerFormValues } from "./components/issuer-form.tsx";

export function IssuerSettingsPage({ values }: { values: IssuerFormValues }) {
  return (
    <div>
      <PageHeader
        title="Issuer settings"
        description="Your details as they appear on every invoice. Used as defaults for new clients and PDFs."
      />
      <div class="app-card lift-enter rounded-lg p-6">
        <IssuerForm values={values} />
      </div>
    </div>
  );
}
