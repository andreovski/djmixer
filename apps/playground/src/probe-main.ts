// SPDX-License-Identifier: AGPL-3.0-or-later
import { runProbe, sendToShell, type ProbeResult } from './probe.ts'

const $ = <T extends HTMLElement>(selector: string) => {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`Elemento ausente: ${selector}`)
  return el
}

const ICON: Record<ProbeResult['status'], string> = { ok: '✓', falha: '✗', pulado: '–' }

function addRow(result: ProbeResult) {
  const row = $<HTMLTableSectionElement>('#results tbody').insertRow()
  row.className = result.status
  for (const text of [result.label, `${ICON[result.status]} ${result.status}`, result.detail]) {
    row.insertCell().textContent = text
  }
}

async function run() {
  const button = $<HTMLButtonElement>('#run')
  button.disabled = true
  $('#results tbody').replaceChildren()
  const report = await runProbe(addRow)
  $('#shell').textContent = `Shell: ${report.shell}. ${report.userAgent}`
  const json = $<HTMLPreElement>('#json')
  json.textContent = JSON.stringify(report, null, 2)
  json.hidden = false
  button.disabled = false
  await sendToShell(report)
}

$('#run').addEventListener('click', () => void run())
if (new URLSearchParams(location.search).has('auto')) void run()
