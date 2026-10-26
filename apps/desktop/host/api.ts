// SPDX-License-Identifier: AGPL-3.0-or-later
// Contrato entre a interface (renderer) e o host, que é o processo principal do Electron ou, em
// desenvolvimento e nos testes, o servidor de host/dev-server.ts. Só tipos: os dois lados importam
// este arquivo. Os tipos do modelo ficam repetidos de forma estrutural para o host não depender
// dos pacotes do monorepo.

export interface StoredGrid {
  bpm: number
  firstBeatSeconds: number
}

export interface StoredKey {
  note: string
  scale: string
  camelot: string
}

export interface StoredCue {
  id: string
  beat: number
  label: string
}

/** Resultado da análise automática, guardado na biblioteca. */
export interface TrackAnalysis {
  grid: StoredGrid
  key: StoredKey | null
  /** Confiança do BPM, de 0 a 1. */
  confidence: number
  analyzedAt: number
}

/** Correções do usuário; têm prioridade sobre a análise e sobrevivem a uma nova análise. */
export interface UserEdits {
  grid: StoredGrid | null
  cues: StoredCue[]
}

export interface LibraryEntry {
  hash: string
  path: string
  title: string
  artist: string
  durationSeconds: number
  analysis: TrackAnalysis | null
  edits: UserEdits
  /** O arquivo não está mais no caminho guardado. */
  missing: boolean
  /**
   * Página de onde a faixa foi baixada pelo "Importar de URL" (ver docs/decisoes/0013). Faixas
   * assim não entram no export.
   */
  sourceUrl?: string
}

/** Qualidade do arquivo de áudio, como está no disco (antes de decodificar). */
export interface AudioInfo {
  /** Contêiner, como o ffprobe o chama (mp3, mov,mp4,m4a, flac, wav...). */
  container: string
  /** Codec do áudio (mp3, aac, flac, pcm_s16le...). */
  codec: string
  bitrateKbps: number | null
  sampleRate: number | null
  /** Bits por amostra; só formatos sem perdas informam. */
  bitDepth: number | null
  channels: number | null
  bytes: number
  lossless: boolean
  /** O bitrate foi estimado por tamanho e duração (versão web). */
  estimated?: boolean
}

/** Playlist da biblioteca: um nome e as faixas (por hash), na ordem em que foram adicionadas. */
export interface Playlist {
  id: string
  name: string
  hashes: string[]
}

export interface ExportTarget {
  id: string
  wavPath: string
}

export interface ExportResult {
  wavPath: string
  tracklistPath: string
  bytes: number
}

/**
 * De onde vem o yt-dlp: `env` é DJMIXER_YTDLP, `system` é um já instalado (PATH, Homebrew) e
 * `app` é o que o próprio app baixou para a pasta de dados.
 */
export type YtDlpStatus =
  | { state: 'checking' | 'installing' }
  | { state: 'ready'; path: string; source: 'env' | 'system' | 'app' }
  | { state: 'error'; error: string }

export interface HostApi {
  /** `web` é o servidor de desenvolvimento; `browser` é a versão web, sem servidor. */
  readonly kind: 'electron' | 'web' | 'browser'
  /** Abre o seletor de arquivos de áudio; devolve caminhos absolutos. */
  pickAudioFiles(): Promise<string[]>
  /** Calcula o hash, lê título e artista e registra na biblioteca. Não analisa. */
  importFiles(paths: string[]): Promise<{ entries: LibraryEntry[]; errors: string[] }>
  /**
   * Baixa o áudio de uma página (faixa ou playlist do SoundCloud, por exemplo) com o yt-dlp e
   * registra na biblioteca. Só existe no Electron e no servidor de desenvolvimento.
   */
  importFromUrl?(url: string): Promise<{ entries: LibraryEntry[]; errors: string[] }>
  /** Situação do yt-dlp (ver host/ytdlp.ts). Só existe no Electron e no servidor de desenvolvimento. */
  ytDlpStatus?(): Promise<YtDlpStatus>
  listLibrary(): Promise<LibraryEntry[]>
  /** Abre a pasta do arquivo da faixa no Finder (ou no gerenciador de arquivos), com ele marcado. */
  revealTrack?(hash: string): Promise<void>
  /**
   * Tira a faixa da biblioteca e das playlists. O arquivo do usuário fica onde está; o baixado
   * pelo "Importar de URL" é apagado, para um novo download não reaproveitar a versão antiga.
   */
  removeFromLibrary(hash: string): Promise<void>
  saveAnalysis(hash: string, analysis: TrackAnalysis, peaks: Uint8Array): Promise<void>
  saveEdits(hash: string, edits: UserEdits): Promise<void>
  /**
   * Capa da faixa em JPEG pequeno (a embutida no arquivo ou a baixada junto pelo "Importar de
   * URL"), ou null se não há. Opcional: a versão web não tem ffmpeg para extrair.
   */
  getCover?(hash: string): Promise<Uint8Array | null>
  /** Formato, bitrate, taxa de amostragem e tamanho do arquivo; null se não achou o arquivo. */
  getAudioInfo?(hash: string): Promise<AudioInfo | null>
  listPlaylists(): Promise<Playlist[]>
  /** Cria ou substitui a playlist inteira. */
  savePlaylist(playlist: Playlist): Promise<void>
  deletePlaylist(id: string): Promise<void>
  /** Picos da waveform (ver src/waveform.ts), ou null se a faixa não foi analisada. */
  getPeaks(hash: string): Promise<Uint8Array | null>
  /**
   * Garante que as faixas de um projeto aberto estão na biblioteca, procurando pelo hash se o
   * caminho mudou. Devolve a entrada de cada uma, ou null se o arquivo não foi achado.
   */
  resolveTracks(tracks: { hash: string; path: string }[]): Promise<(LibraryEntry | null)[]>
  /** Pede ao usuário o novo lugar de uma faixa e confere o hash. */
  locateTrack(hash: string): Promise<LibraryEntry | null>
  /**
   * URL do áudio decodificado (PCM float 32 bits, estéreo intercalado, 44,1 kHz, sem cabeçalho)
   * ou de um buffer esticado guardado no cache.
   */
  mediaUrl(kind: 'decoded' | 'stretched', key: string): string
  /** Lê o mesmo conteúdo de `mediaUrl` sem passar por URL (versão web); null se não existe. */
  readMedia?(kind: 'decoded' | 'stretched', key: string): Promise<ArrayBuffer | null>
  saveStretched(key: string, data: Uint8Array): Promise<void>
  openProject(): Promise<{ path: string; json: string } | null>
  /** Salva no caminho dado ou, sem caminho, pergunta onde. Devolve o caminho usado. */
  saveProject(path: string | null, json: string, suggestedName: string): Promise<string | null>
  /** Pergunta onde salvar o WAV e abre o arquivo para escrita em partes. */
  exportBegin(suggestedName: string): Promise<ExportTarget | null>
  exportChunk(id: string, pcm: Uint8Array): Promise<void>
  /** Fecha o WAV regravando o cabeçalho (com o tamanho final) e salva a tracklist ao lado. */
  exportEnd(id: string, header: Uint8Array, tracklist: string): Promise<ExportResult>
  exportAbort(id: string): Promise<void>
}

export const SAMPLE_RATE = 44100
export const CHANNELS = 2
