import type { Side } from './hand-tracking.js';

/** One finished session, as saved on this device. */
export interface SessionRecord {
  /** Milliseconds since the epoch. */
  at: number;
  /** Which hand led (the one that moves more easily). */
  lead: Side;
  /**
   * How far the other hand opened and closed, as a fraction of the lead
   * hand's range. Null when that hand was not seen during "your turn".
   */
  range: number | null;
}

interface Saved {
  version: 1;
  lead: Side | null;
  sessions: SessionRecord[];
}

const KEY = 'mirror-hand.v1';
const MAX_SESSIONS = 400;

/**
 * Progress lives only in this browser's local storage. Nothing is sent
 * anywhere; there is no account and no server.
 */
export class Store {
  private data: Saved = { version: 1, lead: null, sessions: [] };

  constructor() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Saved;
        if (parsed && parsed.version === 1 && Array.isArray(parsed.sessions)) {
          this.data = parsed;
        }
      }
    } catch {
      // Private browsing or blocked storage: carry on without saving.
    }
  }

  get lead(): Side | null {
    return this.data.lead;
  }

  get sessions(): readonly SessionRecord[] {
    return this.data.sessions;
  }

  add(record: SessionRecord): void {
    this.data.lead = record.lead;
    this.data.sessions.push(record);
    if (this.data.sessions.length > MAX_SESSIONS) {
      this.data.sessions.splice(0, this.data.sessions.length - MAX_SESSIONS);
    }
    this.save();
  }

  clear(): void {
    this.data = { version: 1, lead: null, sessions: [] };
    this.save();
  }

  /** Number of different calendar days with at least one session. */
  get days(): number {
    const seen = new Set<string>();
    for (const session of this.data.sessions) {
      seen.add(new Date(session.at).toDateString());
    }
    return seen.size;
  }

  private save(): void {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Ignore: the session still works, it just is not remembered.
    }
  }
}
