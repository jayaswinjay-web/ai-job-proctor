import type { EngineTurnResult } from '../services/interview-engine.js';

/**
 * Serialises an engine turn result for a client.
 *
 * Shared by both HTTP surfaces (the Fastify app and the Cloudflare Worker) so the kiosk,
 * the cloud agent and the browser fallback all speak the same voice-protocol shape.
 */
export function toClientPayload(result: EngineTurnResult) {
  return {
    state: result.state.state,
    stage: result.state.stageKind,
    directives: result.directives
      .filter((d) => d.text.trim() !== '')
      .map((d) => ({
        text: d.text,
        ...(d.phraseKey ? { phraseKey: d.phraseKey } : {}),
        emotion: d.emotion,
        displayText: d.displayText,
        slowRate: d.slowRate,
        sequence: d.sequence,
      })),
    progress: result.progress,
    terminal: result.terminal,
    ...(result.recoveryNotice ? { recoveryNotice: result.recoveryNotice } : {}),
    stepAbandoned: result.stepAbandoned,
    meta: result.meta,
  };
}
