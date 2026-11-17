import type { Side } from './hand-tracking.js';

/** The answer to "How did that feel?" at the end of a session. */
export type Comfort = 'fine' | 'sore' | 'painful';

/** -1 a shorter, nearer session; 0 the standard one; 1 a little more of each movement. */
export type Level = -1 | 0 | 1;

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
  // Everything below was added for tailoring and is absent on older records.
  /**
   * Per finger (index, middle, ring, little): how far the other hand's
   * finger opened and closed in "your turn", as a fraction of the lead
   * hand's same finger. Null for a finger, or the whole list, when it could
   * not be measured.
   */
  fingers?: (number | null)[] | null;
  /** Steps that moved on by themselves because no movement was seen. */
  stalls?: number;
  /** Activities ended with the Skip button. */
  skipped?: number;
  /** Null when the question was not answered. */
  comfort?: Comfort | null;
  /** The level the session ran at. */
  level?: Level;
  /** The finger that was given extra touches (0 index .. 3 little), if any. */
  focus?: number | null;
}

/** Choices made on the landing page, by the person or their therapist. */
export interface Settings {
  /** Off: every session is the standard one. */
  tailor: boolean;
  /** Always run the shorter, nearer session. */
  gentle: boolean;
  /** Movements to leave out of the session. */
  leaveOut: { bloom: boolean; chimes: boolean; reach: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  tailor: true,
  gentle: false,
  leaveOut: { bloom: false, chimes: false, reach: false },
};

interface Saved {
  version: 1;
  lead: Side | null;
  sessions: SessionRecord[];
  settings?: Settings;
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
    this.reload();
  }

  /**
   * Read what is saved again. The landing page and the session each hold a
   * Store, so the session re-reads before it starts: settings changed on the
   * page are picked up, and are not overwritten when the session saves.
   */
  reload(): void {
    // Start from empty, so history cleared elsewhere does not linger here.
    this.data = { version: 1, lead: null, sessions: [] };
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Saved;
        if (parsed && parsed.version === 1 && Array.isArray(parsed.sessions)) {
          // Drop anything that is not a record, so a damaged save still loads.
          parsed.sessions = parsed.sessions.filter(
            (session) => session !== null && typeof session === 'object',
          );
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

  /** A copy, with anything missing filled in from the defaults. */
  get settings(): Settings {
    const saved = this.data.settings;
    // Only a real true or false counts; anything else is the default.
    return {
      tailor: saved?.tailor !== false,
      gentle: saved?.gentle === true,
      leaveOut: {
        bloom: saved?.leaveOut?.bloom === true,
        chimes: saved?.leaveOut?.chimes === true,
        reach: saved?.leaveOut?.reach === true,
      },
    };
  }

  setSettings(settings: Settings): void {
    this.data.settings = settings;
    this.save();
  }

  /** Record the answer to "How did that feel?" on the session just saved. */
  setComfort(comfort: Comfort): void {
    const last = this.data.sessions[this.data.sessions.length - 1];
    if (last) {
      last.comfort = comfort;
      this.save();
    }
  }

  add(record: SessionRecord): void {
    this.data.lead = record.lead;
    this.data.sessions.push(record);
    if (this.data.sessions.length > MAX_SESSIONS) {
      this.data.sessions.splice(0, this.data.sessions.length - MAX_SESSIONS);
    }
    this.save();
  }

  /** Forget the sessions; the settings stay. */
  clear(): void {
    this.data = { version: 1, lead: null, sessions: [], settings: this.data.settings };
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
