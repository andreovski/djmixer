// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { formatBpm, parseBpm, stepBpm } from './bpm.ts'

describe('campo de BPM', () => {
  it('aceita vírgula ou ponto e arredonda para milésimos', () => {
    expect(parseBpm('128')).toBe(128)
    expect(parseBpm('127,5')).toBe(127.5)
    expect(parseBpm(' 127.99 ')).toBe(127.99)
    expect(parseBpm('124,00049')).toBe(124)
  })

  it('recusa texto incompleto ou fora da faixa sem estragar a digitação', () => {
    expect(parseBpm('')).toBeNull()
    expect(parseBpm('1')).toBeNull()
    expect(parseBpm('12')).toBeNull()
    expect(parseBpm('300')).toBeNull()
    expect(parseBpm('12a')).toBeNull()
    expect(parseBpm('-128')).toBeNull()
    expect(parseBpm('128,')).toBe(128)
  })

  it('mostra sem zeros à direita e com vírgula', () => {
    expect(formatBpm(128)).toBe('128')
    expect(formatBpm(127.5)).toBe('127,5')
    expect(formatBpm(127.9999)).toBe('128')
    expect(formatBpm(126.123)).toBe('126,123')
  })

  it('anda de 1 em 1 mantendo os decimais e para nos limites', () => {
    expect(stepBpm(127.98, 1)).toBe(128.98)
    expect(stepBpm(128, -1)).toBe(127)
    expect(stepBpm(249.5, 1)).toBe(250)
    expect(stepBpm(40.4, -1)).toBe(40)
  })
})
