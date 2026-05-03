import js from '@eslint/js';
import globals from 'globals';
import html from 'eslint-plugin-html';

const sharedRules = {
  'no-unused-vars': [
    'error',
    { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'always'],
  curly: ['error', 'all'],
  'no-multiple-empty-lines': ['error', { max: 2 }],
  'no-trailing-spaces': 'error',
  semi: 'error',
  quotes: ['error', 'single', { avoidEscape: true }],
  'no-shadow': 'error',
  'no-shadow-restricted-names': 'error',
};

export default [
  {
    ignores: [
      'node_modules/',
      '**/node_modules/',
      'server/.adminjs/',
      'server/.adminjs/**',
      'server/game/admin.js',
    ],
  },

  // Server — Node.js ESM
  {
    files: ['server/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...sharedRules,
      'no-console': 'off',
    },
  },

  // Tests — vitest
  {
    files: ['tests/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.vitest },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...sharedRules,
    },
  },

  // Client JS — browser ESM
  {
    files: ['client/js/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...sharedRules,
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // Client HTML — inline scripts
  {
    files: ['client/**/*.html'],
    plugins: { html },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...sharedRules,
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
];
