# 0014. Capas e playlists na biblioteca

Data: 26/10/2026. Situação: decidida (André pediu capas para achar as faixas e playlists para se organizar).

## Decisão

**Capas.** Cada faixa da biblioteca mostra uma miniatura de 160 × 160 px em JPEG, guardada em `<dados do app>/cache/covers/<hash>.jpg`. O host procura a imagem, nesta ordem, na capa que o yt-dlp baixa ao lado do áudio no "Importar de URL" (`--write-thumbnail`, mesmo nome com `.jpg`) e na capa embutida no arquivo (ID3, MP4, FLAC), extraída pelo ffmpeg. A extração é preguiçosa: acontece na primeira vez que a faixa aparece na lista, no máximo duas ao mesmo tempo, então bibliotecas antigas ganham capas sem reimportar. Faixa sem capa ganha um arquivo `.none` para não ser procurada de novo, e a lista mostra a inicial do título.

**Playlists.** Uma playlist tem nome e uma lista ordenada de hashes, guardada na biblioteca (tabela `playlists` no SQLite; no IndexedDB na versão web). Uma faixa pode estar em várias playlists. O seletor no topo da biblioteca mostra todas as faixas ou uma playlist, na ordem dela, e o filtro de texto vale dentro da playlist. Remover a faixa da biblioteca a tira de todas as playlists; apagar a playlist não mexe nas faixas.

## Consequências

- A versão web tem playlists, mas não tem capas: sem ffmpeg, ela não extrai a imagem embutida.
- As capas ocupam uns 10 KB por faixa no cache. Apagar a pasta `cache/covers` só faz o app extraí-las de novo.
