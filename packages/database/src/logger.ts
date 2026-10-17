/**
 * Structured, PII-safe logger.
 *
 * Rules enforced here:
 *  * Never serialise raw candidate audio, transcripts or answers into logs.
 *  * Any key that looks like candidate content or a secret is redacted.
 *  * Every log line carries an errorId so a candidate-facing message can be traced
 *    to a developer log line without exposing the trace to the candidate.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACTED_KEYS = new Set([
  'transcript',
  'normalizedtext',
  'interpretation',
  'answer',
  'answertext',
  'content',
  'prompt',
  'apikey',
  'api_key',
  'authorization',
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'tokenhash',
  'token_hash',
  'refreshtoken',
  'secret',
  'totpsecret',
  'totp_secret',
  'snapshotbase64',
  'audio',
  'objectkey',
  'uploadurl',
  'cookie',
  'email',
  'phone',
  'name',
  'candidateid',
]);

const REDACTED = '[redacted]';

export interface LoggerFields {
  [key: string]: unknown;
}

export interface Logger {
  isProduction: boolean;
  databaseUrl: string;
  child(bindings: LoggerFields): Logger;
  debug(message: string, fields?: LoggerFields): void;
  info(message: string, fields?: LoggerFields): void;
  warn(message: string, fields?: LoggerFields): void;
  error(message: string, fields?: LoggerFields): void;
  childWithErrorId(errorId: string, bindings?: LoggerFields): Logger;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack?.split('\n').slice(0, 6).join('\n') };
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(k.toLowerCase())) {
        out[k] = REDACTED;
        continue;
      }
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 512) return `${value.slice(0, 512)}…[truncated]`;
  return value;
}

export interface CreateLoggerOptions {
  level?: LogLevel;
  isProduction: boolean;
  databaseUrl: string;
  service: string;
  bindings?: LoggerFields;
  sink?: (line: string) => void;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const { level = 'info', isProduction, databaseUrl, service, bindings = {}, sink } = options;
  const write = sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const threshold = LEVEL_WEIGHT[level];

  function emit(lvl: LogLevel, message: string, fields?: LoggerFields): void {
    if (LEVEL_WEIGHT[lvl] < threshold) return;
    const record = {
      ts: new Date().toISOString(),
      level: lvl,
      service,
      msg: message,
      ...(redact({ ...bindings, ...fields }) as LoggerFields),
    };
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({ ts: record.ts, level: lvl, service, msg: message, note: 'serialisation_failed' });
    }
    write(line);
  }

  const logger: Logger = {
    isProduction,
    databaseUrl,
    child(extra: LoggerFields) {
      return createLogger({ level, isProduction, databaseUrl, service, bindings: { ...bindings, ...extra }, sink });
    },
    childWithErrorId(errorId: string, extra: LoggerFields = {}) {
      return logger.child({ errorId, ...extra });
    },
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
  return logger;
}

let counter = 0;
/** Short, non-guessable-per-session id used to correlate a candidate message with server logs. */
export function newErrorId(): string {
  counter = (counter + 1) % 1_679_616;
  const stamp = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 1_679_616).toString(36);
  return `E${stamp}${counter.toString(36)}${rand}`.slice(0, 18).toUpperCase();
}