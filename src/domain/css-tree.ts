// Use the CommonJS entry so Bun can statically bundle CSS grammar JSON.
// The ESM entry loads it via createRequire(import.meta.url), which fails in
// standalone executables outside the source checkout.
const csstree: typeof import("css-tree") = require("css-tree");
export default csstree;
