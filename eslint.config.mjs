import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    "**/.next/**",
    "**/dist/**",
    "**/out/**",
    "**/build/**",
    "next-env.d.ts",
    ".claude/**",
    // The Expo app is a separate program with its own tsconfig, lint config and JSX runtime.
    "mobile/**",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      // A leading underscore already means "named for the reader, not for the code" throughout
      // this repo — `_request` and `_event` on handlers that must match a signature, `_unused` on
      // an Array.from callback that only wants the index. Those happen to sit in argument
      // positions the rule skips by default; a binding does not, so the same convention was an
      // error in one place and fine in the others. This makes it mean one thing everywhere.
      //
      // ignoreRestSiblings covers the idiom that has no name to underscore: destructuring a key
      // out purely to get an object without it, `const { dropped, ...rest } = value`.
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
    },
  },
]);

export default eslintConfig;
