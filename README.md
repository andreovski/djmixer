# djmixer

App desktop open source para montar sets de música eletrônica. O DJ organiza faixas locais em grupos de transições (micro-sets), desenha cada transição com linhas de automação medidas em compassos e renderiza o set final na ordem dos grupos.

`djmixer` é um nome provisório até o primeiro release.

## Estado

Marco 0: estrutura do repositório e ferramentas. O próximo passo é a fase 0, um protótipo do motor de áudio no `playground`. O escopo completo está em [docs/escopo.md](docs/escopo.md) e a ordem de trabalho em [docs/plano.md](docs/plano.md).

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
apps/playground     página Vite para os protótipos da fase 0
docs/               escopo, plano e registros de decisão
fixtures/           manifesto das faixas de referência (sem áudio)
```

O app desktop (`apps/desktop`) é criado na fase 1, depois da escolha entre Electron e Tauri.

## Como rodar

Requer Node 22.18+ e pnpm 10 (`corepack enable` instala a versão certa).

```sh
pnpm install
pnpm dev:playground      # abre o playground no navegador
pnpm test                # testes (Vitest)
pnpm lint                # ESLint + Prettier
pnpm typecheck           # TypeScript
pnpm fixtures:synthetic  # gera faixas sintéticas em fixtures/synthetic/
```

## Licença

[AGPL-3.0-or-later](LICENSE). Cada dependência e sua licença ficam em [DEPENDENCIES.md](DEPENDENCIES.md).
