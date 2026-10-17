// SPDX-License-Identifier: AGPL-3.0-or-later
// Medições objetivas do spike 3: tom, pureza espectral e alinhamento das batidas depois do stretch.

/** Frequência estimada por cruzamentos de zero com interpolação linear. */
export function estimateFrequency(samples: Float32Array, sampleRate: number): number {
  const crossings: number[] = []
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] ?? 0
    const b = samples[i] ?? 0
    if (a < 0 && b >= 0) crossings.push(i - 1 + a / (a - b))
  }
  const first = crossings[0]
  const last = crossings[crossings.length - 1]
  if (first === undefined || last === undefined || crossings.length < 2) return 0
  return ((crossings.length - 1) * sampleRate) / (last - first)
}

/**
 * Razão, em dB, entre a senoide de frequência `hz` e o resto do sinal. Em blocos curtos, ajusta
 * seno e cosseno por mínimos quadrados e mede o que sobra. Quanto maior, menos artefatos.
 */
export function toneToNoiseDb(
  samples: Float32Array,
  sampleRate: number,
  hz: number,
  block = 2048,
): number {
  let tone = 0
  let residue = 0
  const w = (2 * Math.PI * hz) / sampleRate
  for (let start = 0; start + block <= samples.length; start += block) {
    let ss = 0
    let cc = 0
    let sc = 0
    let xs = 0
    let xc = 0
    for (let i = 0; i < block; i++) {
      const s = Math.sin(w * (start + i))
      const c = Math.cos(w * (start + i))
      const x = samples[start + i] ?? 0
      ss += s * s
      cc += c * c
      sc += s * c
      xs += x * s
      xc += x * c
    }
    const det = ss * cc - sc * sc
    const a = (xs * cc - xc * sc) / det
    const b = (xc * ss - xs * sc) / det
    for (let i = 0; i < block; i++) {
      const fit = a * Math.sin(w * (start + i)) + b * Math.cos(w * (start + i))
      const x = samples[start + i] ?? 0
      tone += fit * fit
      residue += (x - fit) ** 2
    }
  }
  return 10 * Math.log10(tone / Math.max(residue, 1e-20))
}
