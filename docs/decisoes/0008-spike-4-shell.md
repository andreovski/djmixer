# 0008. Spike 4: shell desktop (Electron ou Tauri)

Data: 17/10/2026. Situação: proposta, aguardando a escolha do André.

## Pergunta

O motor dos spikes 1 a 3 (relógio do Web Audio, AudioWorklet, render offline, automação, Rubber Band em WASM) funciona igual dentro do Electron e do Tauri? E o `decodeAudioData` de cada um abre os formatos que um DJ tem na biblioteca?

## Como foi medido

- `apps/playground/probe.html` roda cada peça e mede: o relógio do `AudioContext` contra o relógio da página por 2 s; um AudioWorklet num render offline; a sincronia do spike 1; o corte de graves do isolador do spike 2 e o tempo de render de 2 min com duas faixas automatizadas; o Rubber Band R3 do spike 3; e a decodificação de um tom de 440 Hz em 8 formatos. O tom começa depois de 0,5 s de silêncio, para ver se o decodificador entrega o áudio no lugar certo.
- `spikes/shell-electron` (Electron 44, Chromium 152) e `spikes/shell-tauri` (Tauri 2.12, WebView do sistema) abrem essa página. O workflow `Sondagem dos shells` roda os dois em macOS arm64, Ubuntu e Windows e publica os resultados como anotações.
- Localmente: `pnpm sondagem:electron` ou `pnpm sondagem:tauri` (o Tauri precisa do Rust instalado).

## Resultado

O motor deu o mesmo resultado nas seis combinações:

| Peça                      | Resultado em todos os shells e sistemas |
| ------------------------- | --------------------------------------- |
| AudioWorklet              | funciona                                |
| Sincronia (spike 1)       | desvio máximo 0,045 ms                  |
| Corte de graves (spike 2) | -41,9 dB em 60 Hz                       |
| Rubber Band R3 (spike 3)  | 440,00 Hz e 74 dB de pureza             |

Velocidade (macOS arm64 no CI):

| Shell    | Render de 120 s com duas faixas | Stretch R3 por minuto de áudio |
| -------- | ------------------------------- | ------------------------------ |
| Electron | 2,0 s                           | 4,1 s                          |
| Tauri    | 1,4 s                           | 3,4 s                          |

No Linux e no Windows os dois ficam entre 1,8 e 2,1 s de render e 3,6 a 4,6 s por minuto de stretch.

Decodificação (✓ abre no lugar certo, ✗ não abre, ⚠ abre deslocado):

| Formato    | Electron (todos)             | Tauri macOS | Tauri Windows | Tauri Linux (Ubuntu padrão) |
| ---------- | ---------------------------- | ----------- | ------------- | --------------------------- |
| WAV        | ✓                            | ✓           | ✓             | ✓                           |
| AIFF       | ✗                            | ✓           | ✗             | ✗                           |
| MP3        | ✓                            | ✓           | ✓             | ⚠ começa 25 ms atrasado     |
| AAC (M4A)  | ✓                            | ✓           | ✓             | ✗                           |
| ALAC (M4A) | ✗                            | ✓           | ✗             | ✗                           |
| FLAC       | ✓                            | ✓           | ✓             | ✓                           |
| Ogg Vorbis | ✓ (exceto macOS, não medido) | não medido  | ✓             | ✓                           |
| Opus       | ✓                            | ✓           | ✓             | ✓                           |

No Linux o Tauri usa o GStreamer do sistema: com o pacote `gstreamer1.0-libav` instalado, AIFF, AAC e ALAC passam a abrir, mas o MP3 continua 25 ms atrasado (o atraso do codificador não é descartado). Uma faixa analisada assim teria o beatgrid inteiro deslocado em 25 ms. O Ogg não foi medido no macOS porque o ffmpeg do Homebrew no CI não codifica Vorbis.

O teste do relógio em tempo real falhou no Electron nos runners de Linux e macOS (o relógio andou 0,02 s e 1,89 s em 2 s), e passou no Tauri e no Electron do Windows. Os runners de CI não têm placa de som. A primeira versão do teste também contava como lentidão o tempo que o áudio leva para começar; a versão atual espera o áudio começar e mede por 5 s.

No MacBook Pro do André (macOS arm64, Electron), com o teste atual: o relógio andou 5,003 s em 5,002 s, o áudio começou em 45 ms, a latência de saída é de 27 ms, o render de 120 s com duas faixas levou 0,77 s e o stretch R3, 1,9 s por minuto de áudio. A decodificação deu o mesmo resultado dos runners (AIFF e ALAC não abrem, os outros abrem no lugar certo).

## Conclusões

1. **O motor não decide.** Tudo que os spikes 1 a 3 validaram funciona igual nos dois shells e nos três sistemas.
2. **A decodificação sai do WebView.** Nenhum shell abre todos os formatos, e o mesmo MP3 cai em lugares diferentes conforme o decodificador. Como já previa o escopo, o app decodifica com ffmpeg (fora do WebView) e entrega PCM ao motor, nos dois shells. Assim o beatgrid de um arquivo é o mesmo em qualquer sistema.
3. **O que sobra para decidir** é o resto do app: o Electron leva o mesmo Chromium para todos os sistemas e roda o processo principal em TypeScript (ffmpeg, SQLite e arquivos ficam na mesma linguagem do motor); o Tauri gera um app bem menor e usa três motores de navegador diferentes, com o backend em Rust.

## Proposta

**Electron.** O teste no MacBook do André confirmou o relógio em tempo real. O que pesa: um único motor de navegador em todos os sistemas (o que se ouve no Mac é o que se ouve no Linux), todo o código em TypeScript e nenhum comportamento que dependa dos plugins instalados no sistema do usuário. O custo é o tamanho do instalador (uns 100 MB a mais que o Tauri), pouco para um app que trabalha com gigabytes de áudio.

Se o André preferir o Tauri pelo tamanho, nada do motor muda; a diferença fica no processo principal, que passa a ser Rust.

## Pendente

- Decidir o shell. Os dois diretórios em `spikes/` saem do repositório quando `apps/desktop` nascer na fase 1.
