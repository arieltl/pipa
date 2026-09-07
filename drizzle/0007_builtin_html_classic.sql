INSERT INTO `pdf_templates` (`stable_key`,`name`,`engine`,`source_kind`,`created_at`,`updated_at`)
VALUES ('builtin-html-classic','Classic HTML','gotenberg-html','builtin','2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `pdf_template_revisions` (`template_id`,`revision`,`renderer_key`,`source`,`configuration_json`,`content_sha256`,`created_at`)
SELECT `id`,1,NULL,'<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Invoice {{ invoice.number }}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #1f2937; font: 13px/1.45 Arial, sans-serif; }
    header { display: flex; justify-content: space-between; gap: 32px; margin-bottom: 36px; }
    h1 { margin: 0; font-size: 28px; letter-spacing: .04em; }
    h2 { margin: 0 0 6px; font-size: 16px; }
    .muted { color: #6b7280; }
    .right { text-align: right; }
    .party { margin-bottom: 28px; }
    .label { color: #9ca3af; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .field { white-space: pre-line; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border-bottom: 1px solid #d1d5db; padding: 12px; text-align: left; }
    th { background: #f9fafb; color: #6b7280; font-size: 10px; text-transform: uppercase; }
    th:last-child, td:last-child { text-align: right; }
    tfoot td { background: #eff6ff; color: #1e3a8a; font-size: 16px; font-weight: 700; }
    .section { margin-top: 28px; page-break-inside: avoid; }
  </style>
</head>
<body>
  <header>
    <div>
      <h2>{{ issuer.name }}</h2>
      {% for field in issuer.sections.identity %}<div class="field">{{ field.label }}: {{ field.value }}</div>{% endfor %}
      {% for field in issuer.sections.contact %}<div class="field muted">{{ field.value }}</div>{% endfor %}
      {% for field in issuer.sections.address %}<div class="field">{{ field.value }}</div>{% endfor %}
    </div>
    <div class="right">
      <h1>INVOICE</h1>
      <div>#{{ invoice.number }}</div>
      <div class="muted">{{ invoice.dateDisplay }}</div>
    </div>
  </header>

  <section class="party">
    <div class="label">Billed to</div>
    <h2>{{ customer.name }}</h2>
    {% for field in customer.fields %}<div class="field">{{ field.label }}: {{ field.value }}</div>{% endfor %}
  </section>

  <table>
    <thead><tr><th>Description</th><th>Amount</th></tr></thead>
    <tbody>
      {% for item in items %}
      <tr><td>{{ item.name }}</td><td>{{ item.valueDisplay }}</td></tr>
      {% endfor %}
    </tbody>
    <tfoot><tr><td>Total ({{ invoice.currency }})</td><td>{{ total.display }}</td></tr></tfoot>
  </table>

  {% if issuer.sections.payment.size > 0 %}
  <section class="section">
    <div class="label">Payment info</div>
    {% for field in issuer.sections.payment %}<div class="field"><strong>{{ field.label }}:</strong> {{ field.value }}</div>{% endfor %}
  </section>
  {% endif %}

  {% if invoice.notes %}
  <section class="section"><div class="label">Notes</div><div class="field">{{ invoice.notes }}</div></section>
  {% endif %}
</body>
</html>','{}','9019a479bdf5b0b5af5eb5c145b571d42a3aa575b5913765c8503a74378b3ff4','2026-09-01T00:00:00.000Z'
FROM `pdf_templates` WHERE `stable_key`='builtin-html-classic';
--> statement-breakpoint
UPDATE `pdf_templates`
SET `current_revision_id`=(SELECT `id` FROM `pdf_template_revisions` WHERE `template_id`=`pdf_templates`.`id` AND `revision`=1)
WHERE `stable_key`='builtin-html-classic';
