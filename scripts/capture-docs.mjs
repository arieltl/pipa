/** Capture the UI gallery from an isolated seed-demo.ts instance.
 * PLAYWRIGHT_MODULE must point to an installed Playwright module outside the app.
 * Usage is documented in docs/demo.md. Never point this at personal data.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to playwright/index.mjs');
const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
const base = process.env.DEMO_URL ?? 'http://127.0.0.1:3913';
const output = resolve(process.env.SCREENSHOT_DIR ?? 'docs/images');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir(output, { recursive: true });
const ready = () => page.waitForFunction(() => document.querySelector('[data-template-preview-status]')?.dataset.state === 'ready');
const dataReady = () => page.waitForFunction(() => document.querySelector('[data-preview-data-status]')?.dataset.state === 'ready');
async function capture(name) {
  await page.mouse.move(1438, 998);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  await page.screenshot({ path: resolve(output, name), animations: 'disabled' });
  console.log(name);
}
async function sourceData() {
  await page.locator('[data-tool-tab=preview-data]').click();
  await dataReady();
  await page.locator('.template-preview-source-settings > summary').click();
  await page.locator('[data-preview-source=customerSource]').selectOption('client');
  await page.locator('[data-preview-client]').selectOption('1');
  await dataReady();
  await page.locator('[data-preview-group-filter]').selectOption('invoice');
  await page.locator('[data-preview-field="invoice.number"] input').fill('NSTAR-202609-01');
  await page.locator('[data-preview-field="invoice.dateIso"] input').fill('2026-09-01');
  await page.locator('[data-preview-group-filter]').selectOption('items');
  await page.locator('[data-preview-item-name]').first().fill('Platform engineering — September 2026');
  await page.locator('[data-preview-item-amount]').first().fill('6400.00');
  await page.locator('[data-preview-add-item]').click();
  await page.locator('[data-preview-item-name]').nth(1).fill('Architecture review');
  await page.locator('[data-preview-item-amount]').nth(1).fill('1200.00');
  await ready();
}
try {
  await page.goto(base);
  await page.getByText('Northstar Analytics — DEMO', { exact: false }).first().waitFor();
  await capture('overview.png');
  await page.goto(`${base}/invoices/2`);
  await capture('invoice-workspace.png');
  await page.getByRole('button', { name: 'Preview PDF', exact: true }).click();
  await page.locator('.pdfViewer .page[data-loaded="true"]').waitFor();
  await capture('invoice-preview.png');
  await page.goto(`${base}/invoices/2/edit`);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Preview changes' && !button.disabled));
  await capture('invoice-editor.png');
  await page.goto(`${base}/clients/1/edit?section=details`);
  await page.getByRole('button', { name: '+ Add field', exact: true }).click();
  await capture('client-field-picker.png');
  await page.goto(`${base}/settings/pdf-templates`);
  // Fail closed if this is not the intended fictional fixture.
  await page.getByText('Studio invoice — React PDF', { exact: true }).waitFor();
  const reactHref = await page.locator('a.template-card').filter({ hasText: 'Studio invoice — React PDF' }).getAttribute('href');
  const htmlHref = await page.locator('a.template-card').filter({ hasText: 'Studio invoice — HTML' }).getAttribute('href');
  await capture('template-library.png');
  for (const href of [reactHref, htmlHref]) {
    const id = href.split('/').at(-1);
    await page.evaluate(id => localStorage.setItem(`pipa-template-workspace:${id}`, JSON.stringify({ filesWidth: 200, previewWidth: 540, toolsHeight: 340, filesOpen: true, toolsOpen: true, previewOpen: true })), id);
  }
  await page.goto(new URL(reactHref, base).href);
  await ready();
  await sourceData();
  const divider = await page.locator('[data-resizer=tools]').boundingBox();
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
  await page.mouse.down();
  await page.mouse.move(divider.x + divider.width / 2, divider.y - 190, { steps: 8 });
  await page.mouse.up();
  await page.locator('.template-tool-content').evaluate(element => element.scrollTop = 0);
  await page.locator('[data-tool-tab=preview-data]').focus();
  await capture('template-preview-data.png');
  await page.mouse.move(divider.x + divider.width / 2, divider.y - 190);
  await page.mouse.down();
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.locator('[data-tool-tab=used]').click();
  await capture('template-react-editor.png');
  await page.goto(new URL(htmlHref, base).href);
  await ready();
  await sourceData();
  await page.locator('[data-tool-tab=used]').click();
  await capture('template-html-editor.png');
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
