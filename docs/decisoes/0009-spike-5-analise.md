# 0009. Spike 5: análise de BPM, beatgrid e tonalidade

Data: 17/10/2026. Situação: proposta, com o teste em faixas reais pendente.

## Pergunta

O Essentia.js acerta o BPM, a primeira batida e a tonalidade de música eletrônica o bastante para o beatgrid automático servir de ponto de partida? E quanto tempo leva por faixa?

## Como foi medido

- `packages/analysis` usa o `essentia.js` 0.1.3 (AGPL-3.0, WASM): `RhythmExtractor2013` para BPM e batidas e `KeyExtractor` com o perfil `edma` (feito para música eletrônica) para a tonalidade. Os modelos de ML do Essentia não entram (licença CC BY-NC-ND).
- Gabarito: 10 faixas sintéticas de 1,5 a 2,5 minutos com bumbo 4/4, chimbal e baixo no contratempo e acordes numa tonalidade conhecida, de 100 a 174 BPM, com BPM fracionário (122,5 e 126,37), silêncio antes da primeira batida e intros sem bumbo.
- `pnpm avaliar:analise` gera a tabela completa; os testes cobrem 4 dessas faixas.

## O que o Essentia entrega sozinho

- **BPM:** certo, mas as batidas vêm em passos de 11,6 ms (o salto de análise), então o BPM ajustado sai com erro de uns centésimos numa faixa curta (126,05 em vez de 126).
- **Fase:** em 6 de 10 faixas o detector travou no contratempo, onde estão o chimbal e o baixo. Nas outras, marcou a batida 17 ms antes do bumbo.
- **Tonalidade:** certa nas 10, com o perfil `edma`.

Uma grade meia batida fora deixa todas as transições fora de tempo, então o Essentia sozinho não basta.

## O que foi acrescentado

1. **Ajuste da grade (`fitBeatgrid`):** regressão linear das batidas do Essentia a partir do trecho regular mais longo, para uma intro sem bumbo não puxar a grade.
2. **Alinhamento pelo bumbo (`alignToKick`):** compara a grade com a grade deslocada meia batida e fica com a que cai nos picos mais fortes do sinal (em música eletrônica, o bumbo). Depois mede o ataque de cada bumbo com precisão de 1 ms e refaz o BPM e a primeira batida por esses ataques.
3. **Arredondamento do BPM:** para o inteiro ou o meio mais próximo quando está a menos de 0,02 dele, que é o normal no gênero; senão fica com duas casas.

## Resultado

| Detector       | BPM certo | Erro da primeira batida | Tonalidade certa | Tempo por minuto de áudio (Node) |
| -------------- | --------- | ----------------------- | ---------------- | -------------------------------- |
| `multifeature` | 10 de 10  | até 0,3 ms              | 10 de 10         | 5,2 s                            |
| `degara`       | 9 de 10   | até 0,7 ms              | 10 de 10         | 1,0 s                            |

O `degara` errou só a faixa de 174 BPM (deu 116, dois terços). No navegador, uma faixa de 4 minutos a 48 kHz leva 11 s com o `multifeature`, contando a conversão para 44,1 kHz, num Web Worker.

## Proposta

- Essentia.js com o alinhamento pelo bumbo para BPM, beatgrid e tonalidade, em Camelot.
- Detector `multifeature` por padrão. Uma biblioteca de 500 faixas de 6 minutos leva uns 4 horas de CPU, ou uns 30 minutos em 8 núcleos; roda em segundo plano na importação e fica em cache. Se for lento demais com faixas reais, o `degara` entra para faixas de 85 a 150 BPM.
- O beatgrid continua editável e a correção do usuário sempre vale mais que a análise, como diz o escopo.

## Limites

- Tudo foi medido em faixas sintéticas. O alinhamento pelo bumbo supõe que o bumbo é o transiente mais forte, o que vale para house e techno mas pode falhar em breakbeat, faixas sem bumbo ou com o baixo mais alto que o bumbo.
- A tonalidade em faixas reais (com vocais, efeitos e modulações) costuma acertar menos que nas sintéticas.
- BPM variável (gravações ao vivo) não é tratado: a grade é de BPM constante.

## Pendente

- Testar no playground (botão "Analisar") com faixas reais e comparar com o Rekordbox: BPM, primeira batida (de ouvido, com o metrônomo) e tonalidade.
