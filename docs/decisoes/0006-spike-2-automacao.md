# 0006. Spike 2: automação de volume, EQ e filtro

Data: 17/10/2026. Situação: aceita, com audição pendente.

## Pergunta

As lanes viram automação de `AudioParam` sem estalos, e qual EQ usar: biquads shelving ou um isolador por crossover?

## Como funciona

- Cada canal passa por EQ de 3 bandas, filtro bipolar (passa-baixa abaixo de 0,5, passa-alta acima) e volume.
- As lanes ficam em beats do grupo, com valores de 0 a 1. O motor amostra cada lane a 200 pontos por segundo, converte para a unidade do parâmetro (dB, Hz, ganho) e envia com `setValueCurveAtTime`. Um ponto `hold` vira uma rampa de 5 ms, sem estalo.
- Escalas: EQ 0 corta, 0,5 é 0 dB, 1 é +6 dB. Volume é a posição do fader ao quadrado. Filtro em 0 fecha em 100 Hz; em 1 abre o passa-alta em 8 kHz.
- O isolador é uma árvore de crossovers Linkwitz-Riley de 4ª ordem em 200 Hz e 2,5 kHz, com compensação de fase no grave para as bandas somarem plano.
- Os filtros usam Q Butterworth. No Web Audio o Q de lowpass e highpass é em dB (-3,01 dB), não linear; com 0,707 o isolador dava +1 dB a 60 Hz.

## Resultado

Com o EQ neutro, os dois modos ficam a menos de 0,01 dB do original em 60 Hz, 200 Hz, 1 kHz, 2,5 kHz e 8 kHz.

Corte de cada banda no zero (atenuação de uma senoide):

| Banda e frequência | Shelving | Isolador |
| ------------------ | -------- | -------- |
| Grave, 40 Hz       | -39,4 dB | -56,0 dB |
| Grave, 60 Hz       | -37,4 dB | -41,9 dB |
| Grave, 100 Hz      | -31,4 dB | -24,6 dB |
| Grave, 150 Hz      | -24,9 dB | -12,4 dB |
| Médio, 1 kHz       | -40,0 dB | -31,8 dB |
| Agudo, 10 kHz      | -39,3 dB | -54,5 dB |

O isolador corta mais longe dos crossovers e menos perto deles; o shelving corta de forma mais uniforme. Nenhum dos dois zera de verdade com crossovers de 4ª ordem.

Estalos: um fade de volume com curva S e uma varredura de filtro de 100 Hz a 2 kHz ficam abaixo de 3 vezes a segunda diferença de uma senoide limpa. Um salto instantâneo de ganho passa de 10 vezes, então a métrica detecta estalos de verdade. Os dois testes rodam no CI.

Sincronia continua dentro do critério com o EQ no caminho: 0,023 ms (shelving) e 0,045 ms (isolador). Um render de 61 s com automação leva de 0,8 a 1,5 s no Chromium.

## Decisão

- Automação por curva amostrada (`setValueCurveAtTime`) para todos os parâmetros. Fica simples e trata qualquer conversão de unidade do mesmo jeito.
- O isolador fica como padrão porque soa como um mixer de DJ, e o shelving continua disponível. A escolha final, incluindo crossovers de 8ª ordem para cortar mais, depende da audição.

## Pendências

- Ouvir Fade, Blend, Bass swap e Filter out com faixas reais no macOS, nos dois modos de EQ.
- Decidir na fase 1 entre EQ de 3 ou 4 bandas e se o filtro continua com um botão só.
