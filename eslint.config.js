// SPDX-License-Identifier: AGPL-3.0-or-later
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**'] },
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
)
