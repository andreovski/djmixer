# 0018. Busca no SoundCloud

Data: 26/10/2026. Situação: decidida (André pediu um campo de busca no lugar de colar a URL, listando só faixas sem DRM). Complementa a [0013](0013-importar-de-url.md) e a [0016](0016-qualidade-do-download.md).

## Decisão

- O botão **De URL…** vira **SoundCloud…**. O campo aceita um link, que é baixado direto como antes, ou um texto, que é buscado no SoundCloud.
- A busca usa o `scsearch` do yt-dlp, sem login, e pede a ele que escolha o formato de cada resultado sem baixar nada (`--print` em modo simulação, com o mesmo `--format` do download). Faixas só com DRM (Go+) ou só com a prévia de 30 s falham nessa escolha e, com `--ignore-errors`, não aparecem na lista. O que aparece dá para baixar.
- Cada resultado mostra capa, título, artista, duração, bitrate do stream e **Baixar**, que usa o mesmo download (com o "Login do SoundCloud", se escolhido). O que já está na biblioteca aparece como "Na biblioteca".
- A busca confere 15 resultados e só os streams abertos mais comuns (`hls_aac`, `http_mp3`, `hls_mp3`), porque cada formato conferido é uma chamada a mais ao SoundCloud.
- A CSP do Electron passa a aceitar imagens de `https://*.sndcdn.com`, para as capas dos resultados.

## Consequências

- A busca leva alguns segundos (o yt-dlp confere cada resultado), e o texto "Buscando e conferindo…" aparece enquanto isso.
- Uma faixa cujo único stream aberto seja Opus não aparece na busca, mas ainda pode ser baixada colando o link.
- Como nas outras partes do "Importar de URL", isso existe só no app desktop e no `pnpm dev:web`.
