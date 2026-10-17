import type { LlmMessage, LlmProvider, LlmRequest, LlmResponse } from './llm.js';
import { httpRequest } from '../http.js';

export interface OpenAiCompatibleConfig {
  apiKey: string;
  /**
   * Supplies the bearer token for each request. Overrides `apiKey` when set.
   *
   * Needed for gateways whose credentials expire (LiveKit Inference mints a short-lived
   * JWT per request) so a long-running process never authenticates with a stale token.
   */
  apiKeyProvider?: () => string | Promise<string>;
  baseUrl: string;
  defaultModel: string;
  timeoutMs?: number;
  maxRetries?: number;
  providerName?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Works with OpenAI itself and every API that speaks the same
 * `/chat/completions` shape (vLLM, Groq, Together, LM Studio, llama.cpp server,
 * Azure OpenAI when given its deployment base URL).
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;
  readonly defaultModel: string;
  readonly isMock = false;
  private readonly config: OpenAiCompatibleConfig;

  constructor(config: OpenAiCompatibleConfig) {
    this.config = config;
    this.name = config.providerName ?? 'openai-compatible';
    this.defaultModel = config.defaultModel;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const payload: Record<string, unknown> = {
      model: request.model ?? this.defaultModel,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 1400,
    };
    if (request.responseSchema) {
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          strict: true,
          schema: request.responseSchema,
        },
      };
    }

    const bearer = this.config.apiKeyProvider ? await this.config.apiKeyProvider() : this.config.apiKey;
    const data = await httpRequest<ChatCompletionResponse>({
      url: `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`,
      headers: { authorization: `Bearer ${bearer}` },
      body: payload,
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries,
      signal: request.signal,
    });

    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? '',
      finishReason: choice?.finish_reason,
      usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
      provider: this.name,
      model: String(payload.model),
      latencyMs: Date.now() - started,
    };
  }

  async health() {
    if (!this.config.apiKey && !this.config.apiKeyProvider) return { ok: false, detail: 'AI_API_KEY not configured' };
    return { ok: true };
  }
}

/* -------------------------------------------------------------------------- */

export interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
  timeoutMs?: number;
  maxRetries?: number;
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Anthropic Messages API. System content is passed through the dedicated
 * `system` field, which reinforces that untrusted data never occupies the
 * instruction channel.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly defaultModel: string;
  readonly isMock = false;

  constructor(private readonly config: AnthropicConfig) {
    this.defaultModel = config.defaultModel;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const messages: LlmMessage[] = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: request.model ?? this.defaultModel,
      max_tokens: request.maxTokens ?? 1400,
      messages,
    };
    if (system) body.system = system;
    if (request.responseSchema) {
      // Anthropic has no JSON-schema mode; the prompt carries the schema and
      // the caller parses defensively.
      body.temperature = request.temperature ?? 0.2;
    } else if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    const data = await httpRequest<AnthropicResponse>({
      url: `${(this.config.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/$/, '')}/messages`,
      headers: {
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries,
      signal: request.signal,
    });

    const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    return {
      text,
      finishReason: data.stop_reason,
      usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens },
      provider: this.name,
      model: request.model ?? this.defaultModel,
      latencyMs: Date.now() - started,
    };
  }

  async health() {
    return this.config.apiKey ? { ok: true } : { ok: false, detail: 'AI_API_KEY not configured' };
  }
}

/* -------------------------------------------------------------------------- */

export interface OllamaConfig {
  baseUrl: string;
  defaultModel: string;
  timeoutMs?: number;
  maxRetries?: number;
}

interface OllamaResponse {
  message?: { content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Fully local inference — the deployment path for sites with no internet. */
export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';
  readonly defaultModel: string;
  readonly isMock = false;

  constructor(private readonly config: OllamaConfig) {
    this.defaultModel = config.defaultModel;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const data = await httpRequest<OllamaResponse>({
      url: `${this.config.baseUrl.replace(/\/$/, '')}/api/chat`,
      method: 'POST',
      headers: {},
      body: {
        model: request.model ?? this.defaultModel,
        messages: request.messages,
        stream: false,
        format: request.responseSchema ? 'json' : undefined,
        options: {
          temperature: request.temperature ?? 0.2,
          num_predict: request.maxTokens ?? 1400,
        },
      },
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries,
      signal: request.signal,
    });

    return {
      text: data.message?.content ?? '',
      finishReason: data.done_reason,
      usage: { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count },
      provider: this.name,
      model: request.model ?? this.defaultModel,
      latencyMs: Date.now() - started,
    };
  }

  async health() {
    try {
      const res = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return { ok: res.ok, detail: res.ok ? undefined : `status ${res.status}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}