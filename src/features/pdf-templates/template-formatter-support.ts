export type TemplateFormatter = "liquid-html" | "css" | "javascript" | "typescript";

/** Returns the formatter supported by a template file path, if any. */
export function getFormatterForPath(path: string): TemplateFormatter | undefined {
  const lowerPath = path.toLowerCase();
  if (/\.(html?|liquid)$/.test(lowerPath)) return "liquid-html";
  if (lowerPath.endsWith(".css")) return "css";
  if (/\.(?:js|jsx)$/.test(lowerPath)) return "javascript";
  if (/\.(?:ts|tsx)$/.test(lowerPath)) return "typescript";
  return undefined;
}
