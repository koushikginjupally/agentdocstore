// ESLint flat configuration.
//
// Scope: correctness rules only. Formatting is Prettier's job, and
// `eslint-config-prettier` is applied last so the two can never disagree.
//
// The base is typescript-eslint's non-type-checked `recommended`, plus a
// hand-picked set of type-aware rules. That split is deliberate: the full
// `recommendedTypeChecked` preset also turns on the `no-unsafe-*` family, which
// fires constantly on this codebase by design — provider options, JSON request
// bodies and MCP tool arguments all arrive as `unknown` and are narrowed by
// validators, so the "unsafe" reading is the correct one. The rules enabled
// below are the ones that find real defects instead: a promise nobody awaits,
// an `await` on a non-promise, an async callback passed where a void return was
// expected (which is how an unhandled rejection hides in an event listener).
//
// Type information comes from `tsconfig.lint.json` rather than the package
// tsconfigs, because those exclude `*.test.ts` from the build and a type-aware
// rule cannot lint a file that belongs to no project. See that file's comment.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      'packages/cli/bundle/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.log',
      '.kiro/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---- TypeScript sources: type-aware linting ----
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.lint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Async correctness — the reason type information is wired up at all.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],

      // An unused parameter is often a signature that drifted. Allow the
      // `_`-prefix escape hatch for interface conformance.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // CONTRIBUTING.md: "No `any` without a comment explaining why."
      '@typescript-eslint/no-explicit-any': 'warn',

      // `==` is never what this codebase means.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off', // the CLI is a console program
    },
  },

  // ---- Node-side code ----
  {
    files: ['packages/{core,provider-fs,provider-memory,provider-tests,server,mcp,cli}/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // ---- Browser code ----
  {
    files: ['packages/web/src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },

  // ---- Tests: node globals plus jsdom-ish freedom ----
  {
    files: ['**/*.test.ts', 'packages/provider-tests/src/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // Tests deliberately poke at wrong shapes to prove they are rejected.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // ---- Plain JS / build scripts: no type information available ----
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node },
  },

  // Must stay last: turns off every rule Prettier owns.
  prettierConfig,
);
