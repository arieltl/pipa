@AGENTS.md

## Claude Code Notes

- This file intentionally imports `AGENTS.md` to avoid duplicated project instructions.
- Keep project memory concise. Add durable corrections here only when they are project-specific and should apply to every future Claude Code session.
- Prefer file pointers over inline explanations when the detail already lives elsewhere.
- Do not add generic framework best practices Claude can infer from the codebase or docs.
- Do not wrap normal markdown in pseudo-XML; use plain markdown unless boundaries are genuinely ambiguous.
- Add recurring mistakes and non-obvious project gotchas here, then periodically prune stale guidance.
- For task-specific or path-specific guidance, prefer a scoped `.claude/rules/` file instead of growing this file.
- Use `/memory` to verify loaded instructions if behavior seems inconsistent.

