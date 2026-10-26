# 0016. Qualidade do "Importar de URL"

Data: 26/10/2026. Situação: decidida (André notou que as faixas vinham em AAC de 160 kbps). Complementa a [0013](0013-importar-de-url.md).

## Contexto

Sem login, o SoundCloud entrega às faixas públicas só o stream: AAC de 160 kbps (antes, MP3 de 128). O stream de 256 kbps do Go+ vem com DRM e fica de fora, como já dizia a 0013. Quando o artista libera download, existe o arquivo que ele enviou (muitas vezes WAV, FLAC ou MP3 de 320), e o yt-dlp já o prefere a qualquer stream; mas o SoundCloud costuma exigir uma conta logada para entregá-lo.

## Decisão

- O formulário **De URL…** ganha **Login do SoundCloud**: escolher um navegador faz o yt-dlp usar os cookies dele (`--cookies-from-browser`), como se o download fosse feito por quem está logado ali. A escolha fica salva no app. Nada de senha passa pelo app.
- Depois de cada download, o aviso diz quantas faixas vieram no arquivo original e quantas no stream, e sugere o login quando ele não foi usado.
- A qualidade de cada faixa continua visível ao selecioná-la (0015).

## Consequências

- No macOS, ler os cookies do Safari exige dar ao app (ou ao Terminal, no `pnpm dev`) acesso total ao disco; Chrome, Brave e Firefox costumam funcionar sem isso (o Chrome pede a senha do Chaveiro na primeira vez).
- Faixa sem download liberado continua em 160 kbps. Para qualidade de pista, o caminho é comprar o arquivo (Beatport, Bandcamp) e importar.
