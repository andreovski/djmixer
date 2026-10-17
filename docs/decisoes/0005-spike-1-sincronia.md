# 0005. Spike 1: sincronia pelo relógio do AudioContext

Data: 17/10/2026. Situação: aceita.

## Pergunta

Duas faixas com BPMs diferentes ficam em fase quando agendadas pelo relógio do `AudioContext`?

## Como foi medido

- `scheduleClip` converte cada clip (em beats) em `start(when, offset)`, `stop(stopAt)` e `playbackRate`, todos derivados de `beatsToSeconds`.
- Faixas sintéticas de 124 BPM (primeira batida em 0 s) e 128 BPM (primeira batida em 0,37 s), grupo a 126 BPM, B entrando no beat 64 e transição de 16 compassos.
- Render offline com A no canal esquerdo e B no direito; ataques detectados por limiar e pareados batida a batida.

## Resultado

| Ambiente                                 | Batidas pareadas | Desvio máximo | Desvio médio |
| ---------------------------------------- | ---------------- | ------------- | ------------ |
| Node (`node-web-audio-api`, teste no CI) | 64 de 64         | 0,023 ms      | 0,018 ms     |
| Chromium (playground)                    | 64 de 64         | 0,023 ms      | 0,018 ms     |

O desvio é de cerca de 1 amostra a 44,1 kHz, bem abaixo do critério de 1 ms. Um beatgrid errado em 10 ms faz o teste falhar, então ele detecta desalinhamento de verdade.

## Decisão

O agendamento por beats sobre o relógio do `AudioContext` é a base do motor. O teste de render entra no CI e protege esse comportamento.

## Pendências

- O casamento de BPM usa `playbackRate`, que muda o tom. O spike 3 troca isso por time-stretch com key lock aplicado offline, mantendo o mesmo agendamento.
- Falta ouvir com faixas reais no macOS: carregar duas faixas no playground, informar BPM e primeira batida e conferir com o metrônomo.
