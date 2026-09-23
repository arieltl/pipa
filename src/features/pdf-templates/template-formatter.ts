import prettier from "prettier/standalone";
import * as babelPlugin from "prettier/plugins/babel";
import * as estreePlugin from "prettier/plugins/estree";
import * as postcssPlugin from "prettier/plugins/postcss";
import * as typescriptPlugin from "prettier/plugins/typescript";
import liquidPlugin from "@shopify/prettier-plugin-liquid/standalone";
import { getFormatterForPath, type TemplateFormatter } from "./template-formatter-support.ts";

export { getFormatterForPath, type TemplateFormatter } from "./template-formatter-support.ts";

export interface FormatTemplateSourceInput {
  path: string;
  source: string;
  cursorOffset: number;
}

export interface FormattedTemplateSource {
  source: string;
  cursorOffset: number;
}

const commonOptions = {
  tabWidth: 2,
  printWidth: 100,
  useTabs: false,
} as const;

/**
 * Formats one editor buffer without changing the input object. The cursor is
 * translated by Prettier so the caller can retain the user's insertion point.
 */
export async function formatTemplateSource(
  input: FormatTemplateSourceInput,
): Promise<FormattedTemplateSource> {
  const formatter = getFormatterForPath(input.path);
  if (!formatter) {
    throw new Error(`Formatting is not available for “${input.path}”.`);
  }
  if (!Number.isInteger(input.cursorOffset) || input.cursorOffset < 0 || input.cursorOffset > input.source.length) {
    throw new RangeError("The cursor position is outside the template source.");
  }

  const options = formatterOptions(formatter, input.cursorOffset);
  const result = await prettier.formatWithCursor(input.source, options);
  return { source: result.formatted, cursorOffset: result.cursorOffset };
}

function formatterOptions(formatter: TemplateFormatter, cursorOffset: number) {
  switch (formatter) {
    case "liquid-html":
      return {
        ...commonOptions,
        parser: "liquid-html",
        cursorOffset,
        plugins: [liquidPlugin],
        // Strict capture handling preserves significant Liquid whitespace.
        captureWhitespaceSensitivity: "strict" as const,
        htmlWhitespaceSensitivity: "css" as const,
      };
    case "css":
      return { ...commonOptions, parser: "css", cursorOffset, plugins: [postcssPlugin] };
    case "javascript":
      return {
        ...commonOptions,
        parser: "babel",
        cursorOffset,
        plugins: [babelPlugin, estreePlugin],
      };
    case "typescript":
      return {
        ...commonOptions,
        parser: "typescript",
        cursorOffset,
        plugins: [typescriptPlugin, estreePlugin],
      };
  }
}
