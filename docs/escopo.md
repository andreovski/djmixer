# Escopo: app open source para montar sets de música eletrônica

Oct 17, 2026 · @André

App desktop open source em que o DJ organiza faixas locais em grupos de transições (micro-sets), desenha cada transição com linhas de automação e renderiza o set final na ordem dos grupos.

## Visão e princípios

O app preenche o espaço entre o modo Mix do Spotify (poucos presets, pouca edição) e o Ableton (poderoso demais para quem só quer encadear faixas): um editor focado em **transições**, medido em compassos, em que cada parâmetro da mistura é uma linha editável.

- **Transição é o objeto central.** Projeto → grupos (micro-sets) → canais com faixas → linhas de automação. Os grupos tocam em sequência e formam o set.
- **Local-first.** O áudio, a análise e a renderização rodam na máquina do usuário. O projeto é um arquivo; não há conta nem servidor no MVP.
- **Planejamento, não performance.** O app monta e ensaia o set antes; não é um software de DJ ao vivo. Isso dispensa latência de milissegundos e permite usar Web Audio.
- **Open source, sem comercialização.** Código aberto; compartilhar um set significa compartilhar a "receita" (JSON), nunca o áudio.
- **Mais simples que um DAW.** Poucos controles, todos orientados à mistura: volume, EQ, filtro, efeitos, loop e tempo.

## Escopo do MVP

O MVP entrega o ciclo completo com uma faixa de recursos pequena: importar, analisar, montar um grupo, desenhar a transição, ouvir e exportar.

**Dentro do MVP**

- Importar arquivos de áudio locais (MP3, WAV, FLAC, AAC) para uma biblioteca do projeto.
- Análise automática de BPM, tonalidade (notação Camelot), beatgrid e waveform colorida por frequência, com edição manual do beatgrid.
- Projeto com grupos; cada grupo com N canais e clips posicionados em compassos.
- Editor de transição com linhas de volume, EQ de 3 bandas e filtro; pontos arrastáveis, curvas e snap ao compasso.
- Presets que geram as linhas (Fade, Blend, Bass swap, Slam, No transition) e podem ser editados depois.
- Sync de tempo (time-stretch com key lock) para casar o BPM das faixas.
- Reprodução do grupo, ensaio só da transição (loop) e reprodução do set na ordem dos grupos.
- Render offline do set para WAV e tracklist com timestamps em texto.
- Salvar e abrir projeto (arquivo local).

**Fora do MVP (ver roadmap)**

- Gravação de automação por controlador MIDI.
- Separação de stems, efeitos avançados, sugestão de próxima faixa, importação de bibliotecas Rekordbox/Serato/Traktor.
- Sincronização na nuvem, contas e qualquer backend.
- Integração com SoundCloud além de descoberta (ver seção seguinte).
- Modo de performance ao vivo.

## Fontes de áudio e SoundCloud

**Decisão:** a fonte de áudio do app são os arquivos locais do usuário. O SoundCloud entra só como ferramenta de descoberta, sem tocar, editar ou guardar áudio dele dentro do motor de mistura.

O motivo está nos [termos da API do SoundCloud](https://developers.soundcloud.com/docs/api/terms-of-use) (vigentes desde 30/03/2024), que bloqueiam o núcleo do produto:

- **Edição:** não é permitido modificar o conteúdo (editar, recortar, criar obra derivada) sem consentimento expresso do uploader, por exemplo uma licença Creative Commons que permita derivados. EQ, filtro e time-stretch caem aí.
- **Armazenamento:** o app não pode salvar, baixar nem manter o conteúdo; só há cache de sessão, que expira ao fim dela. Render e arquivo de projeto com áudio do SoundCloud ficam inviáveis.
- **IA:** o conteúdo da API não pode ser entrada de IA, e o texto cita separação de fontes (stems) como exemplo. Isso exclui o recurso de stems para essas faixas.
- **Ripping:** capturar ou copiar conteúdo é proibido, e conteúdo exclusivo do SoundCloud Go está fora de alcance.
- **Registro:** é preciso registrar o app e obter um client ID, que pode ser revogado. O site de desenvolvedores lista hoje uma página "Get an API key", então o cadastro parece disponível; confirmar antes de depender dele.
- **Marca:** o nome do app não pode conter "SoundCloud" nem derivações.

**O que a integração faz no MVP e depois**

- Busca de faixas e playlists por metadados, com crédito ao uploader e link para a página original (exigência dos termos).
- Preview pelo widget oficial, fora do motor de áudio.
- "Lista de desejos": o usuário marca faixas para baixar ou comprar fora do app e depois importa o arquivo local. O app casa a faixa pelo título e artista.
- Importar um arquivo que o usuário baixou legitimamente (por exemplo, download liberado pelo artista) é um fluxo de arquivo local, fora da API. Os termos do SoundCloud não cobrem arquivos que o próprio usuário traz.

Outras fontes úteis para o mesmo fluxo: Bandcamp, Beatport, promos e o acervo pessoal do DJ.

## Stack técnica

Tudo em TypeScript, sem backend no MVP: o áudio roda no processo do app, em Web Audio, e o projeto é um arquivo local.

| Camada | Escolha | Alternativa | Observação |
| --- | --- | --- | --- |
| Shell desktop | Electron | Tauri | Electron entrega o mesmo Chromium em todos os sistemas. Tauri é mais leve, mas o Web Audio no WebView do Linux é menos confiável (validar no protótipo). |
| UI | React + TypeScript | Svelte | Escolha pela familiaridade da equipe. |
| Waveform e linhas de automação | Canvas 2D | WebGL | Passar para WebGL só se a waveform de faixas longas pesar. |
| Motor de áudio | Web Audio API + AudioWorklet | Motor em Rust (cpal, symphonia) | O motor fica atrás de uma interface para poder trocar na fase 2. |
| Time-stretch e key lock | Rubber Band (WASM) | SoundTouch (WASM) | Rubber Band tem melhor qualidade; as licenças pesam (ver Licença). |
| Análise de BPM, key e beats | Essentia.js (WASM) | aubio | Resultado cacheado no projeto; beatgrid sempre editável. |
| Decodificação | ffmpeg embutido | decodeAudioData | ffmpeg cobre mais formatos e também serve ao export. |
| Persistência | SQLite (biblioteca, cache) + projeto em JSON | — | O projeto referencia arquivos por caminho e hash; nunca embute áudio. |
| Render offline | OfflineAudioContext + ffmpeg | — | Mesmo grafo do tempo real, saída WAV; MP3 e FLAC via ffmpeg. |
| Testes | Vitest + render offline | — | Teste de áudio: renderizar uma transição e comparar com um arquivo de referência dentro de uma tolerância. |

**Backend (ruby, python ou javascript?)** Nenhum no MVP. Depois do MVP, se houver compartilhamento de sets (apenas a receita em JSON), Node/TypeScript com Postgres mantém uma linguagem só. Python só entra como processo auxiliar de análise pesada (stems com Demucs, madmom), de forma opcional e local. Ruby não traz vantagem aqui.

## Modelo de dados

Todo tempo é medido em batidas (beats), não em segundos, para que a transição continue alinhada quando o BPM muda.

```text
Project
 ├─ Library: faixas analisadas
 │    └─ Track { id, path, hash, bpm, key, beatgrid[], cues[], sections[], energy }
 ├─ Groups[]: micro-sets, a ordem da lista é a ordem do set
 │    ├─ TempoMap { bpm inicial, rampas em beats }
 │    ├─ Channels[]: um por faixa
 │    │    ├─ Clip { trackId, inBeat, outBeat, startBeat, stretch }
 │    │    └─ Lanes[]: volume | eq.low | eq.mid | eq.high | filter | fx.send | loop
 │    │         └─ Point { beat, value, curve: linear | exp | hold | s-curve }
 │    └─ Transitions[]: janela em beats entre dois canais + preset de origem
 └─ SetTimeline: encadeia os grupos e a transição entre o fim de um e o início do próximo
```

Regras do modelo:

- Um preset (Fade, Blend, Slam...) só gera pontos nas lanes. Depois de aplicado, o usuário edita os pontos livremente, e o app não guarda nenhuma lógica escondida do preset.
- O projeto referencia as faixas por caminho e hash do conteúdo. Se o arquivo mudou de lugar, o app procura pelo hash antes de pedir que o usuário o localize.
- O arquivo de projeto é JSON versionado (`schemaVersion`), com migração entre versões desde o primeiro release.
- A análise (BPM, key, beatgrid, seções) fica em cache na biblioteca; as correções manuais do usuário têm prioridade e nunca são sobrescritas por uma nova análise.
- Compartilhar um set = exportar a "receita": o JSON do projeto com título, artista e hash de cada faixa, sem áudio.

## Funcionalidades

O backlog abaixo está ordenado por fase; as fases são as do roadmap. Complexidade é uma estimativa relativa, para priorizar.

| Fase | Área | Funcionalidade | Complexidade |
| --- | --- | --- | --- |
| 0 | Motor | Tocar duas faixas com sync de BPM e crossfade com automação de EQ em uma página só | Média |
| 0 | Motor | Avaliar a qualidade do time-stretch (Rubber Band vs SoundTouch) em faixas de 120 a 130 BPM | Média |
| 1 | Biblioteca | Importar arquivos locais e analisar BPM, key (Camelot) e waveform colorida por frequência | Média |
| 1 | Biblioteca | Editor de beatgrid (ajustar a primeira batida e o BPM, marcar cues) | Alta |
| 1 | Projeto | Projeto com grupos; grupos com N canais e clips em compassos; salvar e abrir | Média |
| 1 | Transição | Lanes de volume, EQ de 3 bandas e filtro, com pontos, curvas e snap ao compasso | Alta |
| 1 | Transição | Presets que geram lanes (Fade, Blend, Bass swap, Slam, No transition) | Baixa |
| 1 | Reprodução | Ensaio só da transição em loop; tocar o grupo; tocar o set na ordem dos grupos | Média |
| 1 | Export | Render offline em WAV e tracklist com timestamps em texto | Média |
| 2 | Transição | Gravar automação com mouse ou controlador MIDI | Alta |
| 2 | Transição | Efeitos: echo out, reverb tail, reverse, riser, noise sweep, tape stop, loop roll | Média |
| 2 | Análise | Detecção de frases e seções (intro, build, drop, breakdown) para sugerir pontos de entrada e saída em 8, 16 ou 32 compassos | Alta |
| 2 | Sugestão | Próxima faixa por compatibilidade harmônica (roda Camelot), faixa de BPM e curva de energia, com regras | Média |
| 2 | Biblioteca | Importar biblioteca do Rekordbox (XML) com beatgrid e cues já analisados | Média |
| 2 | Set | Visão do set inteiro: curva de energia, fluxo de keys, rampa de BPM e duração total | Média |
| 2 | Export | Normalização de loudness (LUFS), limiter no master, cue sheet (.cue), playlist (.m3u) e MP3/FLAC | Média |
| 2 | Integração | Busca de descoberta no SoundCloud e lista de desejos que casa com arquivos locais (ver Fontes de áudio) | Média |
| 2 | Transição | Biblioteca de transições: salvar a sua como preset reutilizável e importar presets de outros | Baixa |
| 3 | Transição | Stems locais (Demucs): trocar baixo, bateria ou voz entre faixas | Alta |
| 3 | Motor | Motor de áudio em Rust se o Web Audio virar gargalo de qualidade ou desempenho | Alta |
| 3 | Export | Exportar para projeto do Ableton (.als, XML compactado; frágil entre versões) | Alta |
| 3 | Compartilhamento | Exportar e importar a receita do set; hospedar receitas só se houver demanda | Média |
| 3 | Performance | Modo de tocar o set ao vivo, controlando por grupo | Alta |

## Riscos e decisões em aberto

Os dois riscos técnicos maiores são o beatgrid automático errar e o time-stretch degradar faixas com tempo variável; os dois devem ser testados antes de construir a interface.

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Beatgrid automático impreciso | Alto: transições fora de tempo | Editor manual de beatgrid desde o MVP; correção do usuário sempre prevalece; importar beatgrid do Rekordbox na fase 2 |
| Time-stretch com artefatos ou em faixas com tempo variável | Médio | Comparar bibliotecas no protótipo; limitar o ajuste de tempo a uma faixa pequena; marcadores de warp na fase 2 |
| Sincronia de muitos canais e automações no Web Audio | Médio | Agendar tudo pelo relógio do AudioContext; testar com render offline; limite de canais por grupo no MVP |
| Memória e desempenho com faixas longas | Médio | Decodificar sob demanda; pré-calcular picos da waveform em vários níveis de zoom |
| Incompatibilidade de licenças das bibliotecas | Alto na distribuição | Definir a licença do projeto antes de adicionar dependências; conferir cada uma (ver Licença) |
| Termos do SoundCloud e revogação da chave | Alto se o app depender dele | Usar só para descoberta; o app funciona 100% sem SoundCloud |
| Direitos autorais dos áudios do usuário | Médio | O app não distribui áudio; a receita do set não contém áudio; aviso no export |
| Sistemas operacionais com comportamento de áudio diferente | Médio | Escolher um sistema de referência para o MVP e testar os demais antes de cada release |

**Decisões em aberto**

- Nome do projeto (sem usar nomes de terceiros, como SoundCloud, Spotify ou Ableton).
- Licença final: GPL-3.0 ou AGPL-3.0 (ver Licença).
- Electron ou Tauri; decidir depois do protótipo do motor.
- Sistema operacional de referência do MVP (macOS, Windows ou Linux).
- EQ de 3 ou 4 bandas, e se haverá filtro passa-alta e passa-baixa separados.
- Faixa de ajuste de tempo aceita antes de avisar que a qualidade cai.

## Licença open source

As melhores bibliotecas de áudio para este projeto são copyleft; por isso a licença do projeto deve ser GPL-3.0, ou AGPL-3.0 se o Essentia entrar. Fechar isso antes de adicionar dependências evita retrabalho.

| Biblioteca | Licença | Consequência para o projeto |
| --- | --- | --- |
| [Rubber Band](https://breakfastquay.com/rubberband/) | GPL; licença comercial paga para uso proprietário | Pode ser usada num projeto GPL. Quem quiser embutir em app fechado precisa comprar licença, o que limita forks comerciais. |
| [Essentia](https://essentia.upf.edu/licensing_information.html) | AGPL-3.0 para uso não comercial; licença comercial sob consulta | Obriga a abrir o código também de versões servidas por rede. Os modelos de ML dela são CC BY-NC-ND 4.0, só para uso não comercial. Confirmar no repositório do Essentia.js a licença do pacote WASM. |
| [SoundTouch](https://www.surina.net/soundtouch/license.html) | LGPL 2.1 | Mais permissiva: pode ser ligada a um app com outra licença, desde que o usuário possa trocar a biblioteca. Qualidade de stretch menor que a do Rubber Band. |
| [aubio](https://aubio.org/) | GPL | Compatível com projeto GPL; não serve para app fechado sem acordo com o autor. |

Não verificadas aqui e a conferir antes do primeiro release: FFmpeg (a licença depende das opções de compilação), Demucs e seus pesos de modelo, e as dependências de UI.

A licença do projeto vale para o código. Nenhum áudio é distribuído com o app. Este texto é uma triagem técnica; para a decisão final, vale conferir os textos das licenças ou consultar alguém da área jurídica.

## Primeiros passos

A implementação começa pela fase 0, o protótipo do motor, porque ele valida o risco mais caro antes de investir na interface. Para continuar em outro chat, exporte este documento em Markdown e anexe-o na primeira mensagem.

1. Criar o repositório com a licença escolhida, um README com a visão e os "não objetivos" (nenhum áudio distribuído, SoundCloud só para descoberta) e a lista de dependências com suas licenças.
2. Organizar em pacotes: `engine` (TypeScript puro, sem UI), `analysis`, `shared` (tipos do modelo de dados) e `app` (Electron + React).
3. Protótipo do motor: uma página que carrega duas faixas locais, casa o BPM e faz um crossfade de 16 compassos com automação de EQ nos `AudioParam`. Pronto quando a transição sai sem estalos e sem desvio de fase audível.
4. Comparar Rubber Band e SoundTouch (WASM) em 5 faixas de referência, com ajustes de tempo de 4% e 8%, e registrar o resultado no repositório.
5. Fixar o schema JSON v1 do projeto e escrever os testes de render offline (renderizar uma transição e comparar com um arquivo de referência).
6. Só então construir a biblioteca e o editor de grupos e transições (fase 1).

## Fontes

Páginas abertas em 17/10/2026; os termos e licenças podem mudar, então conferir de novo antes do primeiro release.

- [SoundCloud, API Terms of Use](https://developers.soundcloud.com/docs/api/terms-of-use)
- [Rubber Band Library](https://breakfastquay.com/rubberband/)
- [Essentia, Licensing](https://essentia.upf.edu/licensing_information.html)
- [SoundTouch, License](https://www.surina.net/soundtouch/license.html)
- [aubio](https://aubio.org/)
