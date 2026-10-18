// SPDX-License-Identifier: AGPL-3.0-or-later
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-electron/**',
      '**/dist-web/**',
      'apps/desktop/test-results/**',
      '**/node_modules/**',
      'coverage/**',
      'spikes/shell-tauri/src-tauri/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['packages/engine/**/*.ts', 'packages/shared/**/*.ts', 'packages/analysis/**/*.ts'],
    rules: {
      // O motor e a análise não dependem de UI nem do shell (ver docs/decisoes/0004).
      'no-restricted-imports': [
        'error',
        { patterns: ['react', 'react-dom', 'electron', '@tauri-apps/*', '@djmixer/playground'] },
      ],
    },
  },
  {
    // O shell Electron do spike 4 roda direto no Node do Electron, sem build.
    files: ['spikes/shell-electron/**/*.{js,cjs}'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly', Response: 'readonly' },
    },
  },
  {
    // Nos testes, um `!` que falha derruba o teste, que é o que se quer.
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
