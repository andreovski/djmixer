# Dependências e licenças

Toda dependência nova entra nesta lista no mesmo PR, com a licença conferida. O projeto é AGPL-3.0-or-later, então a licença de cada dependência precisa ser compatível com ela (ver [docs/decisoes/0001-licenca.md](docs/decisoes/0001-licenca.md)).

## Distribuídas com o app

Entram no app desktop (`apps/desktop`) a partir da fase 1.

| Pacote              | Licença declarada                  | Uso                                      | Situação                                                                                                                                        |
| ------------------- | ---------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| react, react-dom    | MIT                                | interface                                | 19.3.1, conferida                                                                                                                               |
| zustand             | MIT                                | estado da interface                      | 5.0.15, conferida                                                                                                                               |
| electron            | MIT                                | shell desktop (decisão 0008)             | 44.9.0, conferida; o Chromium e o Node embutidos têm licenças próprias, listadas no `LICENSES.chromium.html` do Electron, a anexar no release   |
| rubberband-wasm     | GPL-2.0 (texto do pacote)          | time-stretch com key lock (decisão 0007) | 3.3.0; antes do primeiro release, confirmar se é "GPLv2 ou posterior" (compatível com AGPL-3.0) ou compilar o WASM a partir do Rubber Band      |
| @soundtouchjs/core  | MPL-2.0 (pacote npm)               | time-stretch comparado no spike 3        | 2.1.1; só o playground e os testes usam, o app não chama                                                                                        |
| essentia.js         | AGPL-3.0                           | BPM, key, beats (decisão 0009)           | 0.1.3 (LICENSE do pacote conferido); só os algoritmos clássicos, os modelos de ML (CC BY-NC-ND 4.0) não entram                                  |
| FFmpeg (executável) | LGPL ou GPL, conforme a compilação | decodificação                            | na fase 1 vem do sistema (PATH ou `DJMIXER_FFMPEG`), não é distribuído; embutir no release exige escolher uma compilação LGPL ou GPL compatível |

## Só de desenvolvimento

Não são distribuídas com o app.

| Pacote                         | Licença           | Uso                                        |
| ------------------------------ | ----------------- | ------------------------------------------ |
| typescript                     | Apache-2.0        | compilador                                 |
| eslint, @eslint/js             | MIT               | lint                                       |
| typescript-eslint              | MIT               | lint de TypeScript                         |
| prettier                       | MIT               | formatação                                 |
| vitest                         | MIT               | testes                                     |
| vite                           | MIT               | servidor e build do playground e do app    |
| @vitejs/plugin-react           | MIT               | JSX e recarga rápida no Vite               |
| @types/react, @types/react-dom | MIT               | tipos do React                             |
| @playwright/test               | Apache-2.0        | testes de ponta a ponta no Electron        |
| @types/node                    | MIT               | tipos do Node para scripts                 |
| electron                       | MIT               | shell do spike 4 (`spikes/shell-electron`) |
| node-web-audio-api             | BSD-3-Clause      | Web Audio no Node para os testes do motor  |
| @tauri-apps/cli                | Apache-2.0 OR MIT | build do shell do spike 4                  |
| tauri (crate Rust)             | Apache-2.0 OR MIT | shell do spike 4 (`spikes/shell-tauri`)    |
