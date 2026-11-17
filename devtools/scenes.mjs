// Dev-only: scripted sessions for devtools/record.mjs.
// Each step is [operation, argument, argument]. The emulated person sits with
// the head at 1.18 m, so the work area is at about y = 0.88 m.

const palmDown = { fingers: 'forward', palm: 'down' };
const hand = (side, x, y, z, duration = 0.6) => [
  'xr',
  'animate_to',
  {
    device: `hand-${side}`,
    position: { x, y, z },
    anchor: 'wrist',
    orientation: palmDown,
    duration,
  },
];
const place = (side, x, y, z) => [
  'xr',
  'set_transform',
  { device: `hand-${side}`, position: { x, y, z }, anchor: 'wrist', orientation: palmDown },
];
const pose = (side, poseId, duration = 0.5) => [
  'xr',
  'set_hand_pose',
  { device: `hand-${side}`, poseId, duration },
];
/** A hand that only closes part of the way: `weight` 0 is open, 1 is a fist. */
const partFist = (side, weight, duration = 1.1) => [
  'xr',
  'set_hand_pose',
  {
    device: `hand-${side}`,
    poseId: 'default',
    fingers: Object.fromEntries(
      ['thumb', 'index', 'middle', 'ring', 'pinky'].map((finger) => [
        finger,
        { poseId: 'fist', weight },
      ]),
    ),
    duration,
  },
];
/** Turn the head: pitch is negative looking down, yaw is positive to the left (degrees). */
const head = (pitch, yaw = 0, duration = 1.2) => [
  'xr',
  'animate_to',
  {
    device: 'headset',
    position: { x: 0, y: 1.18, z: 0 },
    orientation: { pitch, yaw, roll: 0 },
    duration,
  },
];
const wait = (ms) => ['wait', ms];
const mark = (label) => ['mark', label];
const until = (test, timeout = 20000) => ['until', test, timeout];
const repeat = (count, build) => Array.from({ length: count }, (_, i) => build(i)).flat();

const LAP = { right: [0.25, 0.84, -0.27], left: [-0.25, 0.84, -0.27] };
const WORK = [0.15, 0.93, -0.38];

/** Sit down: enter VR with both hands resting in the lap. */
const sitDown = [
  ['xr', 'accept_session'],
  wait(1200),
  ['xr', 'set_input_mode', { mode: 'hand' }],
  [
    'xr',
    'set_transform',
    {
      device: 'headset',
      position: { x: 0, y: 1.18, z: 0 },
      orientation: { pitch: -10, yaw: 0, roll: 0 },
    },
  ],
  place('right', ...LAP.right),
  place('left', ...LAP.left),
  ['xr', 'set_hand_pose', { device: 'hand-right', poseId: 'open' }],
  ['xr', 'set_hand_pose', { device: 'hand-left', poseId: 'default' }],
  wait(1500),
  ['hook', 'recentre'],
  ['unlock'],
];

/** Hold the right hand in the ring until it is chosen as the stronger hand. */
const chooseRight = [
  hand('right', 0.03, 0.93, -0.36, 0.9),
  until('(s) => s.phase === "meet"', 8000),
];

// Where the reach targets are, worked out the same way the app does it.
const HOME = [0.129, 0.929, -0.408];
const WORK_Y = 0.88;
const REACHES = [
  [0.02, 0.05, -0.02],
  [0.09, 0.1, -0.06],
  [0.11, 0.0, -0.1],
  [0.0, 0.15, -0.1],
  [0.13, 0.07, 0.0],
  [-0.03, 0.02, -0.13],
  [0.1, 0.16, -0.04],
  [0.04, 0.08, -0.15],
];
const reachWrist = (index) => {
  const [out, up, forward] = REACHES[index];
  const z = Math.min(-0.22, HOME[2] + forward);
  const x = Math.min(0.56 * -z, Math.max(0.085, HOME[0] + out));
  const y = Math.max(WORK_Y - 0.03, HOME[1] + up - 0.04);
  // The palm sits about 5 cm in front of the wrist.
  return [x + 0.001, y + 0.001, z + 0.048];
};

const PINCHES = ['pinch', 'pinch-middle', 'pinch-ring', 'pinch-pinky'];
const CHIME_ORDER = [0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3];

/** Wait for "How did that feel?", answer it, and wait for the summary. */
const answer = (comfort) => [
  until('(s) => s.phase === "comfort"', 14000),
  wait(600),
  ['hook', 'press', comfort],
  until('(s) => s.phase === "summary"', 4000),
];

/** One unrecorded earlier session, with the left hand closing by `weight`. */
const seed = (weight) => [
  ...sitDown,
  head(-20, 0, 0.4),
  ...chooseRight,
  hand('right', ...WORK, 0.4),
  wait(600),
  ['hook', 'press', 'skip'],
  until('(s) => s.activity === 0', 4000),
  ['hook', 'press', 'skip'],
  until('(s) => s.activity === 1', 4000),
  ['hook', 'press', 'skip'],
  until('(s) => s.activity === 2', 4000),
  ['hook', 'press', 'skip'],
  until('(s) => s.activity === 3', 4000),
  hand('right', ...LAP.right, 0.4),
  hand('left', -0.15, 0.93, -0.38, 0.5),
  wait(1500),
  ...repeat(4, () => [
    partFist('left', weight, 1.0),
    wait(1500),
    pose('left', 'default', 1.0),
    wait(1500),
  ]),
  ...answer('fine'),
  wait(800),
  ['hook', 'press', 'finish'],
  wait(1500),
];

// ---- whole-session checks -----------------------------------------------------
const checkA = (reps, order) => [
  ...sitDown,
  head(-20, 0, 0.4),
  ...chooseRight,
  hand('right', ...WORK, 0.5),
  wait(2800),
  hand('right', 0.04, 0.93, -0.38, 0.7),
  until('(s) => s.activity === 0', 8000),
  hand('right', ...WORK, 0.6),
  wait(900),
  ...repeat(reps, () => [
    pose('right', 'fist', 0.7),
    wait(1000),
    pose('right', 'open', 0.7),
    wait(1000),
  ]),
  until('(s) => s.activity === 1', 6000),
  wait(1200),
  ...repeat(order.length, (i) => [
    pose('right', PINCHES[order[i]], 0.3),
    wait(650),
    pose('right', 'open', 0.3),
    wait(520),
  ]),
  until('(s) => s.activity === 2', 6000),
];

/** The left hand closes each finger by its own amount; the ring finger least. */
const unevenFist = (duration) => [
  'xr',
  'set_hand_pose',
  {
    device: 'hand-left',
    poseId: 'default',
    fingers: {
      thumb: { poseId: 'fist', weight: 0.5 },
      index: { poseId: 'fist', weight: 0.6 },
      middle: { poseId: 'fist', weight: 0.55 },
      ring: { poseId: 'fist', weight: 0.12 },
      pinky: { poseId: 'fist', weight: 0.5 },
    },
    duration,
  },
];

const checkB = (count, scale) => [
  ['unlock'],
  wait(600),
  ...repeat(count, (i) => {
    const [out, up, forward] = REACHES[i].map((v) => v * scale);
    const z = Math.min(-0.22, HOME[2] + forward);
    const x = Math.min(0.56 * -z, Math.max(0.085, HOME[0] + out));
    const y = Math.max(WORK_Y - 0.03, HOME[1] + up - 0.04);
    return [
      hand('right', x + 0.001, y + 0.001, z + 0.048, 0.8),
      until(`(s) => s.progress >= ${(i + 1) / count - 0.01} || s.activity !== 2`, 5000),
      wait(250),
    ];
  }),
  until('(s) => s.activity === 3', 8000),
  hand('right', ...LAP.right, 0.8),
  hand('left', -0.15, 0.93, -0.38, 0.9),
  wait(2200),
  ...repeat(6, () => [
    unevenFist(1.0),
    wait(1400),
    pose('left', 'default', 1.0),
    wait(1400),
  ]),
  until('(s) => s.phase === "comfort"', 14000),
  hand('left', ...LAP.left, 0.8),
  hand('right', ...WORK, 0.8),
  wait(1200),
];

// ---- camera and variation -----------------------------------------------------
const EYE = [0, 1.18, 0];
const RAD = Math.PI / 180;
/** A camera at `p` looking `pitch` degrees up (negative is down) and `yaw` to the left. */
const view = (p, pitch, yaw = 0) => ({
  p,
  look: [
    p[0] - Math.sin(yaw * RAD) * Math.cos(pitch * RAD),
    p[1] + Math.sin(pitch * RAD),
    p[2] - Math.cos(yaw * RAD) * Math.cos(pitch * RAD),
  ],
});
/** ['cam', { p, look, fov, dur, ease }]: see moveCam in record.mjs. */
const cam = (to) => ['cam', to];
/** The same "random" number every run, so a take can be repeated. */
const rnd = (i) => {
  const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  return x - Math.floor(x);
};
const between = (i, low, high) => low + (high - low) * rnd(i);
const round3 = (x) => Math.round(x * 1000) / 1000;
/** WORK, nudged a little differently each time, so the hand never sits dead still. */
const near = (i, spread = 0.012) => [
  round3(WORK[0] + (rnd(i) - 0.5) * 2 * spread),
  round3(WORK[1] + (rnd(i + 31) - 0.5) * 2 * spread),
  round3(WORK[2] + (rnd(i + 57) - 0.5) * 2 * spread),
];

export const SCENES = {
  seed1: seed(0.2),
  seed2: seed(0.36),

  // How it works: the tracked joints, the mirror plane, and the reflection,
  // seen first as the person sees it and then from the side.
  explain: [
    ...sitDown,
    cam({ ...view(EYE, -20), fov: 1.0 }),
    wait(400),
    ...chooseRight,
    hand('right', ...WORK, 0.7),
    wait(1100),
    ['record'],
    mark('start'),
    wait(1300),
    ['hook', 'explain', 1],
    mark('joints'),
    wait(900),
    pose('right', 'fist', 0.9),
    wait(1150),
    pose('right', 'open', 0.9),
    wait(1000),
    mark('orbit'),
    cam({ p: [0.26, 1.3, 0.02], look: [-0.1, 0.94, -0.42], fov: 0.8, dur: 3.2 }),
    wait(1000),
    ['hook', 'explain', 2],
    mark('plane'),
    wait(2500),
    ['hook', 'explain', 3],
    mark('reflect'),
    cam({ p: [0.31, 1.23, -0.07], look: [-0.1, 0.94, -0.42], fov: 0.8, dur: 11, ease: 'linear' }),
    wait(1500),
    pose('right', 'fist', 0.9),
    wait(1250),
    pose('right', 'open', 0.9),
    wait(1000),
    hand('right', 0.2, 1.0, -0.44, 1.0),
    wait(1200),
    pose('right', 'pinch', 0.5),
    wait(900),
    pose('right', 'open', 0.5),
    wait(700),
    hand('right', ...WORK, 1.0),
    wait(1500),
    mark('end'),
  ],

  // Part one: sit down, choose a hand, meet the mirror, open-and-close,
  // finger touches.
  one: [
    ...sitDown,
    cam({ ...view(EYE, -7, 6), fov: 1.0 }),
    wait(900),
    ['record'],
    mark('choose'),
    wait(2200),
    cam({ ...view(EYE, -20), dur: 1.8 }),
    wait(1700),
    hand('right', 0.03, 0.93, -0.36, 1.0),
    until('(s) => s.phase === "meet"', 8000),
    mark('mirror'),
    hand('right', ...WORK, 0.9),
    // A slow push in while the reflection is shown to follow.
    cam({ ...view([0, 1.17, -0.05], -20), dur: 9, ease: 'linear' }),
    wait(1300),
    hand('right', 0.2, 1.0, -0.44, 1.0),
    wait(1050),
    pose('right', 'fist', 0.7),
    wait(900),
    pose('right', 'open', 0.6),
    wait(650),
    // Stay clear of the middle: a thumb within 2 cm of it starts the session.
    hand('right', 0.165, 0.95, -0.4, 0.9),
    wait(1100),
    // Look down: where the left hand really is.
    ['hook', 'reveal'],
    mark('reveal'),
    cam({ ...view([0, 1.17, -0.05], -35), dur: 1.3 }),
    wait(1700),
    pose('right', 'peace', 0.5),
    wait(1000),
    pose('right', 'open', 0.5),
    wait(700),
    hand('right', 0.21, 0.99, -0.42, 0.9),
    wait(850),
    pose('right', 'fist', 0.6),
    wait(750),
    pose('right', 'open', 0.6),
    wait(650),
    hand('right', ...WORK, 0.9),
    wait(700),
    mark('lookup'),
    cam({ ...view(EYE, -20), dur: 1.2 }),
    wait(1300),
    ['hook', 'reveal', 'off'],
    wait(600),
    mark('touch'),
    hand('right', 0.04, 0.93, -0.38, 0.9),
    until('(s) => s.activity === 0', 8000),
    mark('bloom'),
    hand('right', ...WORK, 0.8),
    cam({ ...view([0, 1.165, -0.07], -20), dur: 17, ease: 'linear' }),
    wait(1400),
    ...repeat(6, (i) => {
      const close = between(i, 0.8, 1.05);
      const open = between(i + 11, 0.8, 1.0);
      return [
        hand('right', ...near(i), 1.4),
        pose('right', 'fist', round3(close)),
        wait(Math.round(close * 1000 + between(i + 5, 250, 520))),
        pose('right', 'open', round3(open)),
        wait(Math.round(open * 1000 + between(i + 7, 250, 480))),
      ];
    }),
    until('(s) => s.activity === 1', 6000),
    mark('chimes'),
    // Closer, for the fingers.
    cam({ ...view([0, 1.13, -0.1], -27), fov: 0.86, dur: 1.6 }),
    wait(1700),
    ...repeat(CHIME_ORDER.length, (i) => [
      pose('right', PINCHES[CHIME_ORDER[i]], round3(between(i + 20, 0.27, 0.36))),
      wait(Math.round(between(i + 40, 620, 760))),
      pose('right', 'open', round3(between(i + 60, 0.27, 0.34))),
      wait(Math.round(between(i + 80, 480, 640))),
    ]),
    until('(s) => s.activity === 2', 6000),
    mark('fireflies'),
    wait(400),
  ],

  // Part two: reach, your turn, summary, back to the landing page.
  two: [
    ['unlock'],
    cam({ ...view(EYE, -19), fov: 1.0 }),
    wait(500),
    ['record'],
    mark('fireflies'),
    // Ease back a little as the hands reach out.
    cam({ ...view([0, 1.19, 0.04], -19), dur: 9, ease: 'linear' }),
    wait(900),
    ...repeat(REACHES.length, (i) => [
      hand('right', ...reachWrist(i), round3(between(i + 100, 0.7, 0.95))),
      until(`(s) => s.progress >= ${(i + 1) / REACHES.length - 0.01} || s.activity !== 2`, 5000),
      wait(Math.round(between(i + 120, 200, 380))),
    ]),
    until('(s) => s.activity === 3', 8000),
    mark('turn'),
    hand('right', ...LAP.right, 0.9),
    cam({ ...view(EYE, -21), dur: 1.4 }),
    wait(1100),
    hand('left', -0.15, 0.93, -0.38, 1.0),
    wait(2400),
    cam({ ...view([-0.02, 1.165, -0.06], -21), dur: 15, ease: 'linear' }),
    ...repeat(6, (i) => {
      const close = between(i + 140, 0.95, 1.25);
      const open = between(i + 150, 0.9, 1.15);
      return [
        partFist('left', round3(between(i + 160, 0.38, 0.5)), round3(close)),
        wait(Math.round(close * 1000 + between(i + 170, 300, 560))),
        pose('left', 'default', round3(open)),
        wait(Math.round(open * 1000 + between(i + 180, 300, 520))),
      ];
    }),
    ...answer('fine'),
    mark('summary'),
    cam({ ...view(EYE, -12), dur: 1.3 }),
    hand('left', ...LAP.left, 0.9),
    wait(1800),
    // Lean in towards the result.
    cam({ ...view([0, 1.17, -0.22], -11), dur: 5.5, ease: 'out' }),
    wait(5600),
    mark('finish'),
    cam({ ...view(EYE, -20), dur: 1.1 }),
    wait(1200),
    ['hook', 'press', 'finish'],
    mark('landing'),
    cam({ ...view([0, 1.2, 0.02], -15), dur: 7, ease: 'linear' }),
    wait(7000),
    mark('end'),
  ],

  // Meta VR Glasses profile: the narrower view, and a button pressed by
  // looking at it and pinching.
  glasses: [
    ...sitDown,
    head(-20, 0, 0.3),
    wait(700),
    ...chooseRight,
    hand('right', ...WORK, 0.6),
    wait(1200),
    ['record'],
    mark('view'),
    hand('right', 0.04, 0.93, -0.38, 0.9),
    until('(s) => s.activity === 0', 8000),
    hand('right', ...WORK, 0.8),
    wait(1300),
    pose('right', 'fist', 0.9),
    wait(1250),
    pose('right', 'open', 0.9),
    wait(1500),
    mark('gaze'),
    ['xr', 'look_at', { device: 'gaze', target: { x: -0.075, y: 0.835, z: -0.38 } }],
    wait(1800),
    mark('pinch'),
    ['xr', 'select', { device: 'hand-right' }],
    until('(s) => s.activity === 1', 6000),
    wait(2500),
    mark('end'),
  ],

  // Unrecorded checks of a whole session, in two runs (a run is limited to
  // under two minutes): `a` goes from sitting down to the end of the finger
  // touches, `b` from the fireflies to the question at the end, which it
  // leaves unanswered. `check1` is the standard session; `check3` is the
  // fuller one with extra ring-finger touches.
  check1a: checkA(6, CHIME_ORDER),
  check1b: checkB(8, 1),
  check3a: checkA(8, [0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3, 2, 1, 2, 3]),
  check3b: checkB(8, 1.15),
  // Sit down, choose the right hand and stop on "The mirror" panel.
  checkMeet: [...sitDown, head(-20, 0, 0.4), ...chooseRight, hand('right', ...WORK, 0.5), wait(1500)],

  trial: [
    ...sitDown,
    wait(800),
    ['record'],
    mark('start'),
    hand('right', 0.03, 0.93, -0.36),
    wait(2800),
    mark('chosen'),
    hand('right', ...WORK),
    wait(1500),
    mark('end'),
  ],
};
