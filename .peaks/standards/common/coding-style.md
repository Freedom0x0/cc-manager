# Common Coding Standards

Source: Peaks curated baseline; everything-claude-code reference: https://github.com/affaan-m/everything-claude-code
Scope: project-local standards for peaks-rd, peaks-qa, and peaks-code workflow preflight.
- Prefer simple, readable code over clever abstractions.
- Keep functions focused and files cohesive.
- Use immutable updates unless a language-specific convention explicitly favors mutation.
- Validate user input, external data, file paths, and configuration at system boundaries.
- Preserve existing project conventions when they are stricter than this baseline.

## Project-specific rules
- Use existing antd v6 components (`Button`, `Form`, `Table`, `Modal`, `Select`). Never mix antd v3/v4/v5 APIs.
- Customize antd via `theme.token` / `ConfigProvider` / `className` / `styles`. Do NOT apply TailwindCSS utility classes directly to antd components.
- Inline styles dominant (132+ occurrences) — match existing styling for new code in same modules
