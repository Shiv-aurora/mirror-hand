import type { Level, SessionRecord, Settings } from './store.js';

/**
 * Tailoring: what today's session should be, worked out from this person's
 * last few sessions. Plain rules, on the device; nothing is sent anywhere and
 * no model is involved. Every change comes with a sentence saying why, so the
 * person (or their therapist) can see what was decided.
 *
 * This module is pure: no DOM, no storage, no Three.js. Types only are
 * imported, so it can be run directly by Node for its tests.
 */

export const FINGER_NAMES = ['index', 'middle', 'ring', 'little'] as const;

/** What one session is made of. `STANDARD` is the session as first designed. */
export interface SessionPlan {
  level: Level;
  /** Open-and-close repetitions. */
  bloom: number;
  /** The fingers to touch to the thumb, in order (0 index .. 3 little). */
  chimes: number[];
  /** How many pairs of fireflies to reach for (at most 8). */
  reach: number;
  /** Multiplier on how far the fireflies sit from the hand's resting place. */
  reachScale: number;
  /** The finger given extra touches, or null. */
  focus: number | null;
  /** Which of the three mirrored movements are in the session. */
  include: { bloom: boolean; chimes: boolean; reach: boolean };
  /** Full sentences saying what is different today and why. Empty when standard. */
  reasons: string[];
  /** One short line (at most 60 characters) for the in-headset panel, or null. */
  note: string | null;
  /** Set when pain was reported last time; shown before the session starts. */
  caution: string | null;
}

export function standardPlan(): SessionPlan {
  return {
    level: 0,
    bloom: 6,
    chimes: [0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3],
    reach: 8,
    reachScale: 1,
    focus: null,
    include: { bloom: true, chimes: true, reach: true },
    reasons: [],
    note: null,
    caution: null,
  };
}

const PAINFUL_CAUTION =
  'Last time you said this was painful. Today is shorter and nearer. ' +
  'Stop if it hurts, and check with your clinician before carrying on.';

/** Extra touches that lean on the chosen finger, ending the session's last pass. */
const FOCUS_PASS: readonly (readonly number[])[] = [
  [0, 1, 0, 2],
  [1, 0, 1, 2],
  [2, 1, 2, 3],
  [3, 2, 3, 1],
];

/** Hand tracking is noisy, so a finger must trail the others by this much. */
const FOCUS_GAP = 0.15;

function clampLevel(n: number): Level {
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}

/** A record from after tailoring existed; older ones say nothing either way. */
function measured(s: SessionRecord): boolean {
  return s.stalls !== undefined;
}

function hard(s: SessionRecord): boolean {
  return measured(s) && ((s.stalls ?? 0) >= 3 || (s.skipped ?? 0) >= 1);
}

function smooth(s: SessionRecord): boolean {
  return measured(s) && s.stalls === 0 && (s.skipped ?? 0) === 0 && s.comfort === 'fine';
}

/**
 * Stepping up needs two good sessions on two different days. Two in one
 * sitting say little about tomorrow, and a tired hand should not be given
 * more. Stepping down never waits.
 */
function differentDays(a: SessionRecord, b: SessionRecord): boolean {
  return new Date(a.at).toDateString() !== new Date(b.at).toDateString();
}

/** Even passes run index to little, odd passes back again. */
function chimesFor(passes: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < passes; i++) {
    out.push(...(i % 2 === 0 ? [0, 1, 2, 3] : [3, 2, 1, 0]));
  }
  return out;
}

/** The finger that clearly opened least across these sessions, or null. */
function findFocus(recent: readonly SessionRecord[]): number | null {
  const lists: (number | null)[][] = [];
  for (const s of recent) {
    if (Array.isArray(s.fingers) && s.fingers.length === 4) lists.push(s.fingers);
  }
  if (lists.length < 2) return null;

  const averages: number[] = [];
  for (let f = 0; f < 4; f++) {
    let sum = 0;
    let count = 0;
    for (const list of lists) {
      const v = list[f];
      if (v !== null && v !== undefined) {
        sum += v;
        count++;
      }
    }
    // A finger measured once could be a fluke; give up rather than guess.
    if (count < 2) return null;
    averages.push(sum / count);
  }

  let lowest = 0;
  for (let f = 1; f < 4; f++) if (averages[f] < averages[lowest]) lowest = f;
  let others = 0;
  for (let f = 0; f < 4; f++) if (f !== lowest) others += averages[f];
  others /= 3;
  return others - averages[lowest] >= FOCUS_GAP ? lowest : null;
}

/**
 * @param sessions Every saved session, oldest first, for either lead hand.
 * @param lead The hand leading today; only sessions led by it are used.
 */
export function planSession(
  sessions: readonly SessionRecord[],
  lead: SessionRecord['lead'],
  settings: Settings,
): SessionPlan {
  // A damaged save must not stop the app: skip anything that is not a record.
  const valid = sessions.filter((s) => s && typeof s === 'object');
  const recent = valid.filter((s) => s.lead === lead).slice(-3);
  /** The most recent session with either hand: pain is about the person. */
  const lastOfAll: SessionRecord | undefined = valid[valid.length - 1];
  const latest: SessionRecord | undefined = recent[recent.length - 1];
  const previous: SessionRecord | undefined = recent[recent.length - 2];

  // Never an empty session: if everything is left out, put everything back.
  let include = {
    bloom: !settings.leaveOut.bloom,
    chimes: !settings.leaveOut.chimes,
    reach: !settings.leaveOut.reach,
  };
  if (!include.bloom && !include.chimes && !include.reach) {
    include = { bloom: true, chimes: true, reach: true };
  }

  let level: Level = 0;
  let reason: string | null = null;
  let note: string | null = null;
  let caution: string | null = null;
  let tailored = true;

  if (lastOfAll?.comfort === 'painful') {
    // A safety rule: it applies even when tailoring is switched off.
    level = -1;
    caution = PAINFUL_CAUTION;
    reason = 'A shorter session with nearer targets, because you said the last one was painful.';
    note = "Shorter today, after last time's pain.";
  } else if (settings.gentle) {
    level = -1;
    reason = 'A shorter session with nearer targets, as set on the start page.';
    note = 'Shorter session, as set.';
  } else if (!settings.tailor) {
    tailored = false;
  } else if (latest && previous && latest.comfort === 'sore' && previous.comfort === 'sore') {
    level = clampLevel((latest.level ?? 0) - 1);
    if (level === 0) {
      reason = 'Back to the standard session, because the last two left your hand sore.';
    } else {
      reason = 'A shorter session, because the last two left your hand sore.';
      note = 'Shorter today, after two sore sessions.';
    }
  } else if (latest && previous && hard(latest) && hard(previous)) {
    level = clampLevel((latest.level ?? 0) - 1);
    if (level === 0) {
      reason =
        'Back to the standard session, because some movements were hard to finish in the last two sessions.';
    } else {
      reason =
        'A shorter session with nearer targets, because some movements were hard to finish in the last two sessions.';
      note = 'Shorter today, with nearer targets.';
    }
  } else if (
    latest &&
    previous &&
    smooth(latest) &&
    smooth(previous) &&
    differentDays(latest, previous)
  ) {
    level = clampLevel((latest.level ?? 0) + 1);
    if (level === 1) {
      reason = 'A little more of each movement, because the last two sessions went smoothly.';
      note = 'A little more today: the last two went well.';
    } else if (level === 0) {
      reason = 'Back to the standard session, because the last two went smoothly.';
    }
  } else {
    level = clampLevel(latest?.level ?? 0);
    if (level === 1) {
      reason = 'Staying with a little more of each movement.';
    } else if (level === -1) {
      reason = 'Staying with the shorter session for now.';
      note = 'Shorter session, as last time.';
    }
  }

  const base =
    level === -1
      ? { bloom: 4, passes: 2, reach: 5, reachScale: 0.75 }
      : level === 1
        ? { bloom: 8, passes: 4, reach: 8, reachScale: 1.15 }
        : { bloom: 6, passes: 3, reach: 8, reachScale: 1 };

  const chimes = chimesFor(base.passes);
  const reasons: string[] = reason ? [reason] : [];

  let focus: number | null = null;
  if (tailored && caution === null && include.chimes) {
    focus = findFocus(recent);
    if (focus !== null) {
      chimes.splice(chimes.length - 4, 4, ...FOCUS_PASS[focus]);
      reasons.push(
        `Extra touches for your ${FINGER_NAMES[focus]} finger, which opened least in your last sessions.`,
      );
      if (note === null) note = `Extra touches for your ${FINGER_NAMES[focus]} finger today.`;
    }
  }

  return {
    level,
    bloom: base.bloom,
    chimes,
    reach: base.reach,
    reachScale: base.reachScale,
    focus,
    include,
    reasons,
    note,
    caution,
  };
}
