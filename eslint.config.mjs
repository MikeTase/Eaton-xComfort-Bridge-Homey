import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Build output, deps, generated JS and the JS test harness are not linted.
    ignores: ['.homeybuild/**', 'node_modules/**', 'test/**', '**/*.d.ts', '**/*.js', '**/*.mjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // Discourage `any` but don't fail the build on it.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow intentionally-unused args/vars when prefixed with `_`.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The protocol layer logs heavily via an injected logger; console is fine.
      'no-console': 'off',
      // `module.exports = class ...` is the Homey driver/device convention.
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
);
