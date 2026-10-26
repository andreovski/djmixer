# 0013. Importar de URL (SoundCloud) com yt-dlp

Data: 25/10/2026. Situação: decidida (André pediu para uso pessoal; o repositório vai ficar privado).

## Contexto

André quer montar mixes com faixas do SoundCloud dentro do app, sem exportar o resultado. A pesquisa de viabilidade concluiu que nenhum serviço de streaming libera mixagem por API pública: SoundCloud (os termos da API proíbem modificar a faixa e guardar o áudio), Beatport, Beatsource, TIDAL e Apple Music só por contrato com empresas de software DJ, e o Spotify proíbe mixagem na política de desenvolvedor. O áudio desses parceiros vem com DRM, e contornar DRM é proibido mesmo para uso pessoal (Lei 9.610/98, art. 107).

As faixas públicas do SoundCloud chegam sem DRM. Baixá-las fora da API vai contra os termos de uso do SoundCloud, mas não contorna proteção técnica. Para uma ferramenta pessoal, não distribuída, André aceitou esse risco.

## Decisão

- **"Importar de URL"** na biblioteca (botão **De URL…**): o usuário cola o link de uma faixa ou playlist, o host chama o **yt-dlp do sistema** e importa os arquivos baixados como faixas locais. Fica em `apps/desktop/host/url-import.ts`.
- **yt-dlp, não uma API escrita por nós.** Ele já sabe falar com o SoundCloud e é atualizado pela comunidade quando o site muda. Não é distribuído com o app: vem de `DJMIXER_YTDLP`, do PATH ou de `/opt/homebrew/bin` e, se não houver nenhum, o próprio app o instala (ver "Instalação automática" abaixo). O yt-dlp recusa conteúdo com DRM, então as faixas Go+ e serviços como Spotify ficam de fora sem precisar de regra nossa.
- **Arquivos** em `<dados do app>/downloads/` (fora do git e fora das pastas do usuário), com título e artista gravados no arquivo (`--embed-metadata`). Depois disso a faixa segue o caminho de qualquer arquivo local: hash, ffprobe, ffmpeg, análise, cache.
- **Origem guardada.** A biblioteca ganha a coluna `source_url` (bibliotecas antigas recebem a coluna ao abrir). A faixa aparece com a marca **URL**.
- **Sem export.** Um set com qualquer faixa baixada de URL não exporta WAV; o app diz quais faixas impedem. Tocar, ensaiar e salvar o projeto continuam normais.
- **Só no desktop** (Electron e `dev:web`). A versão web não tem host para rodar o yt-dlp e não mostra o botão.

## Instalação automática (26/10/2026)

André pediu que o app verifique o yt-dlp na abertura e o instale sozinho, no macOS e no Windows.

- **Na abertura** (Electron e `dev:web`), o host procura o yt-dlp em segundo plano, na ordem: `DJMIXER_YTDLP`, PATH e pastas do Homebrew. Se não achar, baixa o **executável standalone oficial** do último release do GitHub (`yt-dlp_macos`, universal Intel e Apple Silicon; `yt-dlp.exe`, `yt-dlp_x86.exe` ou `yt-dlp_arm64.exe` no Windows; `yt-dlp_linux` também funciona) para `<dados do app>/bin/`. Esses executáveis já trazem o Python dentro, então não há nada mais a instalar. Fica em `apps/desktop/host/ytdlp.ts`.
- **Conferência.** O app baixa também o `SHA2-256SUMS` do mesmo release e só grava o executável se o SHA-256 bater; o arquivo é escrito num temporário e renomeado, então um download interrompido não deixa executável quebrado. Não conferimos a assinatura GPG do `SHA2-256SUMS.sig`: o hash e o binário vêm do mesmo lugar por HTTPS, o que protege contra download corrompido, não contra um release comprometido.
- **Atualização.** No máximo uma vez por dia (na abertura ou no primeiro "De URL…"), o app relê o `SHA2-256SUMS` do último release e troca o executável se o hash mudou. Assim ele acompanha as correções do yt-dlp quando o SoundCloud muda o site. Sem internet, segue com o que já está instalado.
- **O do sistema tem prioridade.** Quem já tem `brew install yt-dlp` continua usando o dele (e o atualiza com `brew upgrade yt-dlp`); o app não baixa nada nesse caso.
- **Por que não `pip`, Homebrew ou winget.** Exigiriam Python, Homebrew ou permissão de administrador na máquina, e o app teria de rodar instaladores do sistema. O executável standalone vai para a pasta de dados do app, sem senha e sem tocar no resto do sistema.
- **Por que não embutir no app.** O yt-dlp precisa ser atualizado com frequência, bem mais do que lançaríamos versões do app.
- Enquanto a primeira instalação roda, o "De URL…" avisa "Instalando o yt-dlp…" e espera por ela.

## Consequências

- Na primeira abertura sem yt-dlp o app baixa cerca de 35 MB do GitHub. Quando o SoundCloud muda o site, o download para de funcionar até o yt-dlp lançar a correção, que o app pega em até um dia.
- O ffmpeg continua vindo do sistema (decisão 0010); o yt-dlp usa o mesmo ffmpeg para gravar os metadados.
- Uso contra os termos do SoundCloud, aceito para uso pessoal. Se o projeto voltar a ser público ou distribuído, este recurso precisa ser revisto.
- Os arquivos baixados ocupam disco na pasta de dados do app; remover a faixa da biblioteca não apaga o arquivo.
