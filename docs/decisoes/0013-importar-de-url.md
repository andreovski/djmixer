# 0013. Importar de URL (SoundCloud) com yt-dlp

Data: 25/10/2026. Situação: decidida (André pediu para uso pessoal; o repositório vai ficar privado).

## Contexto

André quer montar mixes com faixas do SoundCloud dentro do app, sem exportar o resultado. A pesquisa de viabilidade concluiu que nenhum serviço de streaming libera mixagem por API pública: SoundCloud (os termos da API proíbem modificar a faixa e guardar o áudio), Beatport, Beatsource, TIDAL e Apple Music só por contrato com empresas de software DJ, e o Spotify proíbe mixagem na política de desenvolvedor. O áudio desses parceiros vem com DRM, e contornar DRM é proibido mesmo para uso pessoal (Lei 9.610/98, art. 107).

As faixas públicas do SoundCloud chegam sem DRM. Baixá-las fora da API vai contra os termos de uso do SoundCloud, mas não contorna proteção técnica. Para uma ferramenta pessoal, não distribuída, André aceitou esse risco.

## Decisão

- **"Importar de URL"** na biblioteca (botão **De URL…**): o usuário cola o link de uma faixa ou playlist, o host chama o **yt-dlp do sistema** e importa os arquivos baixados como faixas locais. Fica em `apps/desktop/host/url-import.ts`.
- **yt-dlp, não uma API escrita por nós.** Ele já sabe falar com o SoundCloud e é atualizado pela comunidade quando o site muda. Não é distribuído com o app: vem do PATH, de `/opt/homebrew/bin` ou de `DJMIXER_YTDLP`, como o ffmpeg. O yt-dlp recusa conteúdo com DRM, então as faixas Go+ e serviços como Spotify ficam de fora sem precisar de regra nossa.
- **Arquivos** em `<dados do app>/downloads/` (fora do git e fora das pastas do usuário), com título e artista gravados no arquivo (`--embed-metadata`). Depois disso a faixa segue o caminho de qualquer arquivo local: hash, ffprobe, ffmpeg, análise, cache.
- **Origem guardada.** A biblioteca ganha a coluna `source_url` (bibliotecas antigas recebem a coluna ao abrir). A faixa aparece com a marca **URL**.
- **Sem export.** Um set com qualquer faixa baixada de URL não exporta WAV; o app diz quais faixas impedem. Tocar, ensaiar e salvar o projeto continuam normais.
- **Só no desktop** (Electron e `dev:web`). A versão web não tem host para rodar o yt-dlp e não mostra o botão.

## Consequências

- Precisa do yt-dlp instalado (`brew install yt-dlp`) e atualizado: quando o SoundCloud muda o site, o download para de funcionar até o yt-dlp lançar a correção (`brew upgrade yt-dlp`).
- Uso contra os termos do SoundCloud, aceito para uso pessoal. Se o projeto voltar a ser público ou distribuído, este recurso precisa ser revisto.
- Os arquivos baixados ocupam disco na pasta de dados do app; remover a faixa da biblioteca não apaga o arquivo.
