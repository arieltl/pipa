# PDF and Text Template Author Reference

HTML PDF templates and customer text generators use Liquid and the same
invoice document model. HTML output escapes values by default; text-generator
output preserves literal text. Filenames and recurring-item names continue to
use the smaller legacy interpolation syntax.

In the web editor, **Edit → Format document** formats the active supported text
file. It changes unsaved source only and can be undone. Invalid syntax leaves
the source untouched. HTML/Liquid formatting uses whitespace-sensitive rules;
check the PDF preview after formatting whitespace-dependent layouts. Saving
does not automatically format files.

Editable React PDF templates receive that same model as the `document` prop.
They use TSX and React PDF components instead of Liquid or browser HTML.

## Available values

```liquid
{{ issuer.name }}
{{ customer.name }}
{{ customer.code }}

{% if issuer.field.tax_id %}{{ issuer.field.tax_id.value }}{% endif %}
{% if customer.field.email %}{{ customer.field.email.value }}{% endif %}

{{ invoice.number }}
{{ invoice.dateIso }}
{{ invoice.dateDisplay }}
{{ invoice.dateYear }}
{{ invoice.dateMonth }}
{{ invoice.currency }}
{{ invoice.notes }}

{{ total.minor }}
{{ total.decimal }}
{{ total.display }}
```

`issuer.fields` and `customer.fields` contain all document-visible fields in
stable order. Fields are also grouped under `sections.identity`, `contact`,
`address`, `payment`, and `other`:

```liquid
{% for field in issuer.sections.payment %}
  <div><strong>{{ field.label }}</strong>: {{ field.value }}</div>
{% endfor %}

{% for item in items %}
  <div>{{ item.name }} — {{ item.valueDisplay }}</div>
{% endfor %}

{% if notaFiscal %}
  {{ notaFiscal.number }}
{% endif %}
```

Each item has `name`, `valueMinor`, and `valueDisplay`. When linked,
`notaFiscal` has `number`, `issueDateIso`, `issueDateDisplay`,
`verificationCode`, and `publicUrl`.

`records` contains supporting records with `typeKey`, `typeName`, `purpose`,
and `field`. Each field exposes `label` and `value`; field keys depend on the
record type you configured. For example, if a record defines a `reference` field:

```liquid
{% for record in records %}
  {% if record.field.reference %}
    <p>{{ record.typeName }}: {{ record.field.reference.value }}</p>
  {% endif %}
{% endfor %}
```

Optional fields may be absent from the document, including when a client has
never had that field or its value is empty. Guard optional fields and collections,
or supply a fallback with Liquid's `default` filter:

```liquid
{{ customer.field.tax_id.value | default: "Tax ID not supplied" }}
{{ issuer.name | default: "Your company" }}
```

Put `default` first when reading an optional value, before filters such as
`upcase`. Missing values, empty strings, and `false` use the fallback; numeric
zero does not. For boolean fields where `false` is meaningful, use
`default: "Not supplied", allow_false: true`. Unguarded unknown values still
produce an error, which helps catch misspelled field names.

In React PDF templates, use optional chaining and an explicit fallback, for
example `document.customer.field.tax_id?.value || "Tax ID not supplied"`.
These source-level defaults also apply to real invoice rendering. Preview
values only control the editor's test document.

**Preview data** in the bottom panel lets you choose company settings, a saved
client, samples, or empty values, and override individual values. Its available
field catalog includes configured document-visible custom fields, including
blank definitions that are omitted from the rendered document until populated.
Preview-only custom field definitions do not add fields to saved parties.
The preview choices reset on navigation or reload and are excluded from exports.
Dates and totals are derived from invoice fields and items; empty mode keeps
numeric totals at zero while clearing textual totals and collections.

Compatibility aliases (`client`, `invoice.date`, `invoice.total`, and the month
name fields) remain available for migrated text generators, but new templates
should use the names above.

## HTML template rules

- The entry document is `index.html`, containing `<!doctype html>`, `<html>`,
  `<head>`, and `<body>`.
- Stylesheets, images, and Liquid partials can live inside the same template
  package. The package cannot load remote or absolute resources, access the
  application filesystem, use scripts, or use SVG images.
- HTML templates support package-local `render` partials. `include` and
  `layout` remain unsupported. The multiline `{% liquid %}` tag is also
  unsupported; write individual Liquid tags instead. Text generators do not
  support partials.
- Unguarded unknown variables, unknown tags, and unknown filters fail when Pipa
  validates or renders the template. Use `if` or `default` for optional values.
- Saving an edit creates an immutable revision. Existing invoices keep their
  selected revision.
- The web editor's PDF preview uses unsaved source and the values selected in
  **Preview data**. It is a writing aid, not a saved revision or an invoice preview.
- The preview needs a configured Gotenberg service. Source editing and saving
  remain available when the service is unavailable.
- React PDF templates can be edited as TSX packages and used without Gotenberg.
- HTML templates remain editable when Gotenberg is absent, but cannot be
  selected or rendered until `GOTENBERG_URL` is configured.

Only fields whose “Hide from invoices” checkbox is clear enter this model. A
template still decides whether and where to display each available field.

## Import and export

Import a UTF-8 HTML/Liquid document or a React PDF TSX document, or a ZIP
containing the entry file and its supporting files. HTML packages use
`index.html`; React PDF packages use `index.tsx`. A ZIP may have one enclosing
folder around the package. The package entry identifies its rendering engine.
Use a `.tsx`, `.jsx`, `.ts`, or `.js` extension for a standalone React source
file; it becomes `index.tsx`. Other standalone text files become `index.html`.
A ZIP must have one entry, not both `index.html` and `index.tsx`.

Export downloads an HTML or TSX file when the entry document is the only file,
and a ZIP when there are additional files. The ZIP preserves the file structure,
including files the entry document does not currently reference. There is no
required manifest file. Exporting a saved template exports its saved revision;
save your edits first to include them.

Packages support UTF-8 text and PNG, JPEG, WebP, and GIF images. SVG images are
not supported. Limits are 64 files, 200 KB per text file, 8 MiB of decoded
package contents, and a 10 MiB ZIP upload. Paths must be unique and stay within
the package; absolute paths and ZIP symlinks are rejected. HTML/Liquid also
accepts data-image URLs for those raster formats. React PDF's `Image` component
supports local PNG and JPEG files; other package images can be stored but
cannot be rendered by that engine.

Link a stylesheet from `index.html` with a relative path such as
`styles/invoice.css`. Image paths are relative to the HTML or stylesheet that
uses them. For example, `url('../images/logo.png')` in `styles/invoice.css`
resolves to `images/logo.png` within the package. Moving a file requires updating
its references. Local CSS `@import` is supported with literal package-relative
paths; remote imports are rejected. CSS `image-set()` resources are not
supported.

## Package-local Liquid partials

Use a literal package path and pass the values the partial needs:

```liquid
{% render 'partials/customer.liquid', customer: customer %}
```

The partial can contain an HTML fragment, for example:

```liquid
<h2>{{ customer.name }}</h2>
```

`render` uses an isolated variable scope. Pass data explicitly; local variables
from the caller do not automatically become variables in the partial. Partial
paths cannot be computed from invoice data or refer outside the package.
Missing files and recursive partial dependencies are errors. Saving a revision
captures the partials with the entry document, stylesheets, and images.
Partial filenames end in `.liquid`, paths are relative to the package root,
and nesting is limited to 16 levels.
Asset paths written inside a partial resolve relative to the final
`index.html` document, where its HTML fragment is inserted.

## React PDF templates

Duplicate **Classic** in the template library to start with an editable version
of the built-in invoice layout. The original built-in and historical invoice
revisions remain unchanged. A new React PDF template can also start from a
minimal document.

The `index.tsx` entry exports a default function receiving `{ document }`:

```tsx
import { Document, Page, Text } from "@react-pdf/renderer";

export default function Template({ document }) {
  return (
    <Document>
      <Page size="A4">
        <Text>Invoice {document.invoice.number}</Text>
        <Text>{document.customer.name}</Text>
        <Text>Total: {document.total.display}</Text>
      </Page>
    </Document>
  );
}
```

Use React PDF components and `StyleSheet.create` for layout; browser HTML and
CSS stylesheets do not apply. Local component modules can share layout pieces
inside the same package. Keep optional data guarded, for example
`document.notaFiscal?.number`, and use `document.items.map(...)` to generate
item rows.

Supported imports are `react`, `@react-pdf/renderer`, and relative package files.
The available PDF components are `Document`, `Page`, `View`, `Text`, `Image`,
and `Link`, with `StyleSheet.create` for styles. Function components, fragments,
and local TS/TSX/JS/JSX modules are supported. Hooks, class components, custom
font registration, SVG components, dynamic imports, and callback props such as
`Text render={...}` are not supported. Use the built-in PDF fonts, such as
Helvetica, Times-Roman, or Courier.

Import a local PNG/JPEG to obtain its package path, for example
`import logo from "./images/logo.png"`, then use `<Image src={logo} />`.
Alternatively, use a package-root path directly: `<Image src="images/logo.png" />`.
Remote URLs, filesystem paths, and image request objects are rejected. A
`Link` may point to an HTTP(S) or mailto URL or a document anchor; this adds a
PDF hyperlink without fetching the destination.

Templates execute in a restricted JavaScript environment. They cannot import
arbitrary npm packages or access application files, environment variables,
network services, or other templates. Execution, memory, and document size are
bounded; errors appear in the preview and prevent saving an invalid template.
This environment supports document authoring rather than a full interactive
React application.

Both the editor preview and invoice rendering use the saved package contract.
Preview uses the current unsaved files with fictional data; saving captures all
files in a new revision. React PDF does not need Gotenberg.
