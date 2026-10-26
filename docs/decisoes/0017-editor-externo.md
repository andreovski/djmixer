# 0017. Editor de áudio externo (iZotope RX)

Data: 26/10/2026. Situação: decidida (André quer melhorar faixas de 160 kbps com o RX 11 Advanced que ele já tem). Complementa a [0016](0016-qualidade-do-download.md).

## Contexto

Nenhum processamento recupera o que o codec jogou fora, mas a Spectral Recovery do RX recria os agudos cortados de forma plausível. Carregar plugins VST3/AU dentro do app exigiria um host nativo (C++, JUCE ou parecido), com a janela do plugin e processamento offline: alguns dias de trabalho e mais uma peça para manter. Abrir a faixa no próprio RX resolve o mesmo problema com o editor completo.

## Decisão

- Com uma faixa selecionada, um botão com o ícone do editor (lido do app instalado, sem copiar a arte da iZotope) abre o arquivo nele. Na primeira vez o app pede o editor; o botão direito troca. Funciona com qualquer editor (RX, Ozone, uma DAW), no app desktop e no `pnpm dev:web`.
- Quando a janela do djmixer volta ao foco, o host procura uma versão salva depois da abertura: o mesmo arquivo regravado ou um arquivo de áudio na mesma pasta cujo nome começa com o nome da faixa (o "Salvar como" do RX). Achando, a faixa é trocada na biblioteca e no projeto aberto, mantendo título, análise, beatgrid, cues e playlists.
- A tabela `replaced` da biblioteca guarda hash antigo → novo, para projetos salvos antes da troca acharem a versão nova.
- Se a faixa era um download de URL, o arquivo baixado é apagado quando a versão editada é outro arquivo; a faixa continua marcada como URL e fora do export (0013).

## Consequências

- O RX não grava AAC: uma faixa .m4a volta como WAV, com o mesmo começo de nome, e ocupa mais espaço.
- A grade e as cues valem para a versão editada; cortar ou esticar o áudio no editor desalinha a grade, e aí é preciso corrigir no editor de beatgrid ou analisar de novo.
- Um arquivo novo na mesma pasta com o mesmo começo de nome, salvo enquanto a faixa está aberta no editor, é tomado como a versão editada.
