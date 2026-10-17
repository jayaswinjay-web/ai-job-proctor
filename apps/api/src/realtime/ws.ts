import type { FastifyInstance } from 'fastify';
import { clientWsMessageSchema, type ClientWsMessage, type ServerWsMessage } from '@proctor/types';
import { AppError } from '../lib/errors.js';
import type { Services } from '../services/registry.js';
import type { Container } from '../container.js';
import type { EngineDirective } from '../services/interview-engine.js';

/**
 * Live interview channel.
 *
 * Why a WebSocket
 * ---------------
 * A kiosk interview is a conversation. Round-tripping every utterance over HTTP adds
 * latency between the candidate finishing a sentence and hearing the next question,
 * which is exactly the delay that makes a spoken interface feel robotic. The socket
 * carries the turn, and the server pushes an ordered list of directives to speak.
 *
 * Protocol
 * --------
 * Client → server: `{ type: "voice_turn" | "advance" | "consent" | ... }`
 * Server → client: `{ type: "speak" | "listen" | "progress" | "state" | ... }`
 *
 * Design constraints that matter more than throughput here:
 *  * **Ordering.** Directives carry a monotonically increasing `sequence`, and the server
 *    serialises turns per session. A candidate cannot hear two questions at once.
 *  * **Barge-in.** A new turn cancels whatever the client is speaking. The client is
 *    responsible for stopping audio immediately; the server only needs to not queue.
 *  * **Backpressure.** If a client falls behind, the oldest pending `speak` is dropped
 *    rather than queued. A stale question is worse than no question.
 *  * **Recovery.** A reconnect replays the welcome plus the current question, so a kiosk
 *    that loses its socket mid-session does not have to restart the candidate.
 */

interface RouteDeps {
  container: Container;
  services: Services;
}

interface SocketState {
  sessionId: string | null;
  publicId: string | null;
  secret: string | null;
  /** Serialises turn handling so directives can never interleave. */
  queue: Promise<void>;
  connectedAt: number;
  turnsHandled: number;
}

export default async function registerRealtime(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { container, services } = deps;
  const base = container.env.API_BASE_PATH;

  await app.register(async (instance) => {
    instance.get('/kiosk/interview', { websocket: true }, (socket, req) => {
      const state: SocketState = {
        sessionId: null,
        publicId: null,
        secret: null,
        queue: Promise.resolve(),
        connectedAt: Date.now(),
        turnsHandled: 0,
      };

      const send = (message: ServerWsMessage): void => {
        try {
          socket.send(JSON.stringify(message));
        } catch (err) {
          container.logger.debug('ws_send_failed', { err });
        }
      };

      const fail = (message: string, code = 'INTERNAL_ERROR'): void => {
        send({ type: 'failed', reason: code, userMessage: message, errorId: null });
      };

      container.logger.info('ws_opened', { ip: req.ip });

      socket.on('message', (raw: Buffer) => {
        const text = raw.toString('utf8');
        if (text.length > 64_000) {
          fail('The message was too large.');
          return;
        }

        let parsed: ClientWsMessage;
        try {
          const json = JSON.parse(text);
          const result = clientWsMessageSchema.safeParse(json);
          if (!result.success) {
            container.logger.warn('ws_invalid_message', { issues: result.error.issues.slice(0, 3) });
            fail('The message could not be read.', 'VALIDATION_ERROR');
            return;
          }
          parsed = result.data;
        } catch {
          fail('The message could not be read.', 'VALIDATION_ERROR');
          return;
        }

        // Serialise all state-mutating work.
        state.queue = state.queue
          .then(() => handleMessage(parsed, state, send, fail))
          .catch((err: unknown) => {
            const appError = err instanceof AppError ? err : AppError.internal('Unexpected error', err);
            container.logger.error('ws_handler_failed', {
              sessionId: state.sessionId,
              code: appError.code,
              err,
            });
            send({
              type: 'failed',
              reason: appError.code,
              userMessage: appError.userMessage,
              errorId: appError.statusCode >= 500 ? appError.errorId : null,
            });
          });
      });

      socket.on('close', () => {
        container.logger.info('ws_closed', {
          sessionId: state.sessionId,
          turnsHandled: state.turnsHandled,
          durationMs: Date.now() - state.connectedAt,
        });
      });

      socket.on('error', (err) => {
        container.logger.debug('ws_error', { sessionId: state.sessionId, err });
      });

      async function handleMessage(
        message: ClientWsMessage,
        socketState: SocketState,
        emit: (m: ServerWsMessage) => void,
        emitFail: (m: string, c?: string) => void,
      ): Promise<void> {
        if (message.type === 'ping') {
          emit({ type: 'pong', at: message.at });
          return;
        }

        if (message.type === 'hello') {
          const settings = await container.settings.get();
          socketState.sessionId = message.sessionId;
          socketState.publicId = message.publicId;

          const loaded = await services.sessions.loadState(message.sessionId);
          if (!loaded) {
            emitFail('This session could not be found. Please start again.', 'SESSION_EXPIRED');
            socket.close();
            return;
          }
          if (loaded.isLocked && loaded.state.state === 'COMPLETED') {
            emit({ type: 'completed', sessionId: message.sessionId, message: 'interview_complete' });
            return;
          }

          services.sessions.resetSettingsCache();
          const state = loaded.state;

          emit({
            type: 'session_started',
            sessionId: message.sessionId,
            publicId: message.publicId,
            state: state.state,
            languageCode: state.languageCode,
          });
          emit({ type: 'state', state: state.state as never, stageKind: state.stageKind });

          const session = await container.prisma.interviewSession.findUnique({
            where: { id: message.sessionId },
            select: { stageKind: true, jobId: true, engineState: true },
          });

          const resume = message.resume && !isAwaitingConsent(state.state);
          if (resume) {
            // Replay the current position so the candidate hears where they are.
            const directives = await services.sessions.buildEngineForResumption(state, session?.jobId);
            for (const directive of directives) emitDirective(emit, directive);
            emit({
              type: 'progress',
              index: progressOf(state).answered,
              total: progressOf(state).total,
              stage: state.stageKind,
              label: progressOf(state).answered > 0 ? `Question ${progressOf(state).answered} of ${progressOf(state).total}` : null,
            });
            emit({ type: 'listen', hint: null, retriesRemaining: 0 });
          } else {
            const directives = await services.sessions.buildEngineForResumption(state, session?.jobId);
            for (const directive of directives) emitDirective(emit, directive);
            emit({ type: 'listen', hint: null, retriesRemaining: 0 });
          }

          container.logger.info('ws_session_attached', {
            sessionId: message.sessionId,
            resume,
            languageCode: state.languageCode,
            retryLimit: settings.interview.retryLimit,
          });
          return;
        }

        const sessionId = socketState.sessionId;
        if (!sessionId) {
          emitFail('No session is attached. Reconnect and send hello.', 'VALIDATION_ERROR');
          return;
        }

        switch (message.type) {
          case 'voice_turn': {
            socketState.turnsHandled += 1;
            services.sessions.resetSettingsCache();
            await services.sessions.assertWithinTimeBudget(sessionId);
            const result = await services.sessions.handleVoiceTurn(sessionId, {
              transcript: message.transcript.slice(0, 4000),
              spokenLanguage: message.spokenLanguage,
              confidence: message.confidence,
              durationMs: message.durationMs,
            });

            for (const directive of result.directives) emitDirective(emit, directive);

            for (const record of result.records) {
              emit({
                type: 'transcript',
                answerId: `${sessionId}:${record.stepKey}:${record.attempt}`,
                text: record.transcript,
                isFinal: true,
              });
              if (record.interpretation) {
                emit({
                  type: 'understood',
                  answerId: `${sessionId}:${record.stepKey}:${record.attempt}`,
                  interpretation: record.interpretation,
                  confidence: record.sttConfidence,
                });
              }
            }

            for (const item of result.eligibility) {
              emit({ type: 'eligibility', requirement: item.requirement, passed: item.passed, message: item.message });
            }

            emit({
              type: 'progress',
              index: result.progress.answered,
              total: result.progress.total,
              stage: result.progress.stage,
              label: result.progress.label,
            });
            emit({ type: 'state', state: result.state.state as never, stageKind: result.state.stageKind });

            if (result.meta.isCommand) {
              emit({ type: 'command', command: result.meta.command as never });
            }
            if (result.meta.retryKind) {
              emit({
                type: 'retry',
                attempt: (result.state.retries[`question:${result.state.stepIndex}`] ?? 0) + 1,
                maxRetries: 3,
                kind: result.meta.retryKind === 'CONFIDENCE' ? 'CONFIDENCE' : 'UNINTELLIGIBLE',
              });
            }
            if (result.stepAbandoned) {
              emit({ type: 'system_say', text: 'take_your_time', kind: 'info' });
            }

            if (!result.terminal) {
              emit({
                type: 'listen',
                hint: null,
                ...(result.meta.retriesRemaining > 0 ? { retriesRemaining: result.meta.retriesRemaining } : {}),
              });
            }

            if (result.terminal === 'COMPLETED') {
              const settings = await container.settings.get();
              emit({
                type: 'completed',
                sessionId,
                message: 'interview_complete',
              });
              emit({
                type: 'system_say',
                text: settings.interview.discloseScoreToCandidate ? 'interview_complete' : 'score_not_disclosed',
                kind: 'info',
              });
            } else if (result.terminal === 'CANCELLED') {
              emit({ type: 'system_say', text: 'goodbye', kind: 'info' });
            }
            return;
          }

          case 'advance': {
            services.sessions.resetSettingsCache();
            const result = await services.sessions.advance(sessionId);
            for (const directive of result.directives) emitDirective(emit, directive);
            emit({ type: 'progress', index: result.progress.answered, total: result.progress.total, stage: result.progress.stage, label: result.progress.label });
            emit({ type: 'state', state: result.state.state as never, stageKind: result.state.stageKind });
            if (result.terminal === 'COMPLETED') {
              emit({ type: 'completed', sessionId, message: 'interview_complete' });
            } else {
              emit({ type: 'listen', hint: null, retriesRemaining: 0 });
            }
            return;
          }

          case 'skip': {
            services.sessions.resetSettingsCache();
            const result = await services.sessions.advance(sessionId);
            for (const directive of result.directives) emitDirective(emit, directive);
            emit({ type: 'listen', hint: null, retriesRemaining: 0 });
            return;
          }

          case 'consent': {
            services.sessions.resetSettingsCache();
            const result = await services.sessions.recordConsent(sessionId, message.given);
            for (const directive of result.directives) emitDirective(emit, directive);
            emit({ type: 'state', state: result.state.state as never, stageKind: result.state.stageKind });
            if (result.terminal) {
              emit({ type: 'system_say', text: 'consent_declined_end', kind: 'info' });
            } else {
              emit({ type: 'listen', hint: null, retriesRemaining: 0 });
            }
            return;
          }

          case 'select_language': {
            services.sessions.resetSettingsCache();
            const result = await services.sessions.changeLanguage(sessionId, message.languageCode);
            for (const directive of result.directives) emitDirective(emit, directive);
            emit({ type: 'state', state: result.state.state as never, stageKind: result.state.stageKind });
            emit({ type: 'listen', hint: null, retriesRemaining: 0 });
            return;
          }

          case 'select_job': {
            // A job change mid-session is not supported: the plan is fixed at start so
            // the question set stays coherent and reproducible.
            emitFail('The job cannot be changed during an interview. Please finish and start again.', 'VALIDATION_ERROR');
            return;
          }

          case 'set_detail': {
            const loaded = await services.sessions.loadState(sessionId);
            if (!loaded) {
              emitFail('This session could not be found.', 'SESSION_EXPIRED');
              return;
            }
            await services.sessions.setDetail(sessionId, message.key, message.value);
            emit({ type: 'understood', answerId: `${sessionId}:detail:${message.key}`, interpretation: message.value, confidence: 0.9 });
            return;
          }

          case 'finish': {
            services.sessions.resetSettingsCache();
            await services.sessions.finaliseSession(sessionId);
            const settings = await container.settings.get();
            emit({
              type: 'completed',
              sessionId,
              message: settings.interview.discloseScoreToCandidate ? 'application_submitted' : 'score_not_disclosed',
            });
            return;
          }

          default: {
            emitFail('That message type is not supported.', 'VALIDATION_ERROR');
          }
        }
      }
    });
  }, { prefix: `${base}/ws` });

  container.logger.info('websocket_registered', { path: `${base}/ws/kiosk/interview` });
}

function emitDirective(emit: (m: ServerWsMessage) => void, directive: EngineDirective): void {
  if (directive.text.trim() === '') return;
  emit({
    type: 'speak',
    text: directive.text,
    emotion: directive.emotion,
    displayText: directive.displayText,
    ...(directive.slowRate ? { rate: 0.65 } : {}),
    sequence: directive.sequence,
  });
}

function isAwaitingConsent(state: string): boolean {
  return state === 'AWAITING_CONSENT' || state === 'CREATED';
}

function progressOf(state: { plan: { questions: unknown[] }; answers: Record<string, unknown> }) {
  const total = state.plan.questions.length;
  const answered = state.plan.questions.filter((q) => state.answers[`question:${(q as { key: string }).key}`]).length;
  return { answered, total };
}