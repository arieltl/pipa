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

Compatibility aliases (`client`, `invoice.date`, `invoice.total`, and the month
name fields) remain available for migrated text generators, but new templates
should use the names above.

## HTML template rules

- Supply one complete document with `<!doctype html>`, `<html>`, `<head>`, and
  `<body>`.
- Keep CSS self-contained in the document. Remote assets and filesystem
  includes are not supported.
- `include`, `render`, and `layout` tags are rejected.
- Unknown variables, tags, and filters fail validation rather than rendering
  silently.
- Saving an edit creates an immutable revision. Existing invoices keep their
  selected revision.
- React PDF templates are code-defined and can be used without Gotenberg.
- HTML templates remain editable when Gotenberg is absent, but cannot be
  selected or rendered until `GOTENBERG_URL` is configured.

Only fields whose “Hide from invoices” checkbox is clear enter this model. A
template still decides whether and where to display each available field.
