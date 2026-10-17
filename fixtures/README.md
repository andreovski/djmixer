# Faixas de referência

Nenhum áudio entra no git. Este diretório guarda só o manifesto.

- **Faixas reais** (`fixtures/audio/`, ignorado pelo git): 5 faixas de 120 a 130 BPM usadas nos spikes da fase 0. Para cada uma, registre em `manifest.json` → `tracks` o nome do arquivo, o SHA-256, o BPM e o tempo da primeira batida conferidos à mão. Os testes que dependem delas pulam quando os arquivos não existem, como no CI.
- **Faixas sintéticas** (`fixtures/synthetic/`, ignorado pelo git): geradas com `pnpm fixtures:synthetic`. Têm BPM e primeira batida exatos e servem para os testes de render no CI.

Formato de uma entrada em `tracks`:

```json
{ "file": "audio/nome.flac", "sha256": "…", "bpm": 124, "firstBeatSeconds": 0.0, "key": "8A" }
```
