# Plano de início

O plano detalhado está no documento [Plano de início do desenvolvimento](https://claude.ai/code/artifact/da0c869a-1e17-431d-b4fe-5b6d4206816a). Resumo da ordem:

1. **Marco 0:** repositório, monorepo, ferramentas e CI.
2. **Fase 0, protótipo do motor** no `playground`, em cinco spikes:
   1. Reprodução sincronizada de duas faixas pelo relógio do `AudioContext`.
   2. Automação de volume, EQ e filtro sem estalos.
   3. Time-stretch: Rubber Band vs SoundTouch, aplicado offline, em 4% e 8%.
   4. Shell desktop: Electron vs Tauri.
   5. Análise: acerto do Essentia.js em BPM e primeira batida.
3. **Ponte:** interface `Engine`, schema JSON v1 e teste de render offline no CI.
4. **Fase 1** em fatias verticais: esqueleto do app, importar e analisar, editor de beatgrid, grupo tocando, editor de transição, presets, set e export.

Cada resultado de spike vira um registro em [decisoes/](decisoes/).
