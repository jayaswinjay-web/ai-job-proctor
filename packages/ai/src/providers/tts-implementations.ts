import type { TextToSpeechProvider, TtsAudio, TtsSynthesizeOptions } from './tts.js';
import { httpRequest } from '../http.js';

/**
 * Silent placeholder used by automated tests and by demo mode when the client
 * cannot synthesise locally. Produces a valid, silent WAV so downstream code
 * that expects real audio bytes keeps working.
 */
export class MockTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = 'mock';
  readonly isMock = true;
  readonly runsInBrowser = false;

  async synthesize(text: string, _options: TtsSynthesizeOptions): Promise<TtsAudio> {
    const bytesPerSecond = 8000;
    const seconds = Math.min(30, Math.max(0.4, (text.length / 14) / 1));
    return {
      audio: silentWav(Math.round(seconds * bytesPerSecond), bytesPerSecond),
      contentType: 'audio/wav',
      provider: this.name,
      local: false,
    };
  }

  async health() {
    return { ok: true, detail: 'mock TTS (silent wav)' };
  }
}

/** Builds a valid mono 8 kHz 8-bit PCM WAV containing silence. */
export function silentWav(dataBytes: number, sampleRate = 8000): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.alloc(dataBytes, 0x80)]);
}

/* -------------------------------------------------------------------------- */

export interface OpenAiTtsConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  voice?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

interface OpenAiAudioResponse {
  data?: Array<{ b64_json?: string }>;
}

/** OpenAI text-to-speech. Supports the newer `gpt-4o-mini-tts` models. */
export class OpenAiTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = 'openai';
  readonly isMock = false;
  readonly runsInBrowser = false;

  constructor(private readonly config: OpenAiTtsConfig) {}

  async synthesize(text: string, options: TtsSynthesizeOptions): Promise<TtsAudio> {
    const base = (this.config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const data = await httpRequest<OpenAiAudioResponse>({
      url: `${base}/audio/speech`,
      headers: { authorization: `Bearer ${this.config.apiKey}` },
      body: {
        model: this.config.model ?? 'gpt-4o-mini-tts',
        voice: this.config.voice ?? 'alloy',
        input: text,
        response_format: 'mp3',
        speed: Math.min(1.5, Math.max(0.25, options.rate ?? 1)),
      },
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries,
      signal: options.signal,
    });

    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI TTS returned no audio data');
    return { audio: Buffer.from(b64, 'base64'), contentType: 'audio/mpeg', provider: this.name, local: false };
  }

  async health() {
    return this.config.apiKey ? { ok: true } : { ok: false, detail: 'AI_API_KEY not configured' };
  }
}

/* -------------------------------------------------------------------------- */

export interface ElevenLabsConfig {
  apiKey: string;
  baseUrl?: string;
  voiceId?: string;
  modelId?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

/** ElevenLabs — used where a consistent branded voice matters across languages. */
export class ElevenLabsTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = 'elevenlabs';
  readonly isMock = false;
  readonly runsInBrowser = false;

  constructor(private readonly config: ElevenLabsConfig) {}

  async synthesize(text: string, options: TtsSynthesizeOptions): Promise<TtsAudio> {
    const base = (this.config.baseUrl ?? 'https://api.elevenlabs.io/v1').replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 30_000);
    try {
      const res = await fetch(`${base}/text-to-speech/${this.config.voiceId ?? '21m00Tcm4TlvDq8ikWAM'}`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.config.apiKey,
          'content-type': 'application/json',
          accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: this.config.modelId ?? 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: Math.min(1.5, Math.max(0.6, options.rate ?? 1)),
          },
        }),
        signal: options.signal ?? controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`ElevenLabs TTS failed (${res.status}): ${body.slice(0, 300)}`);
      }
      return {
        audio: Buffer.from(await res.arrayBuffer()),
        contentType: 'audio/mpeg',
        provider: this.name,
        local: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async health() {
    return this.config.apiKey ? { ok: true } : { ok: false, detail: 'AI_API_KEY not configured' };
  }
}

/* -------------------------------------------------------------------------- */

export interface GoogleTtsConfig {
  apiKey: string;
  baseUrl?: string;
  voiceName?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

interface GoogleTtsResponse {
  audioContent?: string;
}

/** Google Cloud Text-to-Speech, which has the broadest Indic voice coverage. */
export class GoogleTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = 'google';
  readonly isMock = false;
  readonly runsInBrowser = false;

  constructor(private readonly config: GoogleTtsConfig) {}

  async synthesize(text: string, options: TtsSynthesizeOptions): Promise<TtsAudio> {
    const base = (this.config.baseUrl ?? 'https://texttospeech.googleapis.com/v1').replace(/\/$/, '');
    const locale = options.locale ?? `${options.language}-IN`;
    const data = await httpRequest<GoogleTtsResponse>({
      url: `${base}/text:synthesize`,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.config.apiKey },
      body: {
        input: { text },
        voice: {
          languageCode: locale.split('-')[0]!.toUpperCase(),
          name: this.config.voiceName ?? defaultGoogleVoice(locale),
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: Math.min(4, Math.max(0.25, options.rate ?? 1)),
          pitch: options.pitch ?? 0,
          volumeGainDb: Math.round(((options.volume ?? 1) - 1) * 16),
        },
      },
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries,
      signal: options.signal,
    });
    if (!data.audioContent) throw new Error('Google TTS returned no audioContent');
    return {
      audio: Buffer.from(data.audioContent, 'base64'),
      contentType: 'audio/mpeg',
      provider: this.name,
      local: false,
    };
  }

  async health() {
    return this.config.apiKey ? { ok: true } : { ok: false, detail: 'AI_API_KEY not configured' };
  }
}

function defaultGoogleVoice(locale: string): string {
  const table: Record<string, string> = {
    en: 'en-IN-Neural2-A',
    hi: 'hi-IN-Neural2-A',
    mr: 'mr-IN-Neural2-A',
  };
  return table[locale.split('-')[0]!] ?? `${locale.split('-')[0]}-IN-Standard-A`;
}