# 0001. Licença AGPL-3.0-or-later

Data: 17/10/2026. Situação: aceita.

## Contexto

As melhores bibliotecas de áudio para o projeto são copyleft: Rubber Band (GPL), Essentia (AGPL-3.0), aubio (GPL). O escopo escolhe Essentia.js para análise.

## Decisão

O código do projeto é licenciado sob AGPL-3.0-or-later.

## Consequências

- Essentia.js pode ser usada sem dúvida de compatibilidade; GPL-3.0 e LGPL também combinam com a AGPL-3.0.
- Para um app desktop sem servidor, a obrigação extra da AGPL (abrir o código de versões servidas por rede) quase não muda nada na prática.
- Forks proprietários ficam inviáveis, o que está alinhado com o princípio de não comercialização.
- Cada dependência é conferida em [DEPENDENCIES.md](../../DEPENDENCIES.md) antes de entrar.
