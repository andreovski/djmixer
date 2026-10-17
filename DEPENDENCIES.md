# Dependências e licenças

Toda dependência nova entra nesta lista no mesmo PR, com a licença conferida. O projeto é AGPL-3.0-or-later, então a licença de cada dependência precisa ser compatível com ela (ver [docs/decisoes/0001-licenca.md](docs/decisoes/0001-licenca.md)).

## Distribuídas com o app

Nenhuma ainda. Candidatas da fase 0, a conferir antes de entrar:

| Pacote             | Licença declarada                  | Uso                    | Situação                                                                                                                                                      |
| ------------------ | ---------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rubber Band (WASM) | GPL-2.0-or-later                   | time-stretch           | spike 3; conferir a licença do pacote WASM                                                                                                                    |
| SoundTouch (WASM)  | LGPL-2.1                           | time-stretch           | spike 3; conferir a licença do pacote WASM                                                                                                                    |
| Essentia.js        | AGPL-3.0                           | BPM, key, beats        | `essentia.js` 0.1.3 em `packages/analysis` (LICENSE do pacote conferido: AGPL-3.0); só os algoritmos clássicos, os modelos de ML (CC BY-NC-ND 4.0) não entram |
| FFmpeg             | LGPL ou GPL, conforme a compilação | decodificação e export | fase 1                                                                                                                                                        |

## Só de desenvolvimento

Não são distribuídas com o app.

| Pacote             | Licença           | Uso                                        |
| ------------------ | ----------------- | ------------------------------------------ |
| typescript         | Apache-2.0        | compilador                                 |
| eslint, @eslint/js | MIT               | lint                                       |
| typescript-eslint  | MIT               | lint de TypeScript                         |
| prettier           | MIT               | formatação                                 |
| vitest             | MIT               | testes                                     |
| vite               | MIT               | servidor e build do playground             |
| @types/node        | MIT               | tipos do Node para scripts                 |
| electron           | MIT               | shell do spike 4 (`spikes/shell-electron`) |
| @tauri-apps/cli    | Apache-2.0 OR MIT | build do shell do spike 4                  |
| tauri (crate Rust) | Apache-2.0 OR MIT | shell do spike 4 (`spikes/shell-tauri`)    |
