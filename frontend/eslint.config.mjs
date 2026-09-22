import path from 'node:path';
import { fileURLToPath } from 'node:url';

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsdoc from 'eslint-plugin-jsdoc';
import importX from 'eslint-plugin-import-x';

// Resolve relative to this config file, not process.cwd() -- lint-staged
// invokes eslint from the repo root with absolute file paths, and a
// cwd-relative tsconfig lookup silently falls back to the root tsconfig
// (no `@/*` aliases), which makes import-x/order group `@/...` imports as
// unresolved and sort them differently than a `cd frontend && eslint` run.
const dirname = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  jsdoc.configs['flat/recommended-typescript'],
  {
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'import-x': importX,
    },
    rules: {
      // TypeScript
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // React
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react/no-danger': 'warn',

      // Console
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Imports
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-duplicates': 'error',

      // JSDoc — require on exported functions only
      'jsdoc/require-jsdoc': [
        'warn',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
            MethodDefinition: false,
          },
        },
      ],
      'jsdoc/require-description': 'off',
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-returns-type': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-param-description': 'off',
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          project: path.join(dirname, 'tsconfig.json'),
        },
      },
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '*.config.*'],
  },
);
