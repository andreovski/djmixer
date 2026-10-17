# 0002. macOS em Apple Silicon como sistema de referência do MVP

Data: 17/10/2026. Situação: aceita.

## Contexto

O áudio se comporta de forma diferente entre sistemas operacionais, e o MVP precisa de um sistema onde tudo é ouvido e testado no dia a dia.

## Decisão

O sistema de referência é macOS em Apple Silicon, o computador de desenvolvimento do mantenedor, até o projeto abrir oficialmente para outros sistemas.

## Consequências

- Spikes de áudio e audições são feitos no macOS.
- O CI roda lint, typecheck e testes também em Linux e Windows, para pegar quebras cedo, mas a qualidade de áudio só é garantida no macOS até lá.
