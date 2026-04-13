# @repo/eslint-config

Shared ESLint configurations for workspace apps/packages.

## Exports

- `@repo/eslint-config/base`
- `@repo/eslint-config/next-js`
- `@repo/eslint-config/react-internal`

## Usage

In `eslint.config.mjs`:

```js
import { baseConfig } from "@repo/eslint-config/base";

export default [...baseConfig];
```
