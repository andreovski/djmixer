# 0012. Versão responsiva

Data: 18/10/2026. Situação: decidida (André pediu a versão responsiva do app).

## Decisão

A mesma interface se adapta à tela, só com CSS e alguns gestos de toque; não há uma interface separada para celular.

- **Telas grandes (mais de 900 px):** o layout de sempre, igual no Electron e no navegador.
- **Tela compacta (até 900 px, celular e tablet em retrato):** biblioteca e set viram duas abas embaixo; a barra de cima quebra em linhas que rolam na horizontal; a área do set rola inteira. Adicionar uma faixa à biblioteca leva para a aba do set.
- **Celular deitado (pouca altura):** a barra de cima volta a ser uma linha só, e a dica de atalhos e a barra de status sem aviso somem.
- **Toque (`pointer: coarse`):** botões com 36 px de altura e campos com 16 px de fonte (o Safari do iPhone dá zoom ao focar campos menores).

Gestos na linha do tempo, onde o mouse tinha atalhos que o dedo não tem:

| Mouse                         | Toque                                      |
| ----------------------------- | ------------------------------------------ |
| Alt+arrastar ou roda rolam    | arrastar o fundo vazio ou dois dedos rolam |
| Ctrl/⌘+roda aproxima          | pinça com dois dedos                       |
| dois cliques num ponto apagam | toque duplo no ponto                       |
| botão direito troca a curva   | segurar o ponto parado                     |

O dedo só começa a arrastar depois de 8 px, e as bordas do clip e os pontos têm alvo maior. Se o segundo dedo encostar depois de o primeiro já ter criado ou movido algo, essa edição é desfeita antes da pinça. No editor de beatgrid, dois dedos aproximam e rolam a waveform.

## Consequências

- Editar no celular funciona, mas a tela pequena mostra poucos compassos de cada vez; o tablet é o aparelho de toque mais confortável.
- Os testes de ponta a ponta continuam no layout de desktop; os gestos foram conferidos no Chromium com toque emulado.
