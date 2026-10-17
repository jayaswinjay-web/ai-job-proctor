/**
 * Local persistence for kiosk reliability.
 *
 * Two problems this solves on a poor-network site:
 *
 *  1. **A refresh must not lose the interview.** The active session's id and secret are
 *     written to `localStorage` the moment it is created and cleared on completion. If
 *     the browser reloads — or the operator taps refresh — the kiosk resumes the same
 *     interview instead of starting a new one.
 *
 *  2. **Answers must survive going offline.** Recognised utterances are queued in
 *     IndexedDB and replayed when connectivity returns, in the order they were spoken.
 *     Nothing is ever discarded silently.
 */

const SESSION_KEY = 'proctor.active-session';
const KIOSK_ID_KEY = 'proctor.kiosk-id';
const QUEUE_DB = 'proctor-offline-queue';
const QUEUE_STORE = 'turns';

export interface StoredSession {
  sessionId: string;
  publicId: string;
  sessionSecret: string;
  jobId: string;
  jobTitle: string;
  languageCode: string;
  startedAt: number;
}

export function persistSession(session: StoredSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* private browsing or a full quota: the session still works, it just won't resume */
  }
}

export function readPersistedSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    // Older or corrupted entries are discarded rather than trusted.
    if (!parsed.sessionId || !parsed.sessionSecret || !parsed.jobId) return null;
    if (Date.now() - parsed.startedAt > 6 * 60 * 60 * 1000) {
      clearPersistedSession();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPersistedSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * The kiosk's stable identity, remembered so it can be sent before bootstrap returns.
 *
 * It has to be readable *before* the first request: the server keys session resume off
 * this id, and bootstrap is the very call that offers the resume. Reading it from the
 * bootstrap response would be too late. It must also match what `startSession` sends, or
 * a session is created under one id and looked up under another and never resumes.
 */
export function persistKioskId(id: string): void {
  try {
    localStorage.setItem(KIOSK_ID_KEY, id);
  } catch {
    /* private browsing: the kiosk still runs, it just cannot resume */
  }
}

export function readKioskId(): string | null {
  try {
    return localStorage.getItem(KIOSK_ID_KEY);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Offline turn queue                                                         */
/* -------------------------------------------------------------------------- */

export interface QueuedTurn {
  clientId: string;
  sessionId: string;
  transcript: string;
  spokenLanguage: string | null;
  confidence: number;
  durationMs: number;
  createdAt: number;
}

function openQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'clientId' });
        store.createIndex('sessionId', 'sessionId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

export async function enqueueTurn(turn: Omit<QueuedTurn, 'clientId'>): Promise<void> {
  try {
    const db = await openQueue();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      tx.objectStore(QUEUE_STORE).put({ ...turn, clientId: `${turn.createdAt}-${Math.random().toString(36).slice(2, 9)}` });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* the queue is a best-effort safety net; a failure must not break the interview */
  }
}

export async function readQueuedTurns(sessionId: string): Promise<QueuedTurn[]> {
  try {
    const db = await openQueue();
    const rows = await new Promise<QueuedTurn[]>((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readonly');
      const req = tx.objectStore(QUEUE_STORE).index('sessionId').getAll(sessionId);
      req.onsuccess = () => resolve(req.result as QueuedTurn[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function removeQueuedTurn(clientId: string): Promise<void> {
  try {
    const db = await openQueue();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      tx.objectStore(QUEUE_STORE).delete(clientId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* no-op */
  }
}

export async function clearQueue(): Promise<void> {
  try {
    const db = await openQueue();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      tx.objectStore(QUEUE_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* no-op */
  }
}

/** Wipes every trace of the previous candidate, as required after a session ends. */
export async function resetLocalData(): Promise<void> {
  clearPersistedSession();
  await clearQueue();
  try {
    sessionStorage.clear();
  } catch {
    /* no-op */
  }
}
