// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { describeAudio } from './quality.ts'

describe('qualidade da faixa', () => {
  it('descreve um AAC baixado do SoundCloud', () => {
    expect(
      describeAudio({
        container: 'mov,mp4,m4a,3gp,3g2,mj2',
        codec: 'aac',
        bitrateKbps: 160,
        sampleRate: 44100,
        bitDepth: null,
        channels: 2,
        bytes: 7_340_032,
        lossless: false,
      }),
    ).toEqual(['AAC', '160 kbps', '44,1 kHz', 'estéreo', '7,0 MB'])
  })

  it('descreve um WAV e marca bitrate estimado', () => {
    expect(
      describeAudio({
        container: 'wav',
        codec: 'pcm_s24le',
        bitrateKbps: 2117,
        sampleRate: 44100,
        bitDepth: 24,
        channels: 2,
        bytes: 52_428_800,
        lossless: true,
      }),
    ).toEqual(['PCM (WAV/AIFF)', '2117 kbps', '44,1 kHz', '24 bits', 'estéreo', '50,0 MB'])
    expect(
      describeAudio({
        container: 'mp3',
        codec: 'mp3',
        bitrateKbps: 320,
        sampleRate: null,
        bitDepth: null,
        channels: null,
        bytes: 1_048_576,
        lossless: false,
        estimated: true,
      }),
    ).toEqual(['MP3', '~320 kbps', '1,0 MB'])
  })
})
