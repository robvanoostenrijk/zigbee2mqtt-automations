// eslint.config.js

// This ESLint configuration is designed for a TypeScript project.

const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const pluginImport = require('eslint-plugin-import');
const pluginN = require('eslint-plugin-n');
const pluginPromise = require('eslint-plugin-promise');
const pluginJsdoc = require('eslint-plugin-jsdoc');
const pluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = [
  {
    name: 'Global Ignores',
    ignores: ['dist', 'node_modules', 'coverage', 'build', 'eslint.config.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  // Comment the previous line and uncomment the following line if you want to use strict with type checking
  // ...tseslint.configs.strictTypeChecked,
  pluginImport.flatConfigs.recommended,
  pluginN.configs['flat/recommended-script'],
  pluginPromise.configs['flat/recommended'],
  pluginJsdoc.configs['flat/recommended'],
  pluginPrettierRecommended, // Prettier plugin must be the last plugin in the list
  {
    name: 'Global Configuration',
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 'latest',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error', // Report unused eslint-disable directives
      reportUnusedInlineConfigs: 'error', // Report unused eslint-disable-line directives
    },
    rules: {
      'no-console': 'warn', // Warn on console usage
      'spaced-comment': ['error', 'always'], // Require space after comment markers
      'no-unused-vars': 'warn', // Use the base rule for unused variables
      'import/order': ['warn', { 'newlines-between': 'always' }],
      'import/no-unresolved': 'off', // Too many false errors with named exports
      'import/named': 'off', // Too many false errors with named exports
      'n/prefer-node-protocol': 'error', // Prefer using 'node:' protocol for built-in modules
      'n/no-extraneous-import': 'off', // Allow imports from node_modules
      'n/no-unpublished-import': 'off', // Allow imports from unpublished packages
      'promise/always-return': 'warn', // Ensure promises always return a value
      'promise/catch-or-return': 'warn', // Ensure promises are either caught or returned
      'promise/no-nesting': 'warn', // Avoid nesting promises
      'jsdoc/tag-lines': ['error', 'any', { startLines: 1, endLines: 0 }], // Require a blank line before JSDoc comments
      'jsdoc/check-tag-names': ['warn', { definedTags: ['created', 'contributor', 'remarks'] }], // Allow custom tags
      'jsdoc/no-undefined-types': 'off',
      'prettier/prettier': 'warn', // Use Prettier for formatting
    },
  },
  {
    name: 'JavaScript Source Files',
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    name: 'TypeScript Source Files',
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/**/*.spec.ts'], // Ignore test files
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        sourceType: 'module',
        ecmaVersion: 'latest',
      },
    },
    rules: {
      // Override/add rules specific to typescript files here
      'no-unused-vars': 'off', // Disable base rule for unused variables in test files
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_', // Ignore unused variables starting with _
          argsIgnorePattern: '^_', // Ignore unused arguments starting with _
          caughtErrorsIgnorePattern: '^_', // Ignore unused caught errors starting with _
        },
      ],
    },
  },
];
