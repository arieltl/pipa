# PDF and Text Template Author Reference

HTML PDF templates and customer text generators use Liquid and the same
invoice document model. HTML output escapes values by default; text-generator
output preserves literal text. Filenames and recurring-item names continue to
use the smaller legacy interpolation syntax.

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

The fictional sample preview may have no supporting records or custom party
fields. Guard optional fields and collections rather than assuming they exist.

Compatibility aliases (`client`, `invoice.date`, `invoice.total`, and the month
name fields) remain available for migrated text generators, but new templates
should use the names above.

## HTML template rules

- The entry document is `index.html`, containing `<!doctype html>`, `<html>`,
  `<head>`, and `<body>`.
- Stylesheets, images, and Liquid partials can live inside the same template
  package. Remote assets and application filesystem access are not supported.
- HTML templates support package-local `render` partials. `include` and
  `layout` remain unsupported. Text generators do not support partials.
- Unknown variables, tags, and filters fail validation rather than rendering
  silently.
- Saving an edit creates an immutable revision. Existing invoices keep their
  selected revision.
- The web editor's PDF preview uses fictional sample invoice data and unsaved
  source. It is a writing aid, not a saved revision or an invoice preview.
- The preview needs a configured Gotenberg service. Source editing and saving
  remain available when the service is unavailable.
- React PDF templates are code-defined and can be used without Gotenberg.
- HTML templates remain editable when Gotenberg is absent, but cannot be
  selected or rendered until `GOTENBERG_URL` is configured.

Only fields whose “Hide from invoices” checkbox is clear enter this model. A
template still decides whether and where to display each available field.

## Import and export

Import a UTF-8 text file containing a complete HTML/Liquid document, or a ZIP
containing `index.html` and its supporting files. A standalone document becomes
`index.html` internally, regardless of its original extension. A ZIP may have
one enclosing folder around the package.

Export downloads an HTML file when the entry document is the only file, and a
ZIP when there are additional files. The ZIP preserves the file structure,
including files the entry document does not currently reference. There is no
required manifest file. Exporting a saved template exports its saved revision;
save your edits first to include them.

Packages support UTF-8 text and PNG, JPEG, WebP, and GIF images. SVG images are
not supported. Limits are 64 files, 200 KB per text file, 8 MiB of decoded
package contents, and a 10 MiB ZIP upload. Paths must be unique and stay within
the package; absolute paths and ZIP symlinks are rejected.

Link a stylesheet from `index.html` with a relative path such as
`styles/invoice.css`. Image paths are relative to the HTML or stylesheet that
uses them. For example, `url('../images/logo.png')` in `styles/invoice.css`
resolves to `images/logo.png` within the package. Moving a file requires updating
its references. Local CSS `@import` is supported with literal package-relative
paths; remote imports are rejected.

## Package-local partials

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
