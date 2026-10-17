# Instruções para o Claude

- Escreva documentação, comentários e mensagens para o mantenedor em português. Commits e títulos de PR em inglês.
- O escopo é [docs/escopo.md](docs/escopo.md) e a ordem de trabalho é [docs/plano.md](docs/plano.md). Decisões ficam em `docs/decisoes/`, uma por arquivo.
- Todo tempo no modelo é medido em beats; converta para segundos só com as funções de `@djmixer/shared` (`tempo.ts`).
- `packages/engine`, `packages/analysis` e `packages/shared` nunca importam UI nem APIs do shell desktop.
- Nenhum arquivo de áudio entra no git. Faixas de teste ficam em `fixtures/audio/` (locais) ou são geradas com `pnpm fixtures:synthetic`.
- Toda dependência nova ganha uma linha em `DEPENDENCIES.md` com a licença conferida, no mesmo PR.
- Arquivos de código começam com `// SPDX-License-Identifier: AGPL-3.0-or-later`.
- Antes de abrir um PR: `pnpm lint && pnpm typecheck && pnpm test`.
