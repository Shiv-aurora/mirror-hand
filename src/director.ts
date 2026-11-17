import {
  CircleGeometry,
  createSystem,
  Group,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  Pressed,
  Quaternion,
  RayInteractable,
  TorusGeometry,
  Vector3,
  VisibilityState,
  type Entity,
} from '@iwsdk/core';
import {
  BloomActivity,
  ChimesActivity,
  FirefliesActivity,
  TurnActivity,
  type Activity,
  type Context,
} from './activities.js';
import { PENTATONIC, sound } from './audio.js';
import { Pad } from './components.js';
import { Garden } from './garden.js';
import { HandState, otherSide, type Side } from './hand-tracking.js';
import { HandVisual } from './hand-visual.js';
import { Seat } from './seat.js';
import { Store } from './store.js';
import { PadButton, TextPanel } from './ui.js';

type Phase =
  | 'idle'
  | 'arrive'
  | 'choose'
  | 'meet'
  | 'activity'
  | 'rest'
  | 'summary';

const SIDES: readonly Side[] = ['left', 'right'];
const CHOOSE_SECONDS = 1.2;
const CHOOSE_RADIUS = 0.15;
const DISCLAIMER = 'A gentle practice inspired by mirror therapy. Not a medical device.';

/**
 * Runs the whole session: finds the hands, decides which one leads, shows
 * the mirrored hand, steps through the activities and saves the result.
 */
export class Director extends createSystem({
  pressed: { required: [Pad, Pressed] },
  hovered: { required: [Pad, Hovered] },
}) {
  private seat!: Seat;
  private garden!: Garden;
  private stage!: Group;
  private store!: Store;
  private panel!: TextPanel;
  private hands!: Record<Side, HandState>;
  private mirrors!: Record<Side, HandState>;
  private visuals!: Record<Side, HandVisual>;
  private pads!: Record<string, PadButton>;
  private activities!: Activity[];
  private turn!: TurnActivity;
  private bloom!: BloomActivity;
  private context!: Context;
  private chooseRing!: Mesh;
  private chooseFill!: Mesh;

  private phase: Phase = 'idle';
  private phaseTime = 0;
  private activityIndex = 0;
  private leadSide: Side | null = null;
  private chooseHold: Record<Side, number> = { left: 0, right: 0 };
  private meetHold = 0;
  private lostFor = 0;
  private showingLostHint = false;
  private noHandsFor = 0;
  private hideTimer = 0;
  private idleClock = 0;
  private wasInXR = false;

  private headPosition!: Vector3;
  private fingertip!: Vector3;
  private ringCentre!: Vector3;
  /** Identity rotation: 'facing straight ahead' for the flat preview. */
  private forward!: Quaternion;

  init(): void {
    this.seat = new Seat();
    this.store = new Store();
    this.headPosition = new Vector3();
    this.fingertip = new Vector3();
    this.ringCentre = new Vector3();
    this.forward = new Quaternion();

    // Everything the person sees lives in the seat frame, so re-centring is
    // just one matrix update.
    this.stage = new Group();
    this.stage.name = 'stage';
    this.stage.matrixAutoUpdate = false;
    const stageEntity = this.world.createTransformEntity(this.stage, {
      parent: this.world.playerEntity,
      persistent: true,
    });

    this.garden = new Garden();
    this.stage.add(this.garden.group);

    this.panel = new TextPanel();
    this.stage.add(this.panel.mesh);

    this.chooseRing = new Mesh(
      new TorusGeometry(0.115, 0.004, 10, 64),
      new MeshBasicMaterial({
        color: 0xffcf8a,
        transparent: true,
        opacity: 0.85,
        toneMapped: false,
      }),
    );
    this.chooseFill = new Mesh(
      new CircleGeometry(0.115, 48),
      new MeshBasicMaterial({
        color: 0xffcf8a,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.chooseRing.add(this.chooseFill);
    this.chooseRing.visible = false;
    this.stage.add(this.chooseRing);

    this.bloom = new BloomActivity();
    this.turn = new TurnActivity();
    this.activities = [
      this.bloom,
      new ChimesActivity(),
      new FirefliesActivity(),
      this.turn,
    ];
    for (const activity of this.activities) {
      this.stage.add(activity.group);
    }

    // Hands are drawn in player space, straight from the joint matrices.
    const handsRoot = new Group();
    handsRoot.name = 'hands';
    this.world.createTransformEntity(handsRoot, {
      parent: this.world.playerEntity,
      persistent: true,
    });
    this.hands = { left: new HandState('left'), right: new HandState('right') };
    this.mirrors = {
      left: new HandState('left'),
      right: new HandState('right'),
    };
    this.visuals = {
      left: new HandVisual('left'),
      right: new HandVisual('right'),
    };
    handsRoot.add(this.visuals.left.root, this.visuals.right.root);

    this.pads = {
      skip: new PadButton('skip', 'Skip'),
      recentre: new PadButton('recentre', 'Re-centre'),
      again: new PadButton('again', 'Again'),
      finish: new PadButton('finish', 'Finish'),
    };
    for (const pad of Object.values(this.pads)) {
      pad.group.visible = false;
      const entity = this.world.createTransformEntity(pad.group, {
        parent: stageEntity,
        persistent: true,
      });
      entity.addComponent(Pad, { action: pad.action });
      entity.addComponent(RayInteractable);
    }

    this.context = {
      seat: this.seat,
      leadSide: 'right',
      otherSide: 'left',
      lead: this.hands.right,
      mirror: this.mirrors.left,
      other: this.hands.left,
      visuals: this.visuals,
      sound,
      panel: this.panel,
      home: new Vector3(0.16, 0.9, -0.36),
      range: { open: 0.86, closed: 0.66, learned: false },
      result: { range: null },
    };

    const padOf = (entity: Entity): PadButton | undefined =>
      this.pads[entity.getValue(Pad, 'action') ?? ''];
    this.cleanupFuncs.push(
      this.queries.pressed.subscribe('qualify', (entity) => {
        const pad = padOf(entity);
        if (pad?.ready && pad.aimed) {
          pad.fire();
          this.onPad(pad.action);
        }
      }),
      this.queries.hovered.subscribe('qualify', (entity) => {
        const pad = padOf(entity);
        if (pad) {
          pad.hovered = true;
        }
      }),
      this.queries.hovered.subscribe('disqualify', (entity) => {
        const pad = padOf(entity);
        if (pad) {
          pad.hovered = false;
        }
      }),
    );

    // A neutral seat so the flat (non-VR) preview has something to show.
    this.headPosition.set(0, 1.18, 0);
    this.seat.calibrate(this.headPosition, this.forward);
    this.layout();

    // A small read-only window for automated tests and debugging.
    (globalThis as Record<string, unknown>).__mirrorHand = {
      state: () => ({
        phase: this.phase,
        activity: this.phase === 'activity' ? this.activityIndex : null,
        lead: this.leadSide,
        leftTracked: this.hands.left.tracked,
        rightTracked: this.hands.right.tracked,
        leftOpenness: this.hands.left.openness,
        rightOpenness: this.hands.right.openness,
        range: { ...this.context.range },
        result: this.context.result.range,
        sessions: this.store.sessions.length,
        headY: this.seat.headY,
        pinch: Array.from(this.context.lead.pinch),
        leadPalm: this.context.lead.palm.toArray(),
        home: this.context.home.toArray(),
        title: this.panel.content.title,
        indexTip: this.context.lead.points[9].toArray(),
        progress: this.panel.content.progress ?? null,
      }),
      recentre: () => this.recentre(),
      press: (action: string) => this.onPad(action),
    };
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    const visibility = this.visibilityState.peek();
    const inXR = visibility !== VisibilityState.NonImmersive;

    this.garden.update(dt);
    this.panel.update(dt);

    if (!inXR) {
      if (this.wasInXR) {
        this.leaveXR();
      }
      this.idle(dt);
      return;
    }
    if (!this.wasInXR) {
      this.wasInXR = true;
      this.bloom.end();
      this.enter('arrive');
    }
    // The headset menu is open or the headset is off the head: hold still.
    if (visibility !== VisibilityState.Visible) {
      return;
    }

    this.hideBuiltInHands(dt);
    this.readHands(dt);
    this.phaseTime += dt;

    switch (this.phase) {
      case 'arrive':
        this.updateArrive();
        break;
      case 'choose':
        this.updateChoose(dt);
        break;
      case 'meet':
        this.updateMeet(dt);
        break;
      case 'activity':
        this.updateActivity(dt);
        break;
      case 'rest':
        if (this.phaseTime > 1.4) {
          this.startActivity(this.activityIndex + 1);
        }
        break;
      default:
        break;
    }

    this.updateHands(dt);
    this.updatePads(dt);
  }

  // ----- phases -----------------------------------------------------------

  private enter(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
    const inSession = phase === 'meet' || phase === 'activity' || phase === 'rest';
    this.pads.skip.group.visible = inSession;
    this.pads.recentre.group.visible = inSession;
    this.pads.again.group.visible = phase === 'summary';
    this.pads.finish.group.visible = phase === 'summary';
    this.chooseRing.visible = phase === 'choose';
    this.showingLostHint = false;
    this.lostFor = 0;
  }

  private updateArrive(): void {
    this.panel.hide();
    this.player.head.getWorldPosition(this.headPosition);
    this.player.worldToLocal(this.headPosition);
    // Wait for a real head pose. Some browsers give a head height near zero
    // (no floor), so do not wait for a tall reading for ever.
    const settled = this.headPosition.y > 0.3 || this.phaseTime > 3;
    if (this.phaseTime > 0.8 && settled) {
      this.recentre();
      this.chooseHold.left = 0;
      this.chooseHold.right = 0;
      this.noHandsFor = 0;
      this.enter('choose');
      sound.startDrone();
      this.promptChoose(false);
    }
  }

  private promptChoose(noHands: boolean): void {
    const returning = this.store.sessions.length > 0;
    this.panel.set({
      eyebrow: returning ? 'Welcome back' : 'Mirror Hand',
      title: 'Hold up your stronger hand',
      body: noHands
        ? 'Lift your hands to where you can see them. If you are holding controllers, put them down.'
        : 'Raise the hand that moves more easily, and keep it inside the ring for a moment.',
      note: DISCLAIMER,
    });
  }

  private updateChoose(dt: number): void {
    this.ringCentre.set(0, this.seat.workY + 0.03, -0.4);
    let best = 0;
    let chosen: Side | null = null;
    for (const side of SIDES) {
      const hand = this.hands[side];
      const inside =
        hand.tracked && hand.palm.distanceTo(this.ringCentre) < CHOOSE_RADIUS;
      this.chooseHold[side] = inside
        ? this.chooseHold[side] + dt
        : Math.max(0, this.chooseHold[side] - dt * 2);
      if (this.chooseHold[side] > best) {
        best = this.chooseHold[side];
        chosen = side;
      }
    }
    const progress = Math.min(1, best / CHOOSE_SECONDS);
    this.chooseFill.scale.setScalar(Math.max(0.001, progress));
    this.chooseRing.scale.setScalar(1 + 0.04 * Math.sin(this.phaseTime * 2.4));

    const anyHand = this.hands.left.tracked || this.hands.right.tracked;
    const before = this.noHandsFor > 5;
    this.noHandsFor = anyHand ? 0 : this.noHandsFor + dt;
    if (this.noHandsFor > 5 !== before) {
      this.promptChoose(this.noHandsFor > 5);
    }

    if (chosen && best >= CHOOSE_SECONDS) {
      this.setLead(chosen);
      sound.chord([PENTATONIC[0], PENTATONIC[2], PENTATONIC[4]], 0.35);
      this.enter('meet');
      this.meetHold = 0;
      this.panel.set({
        eyebrow: 'The mirror',
        title: `Watch your ${this.context.otherSide} hand`,
        body: `Your ${chosen} hand now moves both. Whatever it does, the other mirrors.\nTouch your hands together to begin.`,
        note: DISCLAIMER,
      });
    }
  }

  private setLead(side: Side): void {
    const context = this.context;
    this.leadSide = side;
    context.leadSide = side;
    context.otherSide = otherSide(side);
    context.lead = this.hands[side];
    context.mirror = this.mirrors[context.otherSide];
    context.other = this.hands[context.otherSide];
    // Remember a comfortable resting place for this hand; reach targets are
    // laid out around it, so nobody is asked to stretch further than they
    // showed they can.
    const sign = side === 'right' ? 1 : -1;
    const palm = context.lead.palm;
    context.home.set(
      sign * Math.min(0.22, Math.max(0.12, Math.abs(palm.x) + 0.1)),
      Math.min(this.seat.workY + 0.12, Math.max(this.seat.workY - 0.03, palm.y)),
      Math.min(-0.28, Math.max(-0.5, palm.z)),
    );
    context.range.open = Math.max(0.86, context.lead.openness);
    context.range.closed = Math.min(0.66, context.lead.openness);
    context.range.learned = false;
    this.layout();
  }

  private updateMeet(dt: number): void {
    const lead = this.context.lead;
    // The two hands touch when any part of the lead hand reaches the
    // midline, because its mirror image reaches it at the same moment.
    let gap = Infinity;
    if (lead.tracked) {
      const sign = this.context.leadSide === 'right' ? 1 : -1;
      for (const point of lead.points) {
        gap = Math.min(gap, sign * point.x);
      }
    }
    const together = gap < 0.012;
    this.meetHold =
      together && this.phaseTime > 2.5
        ? this.meetHold + dt
        : Math.max(0, this.meetHold - dt * 2);
    const glow = Math.min(1, this.meetHold / 0.5);
    this.visuals.left.setGlow(glow);
    this.visuals.right.setGlow(glow);
    if (this.meetHold > 0.5 || this.phaseTime > 30) {
      this.visuals.left.setGlow(0);
      this.visuals.right.setGlow(0);
      sound.chord([PENTATONIC[1], PENTATONIC[3], PENTATONIC[5]], 0.35);
      this.startActivity(0);
    }
  }

  private startActivity(index: number): void {
    if (index >= this.activities.length) {
      this.finishSession();
      return;
    }
    this.activityIndex = index;
    this.enter('activity');
    this.activities[index].begin(this.context);
  }

  private updateActivity(dt: number): void {
    const activity = this.activities[this.activityIndex];
    const isTurn = activity === this.turn;

    // If the lead hand drops out of view, say so instead of going quiet.
    if (!isTurn) {
      this.lostFor = this.context.lead.tracked ? 0 : this.lostFor + dt;
      if (this.lostFor > 2.5 && !this.showingLostHint) {
        this.showingLostHint = true;
        this.panel.set({
          title: `Bring your ${this.context.leadSide} hand back into view`,
          body: 'The headset can only follow a hand it can see.',
        });
      } else if (this.lostFor === 0 && this.showingLostHint) {
        this.showingLostHint = false;
        activity.prompt(this.context);
      }
    }

    if (activity.update(this.context, dt)) {
      this.endActivity();
    }
  }

  private endActivity(): void {
    const activity = this.activities[this.activityIndex];
    activity.end(this.context);
    if (this.activityIndex + 1 >= this.activities.length) {
      this.finishSession();
    } else {
      this.enter('rest');
    }
  }

  private finishSession(): void {
    const context = this.context;
    const previous = this.store.sessions
      .filter((session) => session.range !== null)
      .map((session) => session.range as number);
    const range = context.result.range;
    this.store.add({
      at: Date.now(),
      lead: context.leadSide,
      range,
    });
    this.enter('summary');
    sound.chord([0, 7, 12, 16], 0.32, 0.14);

    const count = this.store.sessions.length;
    const eyebrow = `Session ${count} complete`;
    const note = 'An estimate from hand tracking, not a clinical measurement.';
    if (range === null) {
      this.panel.set({
        eyebrow,
        title: 'Well done for showing up',
        body: `Your ${context.otherSide} hand stayed out of view this time, so nothing was measured. That is fine.`,
        note,
      });
      return;
    }
    const percent = Math.round(range * 100);
    const chart = [...previous, range].slice(-10).map((value) => Math.min(1, value));
    let body: string;
    if (previous.length === 0) {
      body = `Today your ${context.otherSide} hand opened and closed through that much of your ${context.leadSide} hand's range. This is your starting point.`;
    } else {
      const last = Math.round(previous[previous.length - 1] * 100);
      const best = Math.round(Math.max(...previous) * 100);
      body = `Of your ${context.leadSide} hand's range. Last time ${last}%, best so far ${Math.max(best, percent)}%.`;
    }
    this.panel.set({
      eyebrow,
      title: `${percent}%`,
      body,
      chart: chart.length > 1 ? chart : undefined,
      note,
    });
  }

  private onPad(action: string): void {
    sound.tick(0.3);
    switch (action) {
      case 'recentre':
        this.recentre();
        break;
      case 'skip':
        if (this.phase === 'meet') {
          this.startActivity(0);
        } else if (this.phase === 'activity') {
          this.endActivity();
        }
        break;
      case 'again':
        this.context.result.range = null;
        this.startActivity(0);
        break;
      case 'finish':
        this.world.exitXR();
        break;
      default:
        break;
    }
  }

  // ----- per-frame helpers ------------------------------------------------

  private recentre(): void {
    this.player.head.getWorldPosition(this.headPosition);
    this.player.worldToLocal(this.headPosition);
    this.seat.calibrate(this.headPosition, this.player.head.quaternion);
    this.layout();
  }

  /** Place the fixed furniture for the current seat. */
  private layout(): void {
    const seat = this.seat;
    this.stage.matrix.copy(seat.matrix);
    this.stage.matrixWorldNeedsUpdate = true;
    this.garden.place(seat.workY);
    // Just below eye level and tilted up, so it stays in view when the head
    // tips down towards the hands — and inside a narrow field of view.
    this.panel.mesh.position.set(0, seat.headY - 0.2, -0.98);
    this.panel.mesh.rotation.x = -0.15;
    this.chooseRing.position.set(0, seat.workY + 0.03, -0.4);

    // Buttons sit low and near, between the knees and the work area. "Skip"
    // and "Finish" go on the far side from the lead hand, so that hand has
    // to cross over on purpose to reach them.
    const padY = seat.workY - 0.045;
    const far = this.leadSide === 'left' ? 1 : -1;
    const place = (pad: PadButton, x: number): void => {
      pad.group.position.set(x, padY, -0.38);
      pad.group.rotation.x = -0.85;
    };
    place(this.pads.skip, far * 0.075);
    place(this.pads.recentre, -far * 0.075);
    place(this.pads.again, -far * 0.075);
    place(this.pads.finish, far * 0.075);
  }

  private readHands(dt: number): void {
    const frame = this.world.xrFrame ?? undefined;
    const space = this.world.xrReferenceSpace;
    const sources = this.world.xrSession?.inputSources;
    let left: XRInputSource | undefined;
    let right: XRInputSource | undefined;
    if (sources) {
      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        if (!source.hand) {
          continue;
        }
        if (source.handedness === 'left') {
          left = source;
        } else if (source.handedness === 'right') {
          right = source;
        }
      }
    }
    this.hands.left.read(frame, left, space, this.seat, dt);
    this.hands.right.read(frame, right, space, this.seat, dt);
  }

  /** Decide what each drawn hand shows this frame. */
  private updateHands(dt: number): void {
    const mirroring =
      this.leadSide !== null &&
      (this.phase === 'meet' ||
        this.phase === 'rest' ||
        (this.phase === 'activity' &&
          this.activities[this.activityIndex] !== this.turn));
    // When the lead hand reaches across the middle (to press a button), its
    // reflection would pass through it, so the reflection fades out.
    const leadSign = this.leadSide === 'left' ? -1 : 1;
    const crossed = mirroring && leadSign * this.context.lead.palm.x < 0.012;
    for (const side of SIDES) {
      let state = this.hands[side];
      const reflected = mirroring && side !== this.leadSide;
      if (reflected) {
        state = this.mirrors[side];
        state.mirrorFrom(this.context.lead, this.seat);
      }
      this.visuals[side].show(this.phase !== 'arrive' && !(reflected && crossed));
      this.visuals[side].update(state, dt);
    }
  }

  private updatePads(dt: number): void {
    // Any real fingertip can hold a pad down; the mirrored hand cannot.
    let tip: Vector3 | null = null;
    const side = this.leadSide ?? (this.hands.right.tracked ? 'right' : 'left');
    const hand = this.hands[side];
    // Only an extended index finger presses, so a closing fist that passes
    // over a button does nothing.
    if (hand.tracked && hand.reach[0] > 0.8) {
      const m = hand.matrices;
      this.fingertip.set(m[9 * 16 + 12], m[9 * 16 + 13], m[9 * 16 + 14]);
      this.player.localToWorld(this.fingertip);
      tip = this.fingertip;
    }
    for (const pad of Object.values(this.pads)) {
      if (pad.update(dt, tip)) {
        this.onPad(pad.action);
      }
    }
  }

  /**
   * We draw our own hands, so the SDK's default hand meshes stay off. The
   * input manager re-shows its hand model every frame, so hide the meshes
   * inside the model instead of the model itself.
   */
  private hideBuiltInHands(dt: number): void {
    this.hideTimer -= dt;
    if (this.hideTimer > 0) {
      return;
    }
    this.hideTimer = 0.5;
    const adapters = this.input.xr.visualAdapters.hand;
    for (const side of SIDES) {
      const model = adapters[side].visual?.model;
      if (model && !model.userData.mirrorHandHidden) {
        model.userData.mirrorHandHidden = true;
        model.traverse((child) => {
          if (child !== model) {
            child.visible = false;
          }
        });
      }
    }
  }

  private leaveXR(): void {
    this.wasInXR = false;
    for (const activity of this.activities) {
      activity.end(this.context);
    }
    this.enter('idle');
    this.leadSide = null;
    this.panel.hide();
    this.visuals.left.show(false);
    this.visuals.right.show(false);
    this.hands.left.tracked = false;
    this.hands.right.tracked = false;
    this.headPosition.set(0, 1.18, 0);
    this.seat.calibrate(this.headPosition, this.forward);
    this.layout();
  }

  /** Outside VR: a quiet preview of the lilies breathing. */
  private idle(dt: number): void {
    this.idleClock += dt;
    this.bloom.preview(this.seat, 0.5 + 0.5 * Math.sin(this.idleClock * 0.7), dt);
    this.visuals.left.update(this.hands.left, dt);
    this.visuals.right.update(this.hands.right, dt);
  }
}
