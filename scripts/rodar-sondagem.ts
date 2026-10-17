// SPDX-License-Identifier: AGPL-3.0-or-later
// Abre um shell do spike 4 com a sondagem, espera o relatório e imprime um resumo em Markdown.
// Uso: node scripts/rodar-sondagem.ts <saida.json> -- <comando do shell> [args...]
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const TIMEOUT_MS = 10 * 60 * 1000

interface Result {
  label: string
  status: 'ok' | 'falha' | 'pulado'
  detail: string
}

const [outArg, separator, command, ...args] = process.argv.slice(2)
if (!outArg || separator !== '--' || !command) {
  console.error('Uso: node scripts/rodar-sondagem.ts <saida.json> -- <comando> [args...]')
  process.exit(2)
}
const out = resolve(outArg)
rmSync(out, { force: true })

const child = spawn(command, args, {
  stdio: 'inherit',
  env: { ...process.env, PROBE_OUT: out },
  // No Windows, comandos como pnpm são .cmd e precisam do shell; caminhos para binários não.
  shell: process.platform === 'win32' && !command.includes('/'),
})
const timer = setTimeout(() => {
  console.error(`O shell não entregou o relatório em ${TIMEOUT_MS / 1000} s.`)
  child.kill()
}, TIMEOUT_MS)

child.on('exit', (code) => {
  clearTimeout(timer)
  if (!existsSync(out)) {
    console.error(`O shell saiu (código ${code}) sem gravar ${out}.`)
    process.exit(1)
  }
  const report = JSON.parse(readFileSync(out, 'utf8')) as {
    shell: string
    userAgent: string
    results: Result[]
  }
  const icon = { ok: '✓', falha: '✗', pulado: '–' }
  const lines = [
    `### ${report.shell} em ${process.platform}-${process.arch}`,
    '',
    `\`${report.userAgent}\``,
    '',
    '| Teste | Resultado | Detalhe |',
    '| --- | --- | --- |',
    ...report.results.map((r) => `| ${r.label} | ${icon[r.status]} ${r.status} | ${r.detail} |`),
    '',
  ]
  const markdown = lines.join('\n')
  console.log(markdown)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
})
