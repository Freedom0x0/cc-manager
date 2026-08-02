# Typescript Coding Standards

Source: Peaks curated baseline; everything-claude-code reference: https://github.com/affaan-m/everything-claude-code
Scope: project-local standards for peaks-rd, peaks-qa, and peaks-code workflow preflight.
- Apply project-local conventions before generic typescript guidance.
- Keep public APIs typed or documented according to typescript ecosystem norms.
- Do not add new `any` types; use explicit domain types, generics, or `unknown` with narrowing.
- Prefer standard tooling and existing project scripts for formatting, linting, tests, and coverage.
- peaks-rd must check this file before planning code changes in typescript projects.

## Project-specific rules
- Type form values, table records, and API responses with named interfaces; do not rely on `Form.useForm()` inference for shared shapes.
