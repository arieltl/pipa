import { expect, test } from "bun:test";
import {
  reactPackageFromSource,
  validateTemplatePackage,
} from "../domain/template-package.ts";
import { renderReactTemplatePackage } from "./react-template-renderer.tsx";
import { sampleInvoiceDocument } from "./sample-document.ts";

const imports = 'import { Document, Page, Text } from "@react-pdf/renderer";';

test("React sandbox accepts ordinary text containing host API names", async () => {
  const source = `${imports}
    // Import documentation: import fs from 'node:fs' is unavailable.
    export default function Template() {
      return <Document><Page><Text>Bun process fetch import require</Text></Page></Document>;
    }`;
  const pdf = await renderReactTemplatePackage(
    reactPackageFromSource(source),
    sampleInvoiceDocument,
  );
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
});

test("React sandbox supports standard ESM aliases and reexports for local components", async () => {
  const pkg = validateTemplatePackage({
    version: 1,
    entry: "index.tsx",
    files: [
      {
        path: "index.tsx",
        encoding: "utf8",
        content: `${imports}
      import { Heading as InvoiceHeading } from './components';
      export default function Template({ document }) {
        return <Document><Page><InvoiceHeading label={document.invoice.number} /></Page></Document>;
      }`,
      },
      {
        path: "components/index.ts",
        encoding: "utf8",
        content: 'export { default as Heading } from "./Heading";',
      },
      {
        path: "components/Heading.tsx",
        encoding: "utf8",
        content:
          'import { Text as PDFText } from "@react-pdf/renderer"; export default function Heading({ label }) { return <PDFText>{label}</PDFText>; }',
      },
    ],
  });
  const pdf = await renderReactTemplatePackage(pkg, sampleInvoiceDocument);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
});

test("React sandbox rejects forged prototype primitives and resource objects", async () => {
  for (const expression of [
    "({type: 'constructor', props: {}, children: []})",
    "({type: '__proto__', props: {}, children: []})",
    "({type: 'Document', props: {}, children: [{type: 'Page', props: {}, children: [{type: 'Image', props: {src: {uri: 'http://127.0.0.1/private'}}, children: []}]}]})",
  ]) {
    const pkg = reactPackageFromSource(
      `export default function Template() { return ${expression}; }`,
    );
    await expect(
      renderReactTemplatePackage(pkg, sampleInvoiceDocument),
    ).rejects.toThrow();
  }
});

test("React sandbox interrupts unbounded execution and remains usable", async () => {
  await expect(
    renderReactTemplatePackage(
      reactPackageFromSource(
        "export default function Template(){while(true){}}",
      ),
      sampleInvoiceDocument,
    ),
  ).rejects.toThrow(/time limit/);
  await expect(
    renderReactTemplatePackage(
      reactPackageFromSource(
        'export default function Template(){const values=[]; for(;;) values.push(new Array(10000).fill("x"));}',
      ),
      sampleInvoiceDocument,
    ),
  ).rejects.toThrow();
  const source = `${imports} export default function Template(){return <Document><Page><Text>{typeof process}:{typeof Bun}:{typeof fetch}</Text></Page></Document>}`;
  expect(
    (
      await renderReactTemplatePackage(
        reactPackageFromSource(source),
        sampleInvoiceDocument,
      )
    )
      .subarray(0, 5)
      .toString(),
  ).toBe("%PDF-");
});

test("React sandbox rejects remote images, invalid page sizes, and callback props", async () => {
  for (const source of [
    'import {Document,Page,Image} from "@react-pdf/renderer"; export default ()=> <Document><Page><Image src="http://127.0.0.1/private" /></Page></Document>',
    `${imports} export default ()=> <Document><Page size={[100, 0.001]}><Text>Small</Text></Page></Document>`,
    `${imports} export default ()=> <Document><Page><Text render={()=> "Hidden callback"} /></Page></Document>`,
    `${imports} export default ()=> <Document><Page><Text style={{fontSize: 1e100}}>Huge</Text></Page></Document>`,
  ])
    await expect(
      renderReactTemplatePackage(
        reactPackageFromSource(source),
        sampleInvoiceDocument,
      ),
    ).rejects.toThrow();
});

test("React local image imports and JSX components render without host resource access", async () => {
  const pkg = validateTemplatePackage({
    version: 1,
    entry: "index.tsx",
    files: [
      {
        path: "index.tsx",
        encoding: "utf8",
        content:
          'import {Document,Page,Image} from "@react-pdf/renderer"; import logo from "./images/logo.png"; export default ()=> <Document><Page><Image src={logo} style={{width:24,height:24}} /></Page></Document>',
      },
      {
        path: "images/logo.png",
        encoding: "base64",
        content:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaPgPAAIDAYAkYfWXAAAAAElFTkSuQmCC",
      },
    ],
  });
  expect(
    (await renderReactTemplatePackage(pkg, sampleInvoiceDocument))
      .subarray(0, 5)
      .toString(),
  ).toBe("%PDF-");
});
