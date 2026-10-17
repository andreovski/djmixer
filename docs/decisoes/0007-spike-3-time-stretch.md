# 0007. Spike 3: time-stretch com key lock

Data: 17/10/2026. Situação: proposta, com audição e licença pendentes.

## Pergunta

Qual biblioteca casar o BPM sem mudar o tom, aplicando o stretch offline (a faixa é esticada uma vez para o BPM do grupo e tocada com `playbackRate` 1), e até quantos por cento?

## Como foi medido

- `stretchToBpm` estica o `AudioBuffer` e devolve o beatgrid no novo BPM; o agendamento do spike 1 não muda.
- Candidatos: `rubberband-wasm` 3.3.0 (Rubber Band compilado para WASM), nos motores R3 (EngineFiner) e R2 (EngineFaster), e `@soundtouchjs/core` 2.1.1 (WSOLA do SoundTouch em TypeScript).
- Fatores de 0,92, 0,96, 1,04 e 1,08 (ajustes de 4% e 8% para os dois lados).
- Tom: frequência de uma senoide de 440 Hz depois do stretch. Pureza: energia da senoide sobre o resto do sinal (quanto maior, menos artefato). Batidas: posição de cada bumbo de uma faixa sintética comparada à posição esperada.

## Resultado

| Motor          | Tom (440 Hz)       | Pureza     | Erro das batidas                              | Tempo por minuto de áudio    |
| -------------- | ------------------ | ---------- | --------------------------------------------- | ---------------------------- |
| Rubber Band R3 | 440,00 Hz          | 68 a 75 dB | sempre atrasado, de +0,2 a +2,0 ms            | 4 s no Chromium, 9 s no Node |
| Rubber Band R2 | 437,7 a 444,4 Hz   | 6 a 16 dB  | -1,7 a +2,7 ms                                | 1,2 a 1,5 s no Chromium      |
| SoundTouch     | 440,00 a 440,02 Hz | 37 a 42 dB | até -17 ms, variando 4 a 8 ms dentro da faixa | 0,2 a 0,3 s no Chromium      |

Com duas faixas esticadas para o mesmo BPM do grupo, as batidas ficam a no máximo 1,2 ms uma da outra com o R3, contra 3,8 ms com o SoundTouch. A partir de uns 5 ms começa a soar como batida dobrada (flam).

O R2 desse pacote distorce até uma senoide pura; não investiguei se é do build ou das opções, e ele saiu da disputa.

## Proposta

- **Rubber Band R3, offline, com cache.** É o único que mantém tom, pureza e batidas ao mesmo tempo. O custo é tempo: uma faixa de 7 minutos leva uns 30 s no Chromium. Na fase 1 o stretch roda num Web Worker, uma vez por faixa e BPM, e o resultado fica em cache no disco.
- **SoundTouch como modo rápido de ensaio**, opcional, se a espera do R3 incomodar. O desvio das batidas o desqualifica para o render final.
- **Faixa de ajuste:** a qualidade medida não muda entre 4% e 8%. Proposta: aceitar até 8% sem aviso e avisar acima disso, a confirmar ouvindo.

## Pendências

- **Licença:** o pacote `rubberband-wasm` declara "GPLv2". O Rubber Band em si é GPL-2.0-or-later, que combina com a AGPL-3.0; GPL-2.0-only não combina. Antes de distribuir, confirmar com o autor do pacote que vale "or later", ou compilar nosso próprio WASM a partir do código do Rubber Band.
- Ouvir os três modos com faixas reais no macOS, em ajustes de 4% e 8%.
