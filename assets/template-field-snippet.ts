function segments(path: string) {
  return path.split(".");
}

export function liquidPreviewFieldSnippet(path: string) {
  const expression = segments(path).map((part, index) =>
    /^\d+$/.test(part) ? `[${part}]` : index ? `.${part}` : part,
  ).join("");
  const optional = path.includes(".field.") || path.startsWith("records.");
  return `{{ ${expression}${optional ? ' | default: ""' : ""} }}`;
}

export function reactPreviewFieldSnippet(path: string) {
  const optional = path.includes(".field.") || path.startsWith("records.");
  let expression = "document";
  for (const part of segments(path)) {
    if (/^\d+$/.test(part)) expression += optional ? `?.[${part}]` : `[${part}]`;
    else expression += optional ? `?.${part}` : `.${part}`;
  }
  return `{${expression}${optional ? ' ?? ""' : ""}}`;
}

export function previewFieldSnippet(path: string, engine: "gotenberg-html" | "react-pdf") {
  return engine === "react-pdf" ? reactPreviewFieldSnippet(path) : liquidPreviewFieldSnippet(path);
}
