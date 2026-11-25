// Backend ESLint flat config (INV-BACKEND-LINT-PRETTIER-TOOLING).
// Mirrors the frontend rules minus the react plugins and minus
// max-lines (the file-size guard owns size), plus the two corrections
// the L1 census proved necessary: globals.node (scripts use
// process/__dirname/console) and a scripts override switching off
// no-require-imports for .cjs/.mjs/.js (legitimate require() in
// scripts). Must stay .mjs: backend is CommonJS (no "type": "module"),
// so a .js config cannot use import syntax.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'scripts/**/*.{cjs,mjs,js,ts}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
      parserOptions: { projectService: false },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'prefer-const': 'error',
      'no-duplicate-imports': 'error',
      'no-empty': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['scripts/**/*.{cjs,mjs,js}'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
