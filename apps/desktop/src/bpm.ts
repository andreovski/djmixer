// SPDX-License-Identifier: AGPL-3.0-or-later
// Leitura e escrita do BPM no campo do editor de beatgrid. Aceita vírgula ou ponto como separador
// decimal e mostra com vírgula, como o resto da interface.

export const MIN_BPM = 40
export const MAX_BPM = 250

/** Arredonda para milésimos, a precisão guardada na grade. */
export function roundBpm(bpm: number): number {
  return Math.round(bpm * 1000) / 1000
}

/** BPM digitado, ou null se o texto não for um número dentro da faixa aceita. */
export function parseBpm(text: string): number | null {
  const clean = text.trim().replace(',', '.')
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(clean)) return null
  const bpm = Number(clean)
  return bpm >= MIN_BPM && bpm <= MAX_BPM ? roundBpm(bpm) : null
}

/** BPM para o campo: sem zeros à direita, até três casas, com vírgula ("128", "127,5"). */
export function formatBpm(bpm: number): string {
  return String(roundBpm(bpm)).replace('.', ',')
}

/** Soma um passo ao BPM, preso à faixa aceita. */
export function stepBpm(bpm: number, delta: number): number {
  return roundBpm(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm + delta)))
}
