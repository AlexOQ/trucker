import js from '@eslint/js';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        setTimeout: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        Promise: 'readonly',
      },
    },
    plugins: {
      'no-unsanitized': noUnsanitized,
    },
    rules: {
      // Warn on innerHTML usage to prevent XSS vulnerabilities
      'no-unsanitized/property': 'warn',
    },
  },
];
