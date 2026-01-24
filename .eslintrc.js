module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  extends: [
    'eslint:recommended',
    'prettier', // Disables ESLint rules that conflict with Prettier
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['no-unsanitized'],
  rules: {
    // Warn on innerHTML usage to prevent XSS vulnerabilities
    'no-unsanitized/property': 'warn',
  },
}
