# 0011. Versão web

Data: 18/10/2026. Situação: decidida (André pediu para acessar o app pela web).

## Decisão

O mesmo app de `apps/desktop` ganha um terceiro host, `src/browser-host.ts`, que roda inteiro no navegador, e é publicado no GitHub Pages a cada push na `main` (`.github/workflows/pages.yml`). O build escolhe o host por `VITE_DJMIXER_HOST=browser`.

- **Faixas:** o arquivo importado é guardado no IndexedDB do navegador, com o hash SHA-256 como chave. O áudio nunca vai para um servidor, o que mantém o princípio local-first do escopo.
- **Decodificação:** `decodeAudioData` do navegador a 44,1 kHz, no lugar do ffmpeg. MP3, WAV, FLAC e AAC funcionam no Chromium; AIFF e ALAC dependem do navegador (spike 4).
- **Biblioteca, análise, picos e cache de stretch:** IndexedDB. O cache de stretch é descartável: sem espaço, a faixa é esticada de novo.
- **Projeto e export:** salvar baixa o `.djmix`; abrir é escolher o arquivo; o WAV é montado em memória e baixado junto com a tracklist.

## Consequências

- A biblioteca é de cada navegador; trocar de computador ou limpar os dados do site exige importar de novo.
- O WAV exportado fica inteiro na memória antes do download (uns 15 MB por minuto de set).
- O Electron continua sendo o app principal: decodifica mais formatos com o ffmpeg e grava direto no disco.
