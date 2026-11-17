import { Group, Vector3 } from '@iwsdk/core';
import { PENTATONIC, type Sound } from './audio.js';
import { Firefly, Lantern, Lotus } from './garden.js';
import type { HandState, Side } from './hand-tracking.js';
import type { HandVisual } from './hand-visual.js';
import type { Seat } from './seat.js';
import type { TextPanel } from './ui.js';

/** Everything an activity can read or drive. Owned by the director. */
export interface Context {
  seat: Seat;
  leadSide: Side;
  otherSide: Side;
  /** The hand the person is really moving. */
  lead: HandState;
  /** The mirror image of `lead`, on the other side of the body. */
  mirror: HandState;
  /** The other hand as actually tracked (used only in "your turn"). */
  other: HandState;
  visuals: Record<Side, HandVisual>;
  sound: Sound;
  panel: TextPanel;
  /** Where the lead palm rested when it was chosen, in seat space. */
  home: Vector3;
  /**
   * The lead hand's own open and closed values, learnt while it moves. The
   * other hand is later measured against this, so the result is a fraction
   * of this person's own range, not of some average hand.
   */
  range: { open: number; closed: number; learned: boolean };
  /** Filled in by the "your turn" activity. */
  result: { range: number | null };
}

export interface Activity {
  readonly group: Group;
  begin(context: Context): void;
  /** Returns true once the activity is finished. */
  update(context: Context, delta: number): boolean;
  end(context: Context): void;
  /** Show this activity's current instruction on the text panel. */
  prompt(context: Context): void;
}

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
/** An activity that sees no progress for this long moves on by itself. */
const STALL_SECONDS = 28;
/** How far in front of the seat the water lilies float (metres). */
const LILY_Z = -0.8;

/**
 * Follows a hand's openness and reports each time it finishes opening or
 * finishes closing. It looks for a turn-around of a minimum size instead of
 * fixed thresholds, so a hand with a small range still registers.
 */
class OpenCloseCounter {
  smoothed = 0;
  /** +1 while opening, -1 while closing, 0 before the first movement. */
  direction = 0;
  halfCycles = 0;
  low = 1;
  high = 0;
  private extreme = 0;
  private started = false;

  reset(): void {
    this.direction = 0;
    this.halfCycles = 0;
    this.low = 1;
    this.high = 0;
    this.started = false;
  }

  /** Returns 'opened' or 'closed' on the frame a movement completes. */
  update(
    value: number,
    delta: number,
    minimumSwing: number,
  ): 'opened' | 'closed' | null {
    if (!this.started) {
      this.smoothed = value;
      this.extreme = value;
      this.started = true;
    }
    this.smoothed += (value - this.smoothed) * Math.min(1, delta * 12);
    const s = this.smoothed;
    this.low = Math.min(this.low, s);
    this.high = Math.max(this.high, s);
    if (this.direction === 0) {
      if (s - this.low > minimumSwing) {
        this.direction = 1;
        this.extreme = s;
      } else if (this.high - s > minimumSwing) {
        this.direction = -1;
        this.extreme = s;
      }
      return null;
    }
    if (this.direction === 1) {
      this.extreme = Math.max(this.extreme, s);
      if (this.extreme - s > minimumSwing) {
        this.direction = -1;
        this.extreme = s;
        this.halfCycles++;
        return 'opened';
      }
    } else {
      this.extreme = Math.min(this.extreme, s);
      if (s - this.extreme > minimumSwing) {
        this.direction = 1;
        this.extreme = s;
        this.halfCycles++;
        return 'closed';
      }
    }
    return null;
  }
}

/** 1 of 3: open and close both hands; two water lilies follow. */
export class BloomActivity implements Activity {
  readonly group = new Group();
  private readonly lilies = [new Lotus(0xf7c9d8), new Lotus(0xf7c9d8)];
  private readonly counter = new OpenCloseCounter();
  private readonly target = 6;
  private cycles = 0;
  private stall = 0;

  constructor() {
    this.group.name = 'activity-bloom';
    this.group.add(this.lilies[0].group, this.lilies[1].group);
    this.lilies[0].group.scale.setScalar(1.5);
    this.lilies[1].group.scale.setScalar(1.5);
    this.group.visible = false;
  }

  begin(context: Context): void {
    const x = Math.min(0.2, Math.max(0.13, Math.abs(context.home.x)));
    const y = context.seat.workY - 0.118;
    // Beyond the fingertips, so the hands never hide the flowers.
    this.lilies[0].group.position.set(-x - 0.04, y, LILY_Z);
    this.lilies[1].group.position.set(x + 0.04, y, LILY_Z);
    this.counter.reset();
    this.cycles = 0;
    this.stall = 0;
    this.group.visible = true;
    this.prompt(context);
  }

  update(context: Context, delta: number): boolean {
    const { lead, range } = context;
    this.stall += delta;
    if (lead.tracked) {
      const span = Math.max(0.12, range.open - range.closed);
      const event = this.counter.update(
        lead.openness,
        delta,
        Math.max(0.06, span * 0.4),
      );
      // After one full open-and-close, trust what this hand actually did.
      if (this.counter.halfCycles >= 2) {
        range.open = this.counter.high;
        range.closed = this.counter.low;
        range.learned = true;
      } else {
        range.open = Math.max(range.open, this.counter.high);
        range.closed = Math.min(range.closed, this.counter.low);
      }
      if (event) {
        this.stall = 0;
        if (event === 'opened') {
          this.lilies[0].flash();
          this.lilies[1].flash();
          context.sound.chord([PENTATONIC[2], PENTATONIC[4], PENTATONIC[6]], 0.3);
        } else {
          this.cycles = Math.floor(this.counter.halfCycles / 2);
          context.sound.bell(PENTATONIC[0] - 12, 0.3, 2);
        }
        this.prompt(context);
      }
      const amount = clamp01(
        (this.counter.smoothed - range.closed) /
          Math.max(0.08, range.open - range.closed),
      );
      this.lilies[0].setOpen(amount);
      this.lilies[1].setOpen(amount);
    }
    this.lilies[0].update(delta);
    this.lilies[1].update(delta);
    return (
      Math.floor(this.counter.halfCycles / 2) >= this.target ||
      this.stall > STALL_SECONDS
    );
  }

  end(): void {
    this.group.visible = false;
  }

  /** Outside VR: show the lilies opening and closing on their own. */
  preview(seat: Seat, amount: number, delta: number): void {
    const y = seat.workY - 0.118;
    this.lilies[0].group.position.set(-0.2, y, LILY_Z);
    this.lilies[1].group.position.set(0.2, y, LILY_Z);
    this.group.visible = true;
    for (const lily of this.lilies) {
      lily.setOpen(amount);
      lily.update(delta);
    }
  }

  prompt(context: Context): void {
    const closing = this.counter.direction === -1;
    context.panel.set({
      eyebrow: '1 of 3 · Open and close',
      title: closing ? 'Now close them gently' : 'Open both hands wide',
      body: `Go slowly. Watch your ${context.otherSide} hand, and try to move it along too.`,
      progress: Math.floor(this.counter.halfCycles / 2) / this.target,
    });
  }
}

const FINGER_NAMES = ['index', 'middle', 'ring', 'little'] as const;
const FINGER_TINTS = [0xffd08a, 0xff9fb0, 0x9fd0ff, 0xb6f0a0] as const;
const FINGER_NOTES = [PENTATONIC[3], PENTATONIC[4], PENTATONIC[5], PENTATONIC[7]];
const TOUCH_ON = 0.021;
const TOUCH_OFF = 0.036;
/** The touching finger must beat the next nearest by this much (metres). */
const TOUCH_MARGIN = 0.004;
const TOUCH_SECONDS = 0.08;
const CHIME_ORDER = [0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3] as const;

/** 2 of 3: touch the thumb to each finger in turn; each rings a lantern. */
export class ChimesActivity implements Activity {
  readonly group = new Group();
  private readonly lanterns: Lantern[] = [];
  private step = 0;
  private touching = -1;
  private candidate = -1;
  private contact = 0;
  private armed = true;
  private stall = 0;

  constructor() {
    this.group.name = 'activity-chimes';
    for (let i = 0; i < 4; i++) {
      const lantern = new Lantern(FINGER_TINTS[i]);
      this.lanterns.push(lantern);
      this.group.add(lantern.group);
    }
    this.group.visible = false;
  }

  begin(context: Context): void {
    const sign = context.leadSide === 'right' ? 1 : -1;
    const y = context.seat.headY - 0.34;
    // Index is nearest the middle of the body, little finger furthest out,
    // matching where those fingers are on a palm-down lead hand.
    for (let i = 0; i < 4; i++) {
      const x = sign * (-0.17 + i * 0.113);
      const arc = -0.012 * Math.abs(i - 1.5);
      this.lanterns[i].group.position.set(x, y + arc, -0.68);
    }
    this.step = 0;
    this.touching = -1;
    this.candidate = -1;
    this.contact = 0;
    this.armed = true;
    this.stall = 0;
    this.group.visible = true;
    this.cue(context);
  }

  update(context: Context, delta: number): boolean {
    const { lead } = context;
    this.stall += delta;
    const wanted = CHIME_ORDER[this.step];
    if (lead.tracked && this.step < CHIME_ORDER.length) {
      // Which finger, if any, is on the thumb right now? A touch only counts
      // when one finger is clearly the closest, so a closing fist (all four
      // fingertips near the thumb at once) does not ring anything.
      let nearest = -1;
      let nearestDistance = TOUCH_ON;
      let runnerUp = Infinity;
      for (let f = 0; f < 4; f++) {
        const distance = lead.pinch[f];
        if (distance < nearestDistance) {
          runnerUp = Math.min(runnerUp, nearestDistance);
          nearestDistance = distance;
          nearest = f;
        } else {
          runnerUp = Math.min(runnerUp, distance);
        }
      }
      if (nearest >= 0 && runnerUp - nearestDistance < TOUCH_MARGIN) {
        nearest = -1;
      }
      this.contact = nearest >= 0 && nearest === this.candidate
        ? this.contact + delta
        : 0;
      this.candidate = nearest;
      if (this.contact < TOUCH_SECONDS) {
        nearest = -1;
      }
      if (this.touching >= 0 && lead.pinch[this.touching] > TOUCH_OFF) {
        this.touching = -1;
        this.armed = true;
      }
      if (nearest >= 0 && this.armed) {
        this.armed = false;
        this.touching = nearest;
        this.lanterns[nearest].ring();
        if (nearest === wanted) {
          context.sound.bell(FINGER_NOTES[nearest], 0.5);
          this.advance(context);
        } else {
          context.sound.bell(FINGER_NOTES[nearest], 0.16, 1.2);
        }
      }
    }
    // Never leave someone stuck on a touch their hand cannot make.
    if (this.stall > 16 && this.step < CHIME_ORDER.length) {
      this.advance(context);
    }
    for (const lantern of this.lanterns) {
      lantern.update(delta);
    }
    return this.step >= CHIME_ORDER.length;
  }

  end(context: Context): void {
    this.group.visible = false;
    context.visuals.left.clearTipLights();
    context.visuals.right.clearTipLights();
  }

  private advance(context: Context): void {
    this.step++;
    this.stall = 0;
    this.cue(context);
  }

  prompt(context: Context): void {
    this.cue(context);
  }

  private cue(context: Context): void {
    const done = this.step >= CHIME_ORDER.length;
    const wanted: number = done ? -1 : CHIME_ORDER[this.step];
    for (let i = 0; i < 4; i++) {
      this.lanterns[i].setCue(i === wanted);
    }
    for (const side of ['left', 'right'] as const) {
      const visual = context.visuals[side];
      visual.clearTipLights();
      if (!done) {
        visual.setTipLight(0, 0xffffff, 0.75);
        visual.setTipLight(wanted + 1, FINGER_TINTS[wanted] ?? 0xffffff, 0.95);
      }
    }
    if (!done) {
      context.panel.set({
        eyebrow: '2 of 3 · Finger touches',
        title: `Thumb to your ${FINGER_NAMES[wanted] ?? 'next'} finger`,
        body: 'Touch the two lit fingertips together. Each touch rings a lantern.',
        progress: this.step / CHIME_ORDER.length,
      });
    }
  }
}

/** Offsets from the home position: [outward, up, forward] in metres. */
const REACHES: readonly (readonly [number, number, number])[] = [
  [0.02, 0.05, -0.02],
  [0.09, 0.1, -0.06],
  [0.11, 0.0, -0.1],
  [0.0, 0.15, -0.1],
  [0.13, 0.07, 0.0],
  [-0.03, 0.02, -0.13],
  [0.1, 0.16, -0.04],
  [0.04, 0.08, -0.15],
];
/** Index, middle and ring fingertips: any of them can reach a firefly. */
const REACH_POINTS = [9, 14, 19] as const;
const CATCH_RADIUS = 0.075;
const CATCH_SECONDS = 0.35;

/** 3 of 3: reach both hands out to a pair of fireflies and hold. */
export class FirefliesActivity implements Activity {
  readonly group = new Group();
  private readonly pair = [new Firefly(), new Firefly()];
  private readonly caught: Firefly[] = [];
  private readonly targetLead = new Vector3();
  private readonly swarmCentre = new Vector3();
  private index = 0;
  private hold = 0;
  private gap = 0;
  private stall = 0;
  private clock = 0;
  private finishing = 0;

  constructor() {
    this.group.name = 'activity-fireflies';
    this.group.add(this.pair[0].group, this.pair[1].group);
    for (let i = 0; i < REACHES.length * 2; i++) {
      const firefly = new Firefly(0xffe6a0);
      this.caught.push(firefly);
      this.group.add(firefly.group);
    }
    this.group.visible = false;
  }

  begin(context: Context): void {
    this.index = 0;
    this.hold = 0;
    this.gap = 0.6;
    this.stall = 0;
    this.finishing = 0;
    this.swarmCentre.set(0, context.seat.workY + 0.02, -0.6);
    for (const firefly of this.caught) {
      firefly.show(false);
    }
    this.group.visible = true;
    this.place(context);
    this.prompt(context);
  }

  update(context: Context, delta: number): boolean {
    this.clock += delta;
    this.stall += delta;
    const { lead } = context;
    const done = this.index >= REACHES.length;

    if (!done) {
      if (this.gap > 0) {
        this.gap -= delta;
        if (this.gap <= 0) {
          this.pair[0].show(true);
          this.pair[1].show(true);
        }
      } else {
        const bob = Math.sin(this.clock * 1.7) * 0.008;
        this.pair[0].group.position.copy(this.targetLead);
        this.pair[0].group.position.y += bob;
        this.pair[1].group.position.copy(this.targetLead);
        this.pair[1].group.position.x = -this.targetLead.x;
        this.pair[1].group.position.y += bob;
        const near =
          lead.tracked &&
          lead.palm.distanceTo(this.targetLead) < CATCH_RADIUS + 0.03 &&
          this.nearestLeadPoint(lead) < CATCH_RADIUS;
        this.hold = near
          ? this.hold + delta
          : Math.max(0, this.hold - delta * 2);
        const charge = clamp01(this.hold / CATCH_SECONDS);
        this.pair[0].charge = charge;
        this.pair[1].charge = charge;
        if (this.hold >= CATCH_SECONDS || this.stall > 18) {
          this.collect(context);
        }
      }
    } else {
      this.finishing += delta;
    }

    // Caught fireflies circle slowly over the middle of the basin.
    const total = this.index * 2;
    for (let i = 0; i < this.caught.length; i++) {
      const firefly = this.caught[i];
      if (i < total) {
        const angle = this.clock * 0.7 + (i / Math.max(1, total)) * Math.PI * 2;
        const lift = done ? this.finishing * 0.12 : 0;
        firefly.group.position.set(
          this.swarmCentre.x + Math.cos(angle) * 0.07,
          this.swarmCentre.y + Math.sin(angle * 1.3 + i) * 0.02 + lift,
          this.swarmCentre.z + Math.sin(angle) * 0.07,
        );
      }
      firefly.update(delta);
    }
    this.pair[0].update(delta);
    this.pair[1].update(delta);
    return done && this.finishing > 2.2;
  }

  end(): void {
    this.group.visible = false;
  }

  /** Closest of the palm and the fingertips to the target. */
  private nearestLeadPoint(lead: HandState): number {
    let best = lead.palm.distanceTo(this.targetLead);
    for (const tip of REACH_POINTS) {
      best = Math.min(best, lead.points[tip].distanceTo(this.targetLead));
    }
    return best;
  }

  private collect(context: Context): void {
    for (let i = 0; i < 2; i++) {
      const firefly = this.caught[this.index * 2 + i];
      firefly.group.position.copy(this.pair[i].group.position);
      firefly.show(true);
      this.pair[i].show(false);
      this.pair[i].charge = 0;
    }
    context.sound.chord(
      [PENTATONIC[this.index % 5] + 12, PENTATONIC[(this.index + 2) % 5] + 12],
      0.34,
      0.07,
    );
    this.index++;
    this.hold = 0;
    this.stall = 0;
    this.gap = 0.7;
    if (this.index < REACHES.length) {
      this.place(context);
    } else {
      context.sound.chord([0, 7, 12, 16, 19], 0.3, 0.12);
    }
    this.prompt(context);
  }

  private place(context: Context): void {
    const sign = context.leadSide === 'right' ? 1 : -1;
    const [out, up, forward] = REACHES[this.index];
    const home = context.home;
    const z = Math.min(-0.22, home.z + forward);
    // Keep both lights inside a narrow field of view: no more than about
    // 30 degrees to either side of straight ahead.
    const widest = 0.56 * -z;
    this.targetLead.set(
      sign * Math.min(widest, Math.max(0.085, Math.abs(home.x) + out)),
      Math.max(context.seat.workY - 0.03, home.y + up - 0.04),
      z,
    );
  }

  prompt(context: Context): void {
    const done = this.index >= REACHES.length;
    context.panel.set({
      eyebrow: '3 of 3 · Reach',
      title: done ? 'All gathered' : 'Reach for the fireflies',
      body: done
        ? 'Rest your hands for a moment.'
        : 'Move both hands out to the two lights and hold them there.',
      progress: this.index / REACHES.length,
    });
  }
}

/** Tracking jitter on a still hand; subtracted so stillness reads as zero. */
const NOISE_FLOOR = 0.015;
const TURN_SECONDS = 20;
/** Open hand to loose fist, on the openness scale, for a typical hand. */
const TYPICAL_SPAN = 0.5;
const TURN_UNSEEN_LIMIT = 14;

/**
 * "Your turn": the mirror is switched off and the other hand is shown as it
 * really is. The person opens and closes it as far as is comfortable, and
 * the app records how far that was compared with the lead hand.
 */
export class TurnActivity implements Activity {
  readonly group = new Group();
  private readonly lily = new Lotus(0xffe0a8);
  private readonly counter = new OpenCloseCounter();
  private seen = 0;
  private unseen = 0;
  private everSeen = false;
  private settle = 0;
  private shownStep = -1;

  constructor() {
    this.group.name = 'activity-turn';
    this.group.add(this.lily.group);
    this.lily.group.scale.setScalar(1.5);
    this.group.visible = false;
  }

  begin(context: Context): void {
    const sign = context.otherSide === 'right' ? 1 : -1;
    const x = Math.min(0.2, Math.max(0.13, Math.abs(context.home.x)));
    this.lily.group.position.set(sign * (x + 0.04), context.seat.workY - 0.118, LILY_Z);
    this.lily.setOpen(0);
    this.counter.reset();
    this.seen = 0;
    this.unseen = 0;
    this.everSeen = false;
    this.settle = 0;
    this.shownStep = -1;
    context.result.range = null;
    this.group.visible = true;
    this.prompt(context);
  }

  update(context: Context, delta: number): boolean {
    const { other, range } = context;
    if (other.tracked) {
      // Skip the first moments after the hand appears: tracking is settling.
      this.settle += delta;
      if (this.settle > 0.6) {
        if (!this.everSeen) {
          this.everSeen = true;
          this.prompt(context);
        }
        this.seen += delta;
        const event = this.counter.update(other.openness, delta, 0.03);
        if (event === 'opened') {
          this.lily.flash();
          context.sound.bell(PENTATONIC[5], 0.35);
        }
        const span = Math.max(0.05, this.counter.high - this.counter.low);
        this.lily.setOpen((this.counter.smoothed - this.counter.low) / span);
        // Redraw the progress bar in steps, not on every frame.
        const step = Math.round((this.seen / TURN_SECONDS) * 20);
        if (step !== this.shownStep) {
          this.shownStep = step;
          this.prompt(context);
        }
      }
    } else {
      this.unseen += delta;
      this.settle = 0;
    }
    this.lily.update(delta);

    const finished =
      this.seen >= TURN_SECONDS ||
      (!this.everSeen && this.unseen > TURN_UNSEEN_LIMIT) ||
      (this.everSeen && this.unseen > TURN_UNSEEN_LIMIT + 10);
    if (finished && this.everSeen && this.seen > 2) {
      const moved = Math.max(
        0,
        this.counter.high - this.counter.low - NOISE_FLOOR,
      );
      // If the first activity was skipped, the lead hand's range was never
      // measured; fall back to a typical open-to-fist span.
      const leadSpan = range.learned
        ? Math.max(0.1, range.open - range.closed)
        : TYPICAL_SPAN;
      context.result.range = Math.min(1, moved / leadSpan);
    }
    return finished;
  }

  end(): void {
    this.group.visible = false;
  }

  prompt(context: Context): void {
    const side = context.otherSide;
    context.panel.set({
      eyebrow: 'Your turn',
      title: `Now your ${side} hand, on its own`,
      body: this.everSeen
        ? 'Open and close it as far as feels comfortable. Any movement counts, and so does none.'
        : `Bring your ${side} hand to where you can see it. Use your other hand to help if you like.`,
      // Stepped, so the panel is not redrawn on every frame.
      progress: this.everSeen
        ? Math.round((this.seen / TURN_SECONDS) * 20) / 20
        : undefined,
    });
  }
}
