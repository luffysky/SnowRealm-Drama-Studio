import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescriptConfig from 'eslint-config-next/typescript'

/**
 * Flat config, using eslint-config-next's native flat exports directly rather
 * than the FlatCompat bridge — the bridge pulls in @eslint/eslintrc, which
 * requires minimatch v3 and so conflicts with the v11 override this project
 * applies to clear a dev-dependency advisory.
 */
export default [
  ...coreWebVitals,
  ...typescriptConfig,
  {
    rules: {
      // `_`-prefixed parameters are deliberately unused: they document a
      // signature (e.g. the user argument of a future per-project membership
      // check) that callers must still pass.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // The smoke test reads arbitrary JSON off the wire; asserting on it is the
    // point, and typing every response shape would only restate the assertions.
    files: ['scripts/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'drizzle/**', '.pgdata/**', 'next-env.d.ts'],
  },
]
