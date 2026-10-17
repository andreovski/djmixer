# 0004. Monorepo com motor separado da interface

Data: 17/10/2026. Situação: aceita.

## Decisão

Monorepo com pnpm workspaces: `packages/shared`, `packages/engine`, `packages/analysis`, `apps/playground` e, na fase 1, `apps/desktop`. Dependências só em uma direção: `shared` ← `engine` e `analysis` ← apps.

## Consequências

- `engine`, `analysis` e `shared` não importam React, Electron nem Tauri; o ESLint bloqueia esses imports.
- O motor é testado no `playground`, no navegador, o que permite adiar a escolha entre Electron e Tauri até o spike 4.
- O motor fica atrás de uma interface, para poder ser trocado por um motor em Rust na fase 3.
