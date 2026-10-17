// SPDX-License-Identifier: AGPL-3.0-or-later
// O ciclo completo no app Electron: importar duas faixas, esperar a análise, montar um grupo com
// uma transição, ensaiá-la em loop, salvar, exportar o WAV com a tracklist e abrir o projeto.
// Os diálogos nativos são trocados por respostas fixas no processo principal.
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gerarFaixas } from './faixas.ts'

const APP_DIR = join(import.meta.dirname, '..')

async function answerDialogs(app: ElectronApplication, open: string[], save: string) {
  await app.evaluate(
    ({ dialog }, answers) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: answers.open,
      })) as typeof dialog.showOpenDialog
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: answers.save,
      })) as typeof dialog.showSaveDialog
    },
    { open, save },
  )
}

test('importa, monta, ensaia, salva e exporta um set', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'djmixer-e2e-'))
  const tracks = gerarFaixas(join(dir, 'faixas'))
  const app = await electron.launch({
    // No CI o binário vem do release (ELECTRON_BIN); localmente, do pacote electron.
    ...(process.env.ELECTRON_BIN ? { executablePath: process.env.ELECTRON_BIN } : {}),
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), APP_DIR],
    cwd: APP_DIR,
    env: { ...process.env, DJMIXER_USER_DATA: join(dir, 'dados') },
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await answerDialogs(app, tracks, '')
  await page.getByRole('button', { name: 'Importar…' }).click()
  const items = page.getByTestId('library-item')
  await expect(items).toHaveCount(2)
  const bpms = page.getByTestId('bpm')
  await expect(bpms.nth(0)).toHaveText(/^124\.0/, { timeout: 120_000 })
  await expect(bpms.nth(1)).toHaveText(/^127\.0/, { timeout: 120_000 })
  await expect(page.locator('.library-item .key')).toHaveText(['8A', '8B'])

  await items.nth(0).dblclick()
  await items.nth(1).dblclick()
  await expect(page.getByTestId('transition')).toBeVisible()

  // Ensaiar a transição: a faixa B é esticada (Rubber Band) e o loop começa.
  await page.getByRole('button', { name: '⟳ Ensaiar em loop' }).click()
  await expect(page.getByTestId('position')).toHaveText(/Grupo 1 · (3[2-9]|40)\.\d/, {
    timeout: 120_000,
  })
  await page.getByRole('button', { name: '■' }).click()
  await expect(page.getByTestId('position')).toHaveText('—')

  const projectPath = join(dir, 'meu-set.djmix')
  await answerDialogs(app, [projectPath], projectPath)
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(page.getByTestId('notice')).toContainText('Projeto salvo')
  expect(JSON.parse(readFileSync(projectPath, 'utf8'))).toMatchObject({ schemaVersion: 1 })

  const wavPath = join(dir, 'meu-set.wav')
  await answerDialogs(app, [], wavPath)
  await page.getByRole('button', { name: 'Exportar WAV' }).click()
  await expect(page.getByTestId('notice')).toContainText('Set exportado', { timeout: 180_000 })
  // 2:15 de áudio estéreo em 24 bits.
  expect(statSync(wavPath).size).toBeGreaterThan(130 * 44100 * 2 * 3)
  expect(readFileSync(join(dir, 'meu-set.txt'), 'utf8')).toMatch(
    /^0:00 faixa-a-124\n[01]:\d\d faixa-b-127\n$/,
  )

  // Abrir o projeto salvo de novo.
  page.on('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Novo', exact: true }).click()
  await expect(page.getByTestId('group-tab')).toHaveCount(0)
  await answerDialogs(app, [projectPath], '')
  await page.getByRole('button', { name: 'Abrir' }).click()
  await expect(page.getByTestId('group-tab')).toHaveCount(1)

  expect(errors).toEqual([])
  await app.close()
  expect(existsSync(join(dir, 'dados', 'library.sqlite'))).toBe(true)
})
