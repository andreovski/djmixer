// SPDX-License-Identifier: AGPL-3.0-or-later
// O essentia.js não publica tipos para os builds ES; o uso fica tipado em analyze.ts.
declare module 'essentia.js/dist/essentia.js-core.es.js' {
  const Essentia: unknown
  export default Essentia
}

declare module 'essentia.js/dist/essentia-wasm.es.js' {
  export const EssentiaWASM: unknown
}
