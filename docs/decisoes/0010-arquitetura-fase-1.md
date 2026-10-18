# 0010. Arquitetura do app da fase 1

Data: 17/10/2026. Situação: decidida (André pediu a fase 1 inteira num PR, seguindo as recomendações).

## Contexto

A fase 0 escolheu Electron (0008), Rubber Band R3 offline com cache (0007) e Essentia.js com alinhamento pelo bumbo (0009). Faltava decidir como o app se organiza: onde fica cada coisa, como o áudio chega ao motor e o que guardar onde.

## Decisões

**Processos.** O processo principal do Electron só faz o que precisa do sistema: diálogos, arquivos, ffmpeg e a biblioteca. Essa parte fica em `apps/desktop/host/` sem nada do Electron, para rodar também atrás de HTTP no servidor de desenvolvimento (`dev:web`), que é como a interface é testada num navegador comum. A interface (React + zustand) e o motor rodam no renderer.

**Decodificação.** O ffmpeg decodifica cada faixa uma vez para PCM float estéreo a 44,1 kHz, guardado em cache pelo hash do arquivo, e a interface lê pelo protocolo `app://djmixer/media/`. O `AudioContext` roda a 44,1 kHz, a mesma taxa da análise. Na fase 1 o ffmpeg vem do sistema (PATH, `/opt/homebrew/bin` ou `DJMIXER_FFMPEG`); embuti-lo fica para o release, junto com a escolha da compilação (LGPL ou GPL).

**Biblioteca.** SQLite pelo `node:sqlite` do Node do Electron: metadados, análise, correções do usuário (grade e cues) e picos da waveform, por hash. As correções ficam separadas da análise, então analisar de novo nunca as apaga.

**Análise e waveform.** Num Web Worker, uma faixa por vez. A waveform guarda, a cada 10 ms, o pico e a energia de três bandas (até 200 Hz, médios, acima de 2,5 kHz), um byte cada; a cor mistura vermelho, verde e azul.

**Time-stretch.** Com key lock, a faixa é esticada uma vez para o BPM do grupo (Rubber Band R3 num Worker) e o resultado vai para o cache em disco por faixa e BPM. Sem key lock, o motor ajusta a velocidade (varispeed). O app avisa quando o ajuste passa de 8%, o máximo testado no spike 3.

**Motor.** `packages/engine/src/engine.ts` é a interface usada pelo app: `createEngine` toca um grupo a partir de uma batida, ensaia a janela de uma transição em loop e toca o set grupo a grupo, agendando cada trecho uns segundos antes no relógio do `AudioContext` e lendo o projeto de novo a cada volta (uma edição vale na volta seguinte do loop). `renderGroup` usa o mesmo grafo num `OfflineAudioContext`. O mix passa por um compressor rápido e uma saturação suave abaixo de 0 dBFS, só como proteção; a normalização de loudness é da fase 2.

**Projeto.** Schema v1 em `packages/shared/src/model.ts`, salvo como JSON com extensão `.djmix`. Os grupos tocam em sequência, sem sobreposição; a passagem de um grupo para o seguinte é feita pondo a mesma faixa no fim de um e no começo do outro (o app continua a faixa de onde ela parou). O projeto guarda caminho e hash de cada faixa; ao abrir, procura pelo hash se o arquivo mudou de lugar e pede para localizar o que não achou.

**Edição.** Tudo em batidas, com snap em compasso, batida ou livre. Uma faixa nova entra 8 compassos antes do fim da anterior, com uma transição Blend já gerada. Mover um clip leva a automação junto. Mudar a janela ou o preset de uma transição gera os pontos de novo dentro da janela, e o resto da lane fica como estava. Há desfazer e refazer.

**Export.** O set é renderizado grupo a grupo e gravado em partes num WAV de 24 bits, com o cabeçalho regravado no fim; a tracklist em texto fica ao lado, com o mesmo nome.

**Testes.** O teste de render offline (`packages/engine/src/render.test.ts`) compara o RMS por compasso de uma transição Blend com uma referência em JSON (sem áudio) e confere que as batidas seguem a grade. O app inteiro é testado no Electron de verdade com Playwright no CI, em macOS e Linux (`apps/desktop/e2e`).

## Consequências

- O app precisa do ffmpeg instalado até o primeiro release.
- Faixas decodificadas ocupam uns 20 MB por minuto no cache em disco e na memória; a interface guarda no máximo 8 faixas decodificadas e 8 esticadas.
- Rampas de tempo dentro de um grupo, efeitos e loops ficam para a fase 2, como no escopo.
