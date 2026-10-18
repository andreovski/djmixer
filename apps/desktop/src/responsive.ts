// SPDX-License-Identifier: AGPL-3.0-or-later
// Consultas de tela compartilhadas pela interface. "Compacto" é a tela de celular ou tablet em
// retrato: a biblioteca e o set viram abas em vez de colunas lado a lado (ver styles.css).
// "Toque" é o ponteiro grosso: alvos maiores e dicas de gestos no lugar das de mouse.
import { useSyncExternalStore } from 'react'

export const COMPACT_QUERY = '(max-width: 900px)'
export const TOUCH_QUERY = '(pointer: coarse)'

export function matches(query: string): boolean {
  return typeof window !== 'undefined' && window.matchMedia(query).matches
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => matches(query),
  )
}
