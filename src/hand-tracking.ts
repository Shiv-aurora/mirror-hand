import { Matrix4, Vector3 } from '@iwsdk/core';
import type { Seat } from './seat.js';

/** WebXR hand joints, in the order the Hand Input spec lists them. */
export const JOINTS = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
] as const;

export const JOINT_COUNT = JOINTS.length;
export const WRIST = 0;
export const THUMB_TIP = 4;
/** Tip joint index for index, middle, ring, pinky. */
export const FINGER_TIPS = [9, 14, 19, 24] as const;
/** Knuckle (proximal phalanx) joint index for index, middle, ring, pinky. */
export const FINGER_KNUCKLES = [6, 11, 16, 21] as const;
/** First joint (metacarpal) of each of the four fingers. */
const FINGER_BASES = [5, 10, 15, 20] as const;

export type Side = 'left' | 'right';
export const otherSide = (side: Side): Side =>
  side === 'left' ? 'right' : 'left';

const TRACKING_GRACE_SECONDS = 0.3;

/**
 * One hand's pose for the current frame, plus the few measurements the
 * activities need. Positions are in seat space (see Seat); matrices are in
 * player space, ready to drive a hand model.
 */
export class HandState {
  /** True when this frame (or the last few) had a real pose. */
  tracked = false;
  /** Seconds since the pose was last fresh. */
  staleFor = Infinity;
  /** 25 column-major 4x4 matrices in player space. */
  readonly matrices = new Float32Array(JOINT_COUNT * 16);
  /** Joint positions in seat space. */
  readonly points: Vector3[] = [];
  /** Centre of the palm in seat space. */
  readonly palm = new Vector3();
  /**
   * Per finger (index..pinky): fingertip-to-wrist distance divided by the
   * finger's bone-chain length. About 0.95 when straight, about 0.5 in a fist.
   */
  readonly reach = new Float32Array(4);
  /** Mean of `reach` — one number for "how open is the hand". */
  openness = 0;
  /** Distance in metres from the thumb tip to each fingertip. */
  readonly pinch = new Float32Array(4);

  private spaces: XRJointSpace[] | null = null;
  private source: XRInputSource | null = null;
  private readonly scratch = new Float32Array(JOINT_COUNT * 16);

  constructor(readonly side: Side) {
    for (let i = 0; i < JOINT_COUNT; i++) {
      this.points.push(new Vector3());
    }
  }

  /** Read this hand from the XR frame. Call once per frame. */
  read(
    frame: XRFrame | undefined,
    source: XRInputSource | undefined,
    referenceSpace: XRReferenceSpace | null | undefined,
    seat: Seat,
    delta: number,
  ): void {
    let fresh = false;
    if (frame && source?.hand && referenceSpace) {
      if (this.source !== source || !this.spaces) {
        this.source = source;
        this.spaces = [];
        for (const name of JOINTS) {
          const space = source.hand.get(name as XRHandJoint);
          if (space) {
            this.spaces.push(space);
          }
        }
      }
      if (this.spaces.length === JOINT_COUNT) {
        const fill = (
          frame as XRFrame & {
            fillPoses?: (
              spaces: XRJointSpace[],
              base: XRSpace,
              out: Float32Array,
            ) => boolean;
          }
        ).fillPoses;
        if (fill) {
          fresh = fill.call(frame, this.spaces, referenceSpace, this.scratch);
          // A lost hand reports NaN or all-zero matrices on some runtimes.
          if (fresh && !(Math.abs(this.scratch[15] - 1) < 1e-3)) {
            fresh = false;
          }
        }
      }
    } else {
      this.source = null;
      this.spaces = null;
    }

    if (fresh) {
      this.matrices.set(this.scratch);
      this.staleFor = 0;
      this.tracked = true;
      this.measure(seat);
    } else {
      this.staleFor += delta;
      if (this.staleFor > TRACKING_GRACE_SECONDS) {
        this.tracked = false;
      }
    }
  }

  /** Make this state the mirror image of `lead` across the seat midline. */
  mirrorFrom(lead: HandState, seat: Seat): void {
    this.tracked = lead.tracked;
    this.staleFor = lead.staleFor;
    if (!lead.tracked) {
      return;
    }
    // J' = M · J · flipX: reflect the pose across the midline, then flip the
    // joint's local X so the result is a proper rotation again. That is
    // exactly the opposite hand's joint convention.
    for (let i = 0; i < JOINT_COUNT; i++) {
      tmpA.fromArray(lead.matrices, i * 16);
      tmpB.copy(seat.mirror).multiply(tmpA).multiply(FLIP_X);
      tmpB.toArray(this.matrices, i * 16);
      this.points[i].copy(lead.points[i]);
      this.points[i].x = -this.points[i].x;
    }
    this.palm.copy(lead.palm);
    this.palm.x = -this.palm.x;
    this.reach.set(lead.reach);
    this.pinch.set(lead.pinch);
    this.openness = lead.openness;
  }

  private measure(seat: Seat): void {
    const m = this.matrices;
    for (let i = 0; i < JOINT_COUNT; i++) {
      this.points[i]
        .set(m[i * 16 + 12], m[i * 16 + 13], m[i * 16 + 14])
        .applyMatrix4(seat.inverse);
    }
    const p = this.points;
    this.palm.copy(p[WRIST]).add(p[FINGER_KNUCKLES[1]]).multiplyScalar(0.5);

    let sum = 0;
    for (let f = 0; f < 4; f++) {
      const base = FINGER_BASES[f];
      let chain = p[WRIST].distanceTo(p[base]);
      for (let j = base; j < base + 4; j++) {
        chain += p[j].distanceTo(p[j + 1]);
      }
      const tip = p[base + 4];
      const ratio = chain > 1e-4 ? p[WRIST].distanceTo(tip) / chain : 0;
      this.reach[f] = ratio;
      sum += ratio;
      this.pinch[f] = p[THUMB_TIP].distanceTo(tip);
    }
    this.openness = sum / 4;
  }
}

const tmpA = new Matrix4();
const tmpB = new Matrix4();
const FLIP_X = new Matrix4().makeScale(-1, 1, 1);
