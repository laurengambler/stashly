// eslint.config.js
// Deliberately small. The point is not style — it is the two classes of
// mistake that have actually shipped from this codebase:
//
//   1. A swallowed error. `.catch(() => null)` on the photo picker turned
//      a missing Info.plist key into a dead button with no message and no
//      analytics event. That pattern is now an error, not a preference.
//   2. A console.log carrying card data. Four of them reached production
//      printing card_number and pin in plaintext.
//
// Formatting is left alone: there is no Prettier here and adding one would
// bury real findings under a reformat of every file.

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist/**', 'ios/**', 'node_modules/**', 'tools/**'] },

  js.configs.recommended,

  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // eslint-plugin-react-hooks v7 ships the React Compiler rules, which
      // flag two long-standing patterns here: setState called synchronously
      // inside an effect, and reading ref.current during render (8 sites
      // across App, BiometricLock, BirthdaySection, SwipeRow, AddCardScreen
      // and CardDetailScreen).
      //
      // They are worth fixing — reading a ref during render genuinely can
      // render stale, which is the kind of bug that shows up as "the swipe
      // row animated wrong once". But every one of them is in code that
      // works today, and fixing them properly means restructuring
      // components, not a one-line change. Doing that in the same pass that
      // introduces the linter would put a risky refactor into a release
      // that is otherwise a bug fix.
      //
      // So: warn, not error. They stay visible on every run and in CI
      // output without blocking it. Promote to 'error' once the backlog is
      // worked.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',

      // An empty catch is how a failure becomes invisible.
      'no-empty': ['error', { allowEmptyCatch: false }],

      // The specific shapes that have bitten us. A catch handler that
      // returns a constant discards WHY something failed, which is the
      // only thing that makes it fixable.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type='ObjectExpression']",
          message:
            'This catch discards the error. Inspect it and surface something to the user, or log it — see describeCaptureError in lib/scanner.js.',
        },
        {
          selector:
            "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type='Literal']",
          message:
            'This catch discards the error (e.g. `.catch(() => null)`). That is what made the photo button a dead button. Inspect it, or at minimum console.warn it.',
        },
      ],

      // console.log is stripped from production builds, so anything left
      // in it is invisible where it matters. warn/error/info survive and
      // are the right tools — but never log a payload: card numbers and
      // PINs live in those objects.
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],

      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['test/**/*.mjs', '*.config.js', 'scripts/**'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
]
