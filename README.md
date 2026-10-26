# djmixer

App desktop open source para montar sets de música eletrônica. O DJ organiza faixas locais em grupos de transições (micro-sets), desenha cada transição com linhas de automação medidas em compassos e renderiza o set final na ordem dos grupos.

`djmixer` é um nome provisório até o primeiro release.

## Estado

Fase 1 (MVP): o app desktop importa e analisa faixas, edita beatgrid e cues, monta grupos com transições automatizadas, toca e ensaia e exporta o set em WAV com tracklist. O escopo completo está em [docs/escopo.md](docs/escopo.md), a ordem de trabalho em [docs/plano.md](docs/plano.md) e a arquitetura do app em [docs/decisoes/0010-arquitetura-fase-1.md](docs/decisoes/0010-arquitetura-fase-1.md).

## Não objetivos

- O app nunca distribui áudio. Compartilhar um set significa compartilhar a "receita" (JSON), sem áudio.
- O SoundCloud entra só como ferramenta de descoberta; o motor de mistura usa apenas arquivos locais do usuário.
- Não é um software de DJ ao vivo nem um DAW: é para planejar e ensaiar transições.
- Sem conta, servidor ou nuvem no MVP.

## Estrutura

```text
packages/shared     tipos do modelo de dados, conversões de tempo, schema do projeto
packages/engine     motor de áudio em TypeScript, sem UI e sem shell
packages/analysis   BPM, key, beatgrid e picos da waveform
apps/desktop        app Electron: host (arquivos, ffmpeg, biblioteca) e interface React
apps/playground     página Vite para os protótipos da fase 0
docs/               escopo, plano e registros de decisão
fixtures/           manifesto das faixas de referência (sem áudio)
```

## Como rodar

Requer Node 22.18+, pnpm 10 (`corepack enable` instala a versão certa) e o ffmpeg (`brew install ffmpeg` no macOS).

```sh
pnpm install
pnpm dev                 # compila e abre o app desktop (baixa o Electron na primeira vez)
pnpm dev:web             # o mesmo app num navegador, em http://localhost:5180 (diálogos viram prompts)
pnpm --filter @djmixer/desktop build:web  # versão web, sem servidor, em apps/desktop/dist-web
pnpm dev:playground      # abre o playground no navegador
pnpm test                # testes (Vitest)
pnpm lint                # ESLint + Prettier
pnpm typecheck           # TypeScript
pnpm fixtures:synthetic  # gera faixas sintéticas em fixtures/synthetic/
pnpm e2e                 # teste de ponta a ponta no Electron (precisa de pnpm --filter @djmixer/desktop build)
```

### Versão web

A versão web roda inteira no navegador, publicada em https://andreovski.github.io/djmixer/ a cada merge na `main`. O áudio não sai do computador: as faixas importadas ficam guardadas no navegador (IndexedDB), a decodificação usa o decodificador do navegador no lugar do ffmpeg (MP3, WAV, FLAC e AAC; AIFF e ALAC podem falhar), salvar o projeto e exportar o WAV viram downloads e abrir um projeto é escolher o arquivo. A biblioteca é de cada navegador. Funciona melhor no Chrome ou no Edge.

A interface se adapta a tablet e celular, em retrato e deitado: em tela pequena a biblioteca e o set viram abas, e a linha do tempo aceita gestos (arrastar o fundo ou dois dedos rolam, pinça aproxima, toque duplo apaga um ponto de automação e segurar troca a curva). Detalhes em [docs/decisoes/0012](docs/decisoes/0012-versao-responsiva.md).

### Usando o app

1. **Importar…** na biblioteca e escolha arquivos de áudio, ou **De URL…** e cole o link de uma faixa ou playlist do SoundCloud (o yt-dlp é instalado pelo próprio app na primeira abertura, ou use o do sistema). A análise (BPM, tom em Camelot, waveform) roda em segundo plano. Faixas baixadas de URL aparecem com a marca URL e impedem o export do set (ver [docs/decisoes/0013](docs/decisoes/0013-importar-de-url.md)). A capa de cada faixa aparece na lista (no app desktop), e **+ Playlist** organiza a biblioteca em playlists; o seletor acima do filtro troca entre todas as faixas e uma playlist, e **Adicionar à playlist…** põe a faixa selecionada numa delas.
2. Dois cliques numa faixa a põem no grupo selecionado; a segunda entra 8 compassos antes do fim da primeira, com uma transição Blend.
3. Na linha do tempo, **Clips** move e apara os clips; **Automação** edita os pontos da lane escolhida em cada canal (volume, EQ grave, médio e agudo, filtro). Dois cliques apagam um ponto e o botão direito troca a curva.
4. No painel de transições, escolha a janela e o preset e use **Ensaiar em loop** (ou a tecla L). Espaço toca o grupo a partir do cursor.
5. **Grade** abre o editor de beatgrid e cues da faixa, com metrônomo.
6. **Salvar** grava o projeto (`.djmix`); **Exportar WAV** renderiza o set e grava a tracklist ao lado.

## Licença

[AGPL-3.0-or-later](LICENSE). Cada dependência e sua licença ficam em [DEPENDENCIES.md](DEPENDENCIES.md).
