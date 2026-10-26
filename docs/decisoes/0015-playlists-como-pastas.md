# 0015. Playlists como pastas, qualidade do arquivo e limpeza de downloads

Data: 26/10/2026. Situação: decidida (pedidos do André depois de usar a 0014). Muda parte da [0014](0014-capas-e-playlists.md).

## Decisão

**Playlists são pastas.** A biblioteca funciona como o Finder: as playlists aparecem no topo como pastas que abrem e fecham, com as faixas dentro, e as faixas que não estão em nenhuma aparecem soltas embaixo. Cada faixa fica em no máximo uma pasta: **Mover para…** (ou arrastar a faixa até a pasta, ou para fora delas) a tira da pasta anterior. Apagar uma pasta deixa as faixas soltas. Isso troca o seletor de playlist da 0014. A busca procura em toda a biblioteca e abre as pastas que têm resultado. Uma faixa que tenha ficado em duas playlists pela regra antiga aparece só na primeira por nome, até ser movida.

**Qualidade do arquivo.** Com uma faixa selecionada, a biblioteca mostra codec, bitrate, taxa de amostragem, bits (nos formatos sem perdas), canais, tamanho e se o formato é com ou sem perdas, lidos pelo ffprobe na hora. A versão web, sem ffprobe, mostra só o formato pela extensão e um bitrate estimado por tamanho e duração (marcado com "~").

**Remover apaga o que o app baixou.** Remover uma faixa do "Importar de URL" apaga o áudio e a capa da pasta de downloads, além do cache decodificado e da miniatura. Sem isso, o yt-dlp achava o arquivo antigo e não baixava de novo. Arquivos importados do computador nunca são apagados. Para eles há **Mostrar no Finder**, que abre a pasta do arquivo (no app desktop e no `dev:web`).

**Capas no Electron.** A política de segurança do app desktop passa a aceitar imagens `blob:`, que é como a interface mostra as capas. Faixas baixadas de URL antes da 0014 não têm capa ao lado do áudio; o app agora baixa só a capa pela página de origem (`yt-dlp --skip-download --write-thumbnail`). O marcador de faixa sem capa mudou de `.none` para `.nocover`, para essas faixas serem procuradas de novo uma vez.
