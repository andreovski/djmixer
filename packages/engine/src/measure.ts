// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Detecta ataques por limiar de amplitude: um ataque é a primeira amostra acima do limiar
 * depois de pelo menos `minGapSeconds` abaixo dele. Serve para faixas sintéticas, não para música.
 */
export function detectOnsets(
  samples: Float32Array,
  sampleRate: number,
  threshold: number,
  minGapSeconds = 0.05,
): number[] {
  const minGap = Math.round(minGapSeconds * sampleRate)
  const onsets: number[] = []
  let quietSince = -minGap
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i] ?? 0) >= threshold) {
      if (i - quietSince >= minGap) onsets.push(i / sampleRate)
      quietSince = i
    }
  }
  return onsets
}

export interface DriftReport {
  /** Pares de batidas encontrados nas duas listas. */
  matched: number
  maxSeconds: number
  meanSeconds: number
}

/** Compara duas listas de ataques, pareando cada ataque de `a` com o mais próximo de `b`. */
export function measureDrift(a: number[], b: number[], windowSeconds = 0.05): DriftReport {
  let matched = 0
  let max = 0
  let sum = 0
  let j = 0
  for (const t of a) {
    while (
      j + 1 < b.length &&
      Math.abs((b[j + 1] ?? Infinity) - t) <= Math.abs((b[j] ?? Infinity) - t)
    ) {
      j++
    }
    const diff = Math.abs((b[j] ?? Infinity) - t)
    if (diff <= windowSeconds) {
      matched++
      max = Math.max(max, diff)
      sum += diff
    }
  }
  return { matched, maxSeconds: max, meanSeconds: matched ? sum / matched : 0 }
}
