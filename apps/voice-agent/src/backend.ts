/**
 * VoiceHire backend client for the cloud voice agent.
 *
 * All interview data (jobs, questions, scoring, transcripts, consent, proctoring) lives in
 * the VoiceHire backend — the agent only *conducts* the conversation. These calls are
 * authenticated with the shared AGENT_API_KEY and never expose anything in the admin
 * surface.
 */

export interface AgentConfig {
  apiUrl: string;
  agentKey: string;
}

export interface JobOption {
  id: string;
  title: string;
  description: string;
}

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string | null;
  sttLocale: string | null;
  ttsVoiceHint: string | null;
}

export interface IntakeContext {
  defaultLanguage: string;
  supportedLanguages: string[];
  privacyNoticeRequired: boolean;
  jurisdictionNote: string;
  jobs: JobOption[];
  languages: LanguageOption[];
}

export interface Directive {
  text: string;
  phraseKey?: string;
  emotion: string;
  displayText: string | null;
  slowRate: boolean;
  sequence: number;
}

export interface TurnPayload {
  state: string;
  stage: string;
  directives: Directive[];
  progress: { answered: number; total: number; stage: string; label: string | null };
  terminal: 'COMPLETED' | 'FAILED' | 'CANCELLED' | null;
  stepAbandoned: boolean;
}

export interface SessionCreated {
  sessionId: string;
  publicId: string;
  sessionSecret: string;
  languageCode: string;
  totalQuestions: number;
  jobTitle: string;
  state: string;
}

export class VoiceHireBackend {
  constructor(private readonly config: AgentConfig) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.config.apiUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.agentKey}`,
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`VoiceHire ${init.method ?? 'GET'} ${path} failed (${res.status}): ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  /** Jobs, languages and consent wording for the pre-interview intake conversation. */
  getIntakeContext(): Promise<IntakeContext> {
    return this.request<IntakeContext>('/agent/context');
  }

  /** Creates the interview session once job + language are chosen by voice. */
  createSession(input: {
    roomName: string;
    jobId: string;
    languageCode: string;
    consentGiven?: boolean;
  }): Promise<SessionCreated> {
    return this.request<SessionCreated>('/agent/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  getSessionContext(publicId: string): Promise<Record<string, unknown>> {
    return this.request(`/agent/sessions/${publicId}/context`);
  }

  consent(publicId: string, given: boolean): Promise<TurnPayload> {
    return this.request<TurnPayload>(`/agent/sessions/${publicId}/consent`, {
      method: 'POST',
      body: JSON.stringify({ given }),
    });
  }

  changeLanguage(publicId: string, languageCode: string): Promise<TurnPayload> {
    return this.request<TurnPayload>(`/agent/sessions/${publicId}/language`, {
      method: 'POST',
      body: JSON.stringify({ languageCode }),
    });
  }

  turn(
    publicId: string,
    input: { transcript: string; spokenLanguage?: string | null; confidence?: number; durationMs?: number },
  ): Promise<TurnPayload> {
    return this.request<TurnPayload>(`/agent/sessions/${publicId}/turns`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  advance(publicId: string): Promise<TurnPayload> {
    return this.request<TurnPayload>(`/agent/sessions/${publicId}/advance`, { method: 'POST', body: '{}' });
  }

  finish(publicId: string): Promise<{ completed: boolean; revealScore: boolean; resetDelaySeconds: number }> {
    return this.request(`/agent/sessions/${publicId}/finish`, { method: 'POST', body: '{}' });
  }

  /** Records this agent instance so the admin console can show live status. */
  recordAgentSession(publicId: string, input: { voiceAgentSessionId: string; roomName: string }): Promise<unknown> {
    return this.request(`/agent/sessions/${publicId}/agent-session`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const apiUrl = env.VOICEHIRE_API_URL ?? 'http://localhost:4000/api/v1';
  const agentKey = env.AGENT_API_KEY ?? '';
  if (!agentKey) {
    throw new Error('AGENT_API_KEY is not set; the agent cannot authenticate to the VoiceHire backend.');
  }
  return { apiUrl, agentKey };
}
