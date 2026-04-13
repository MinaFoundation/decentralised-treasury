# @repo/typescript-config

Shared TypeScript config presets for the monorepo.

## Presets

- `@repo/typescript-config/base.json`
  - strict baseline options for Node/TS projects
- `@repo/typescript-config/nextjs.json`
  - Next.js-friendly options (`jsx: preserve`, bundler module resolution)
- `@repo/typescript-config/react-library.json`
  - React library preset (`jsx: react-jsx`)

## Usage

In a package `tsconfig.json`:

```json
{
  "extends": "@repo/typescript-config/nextjs.json"
}
```
