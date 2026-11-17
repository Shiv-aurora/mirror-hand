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
  until('(s) => s.phase === "summary"', 14000),
  wait(800),
  ['hook', 'press', 'finish'],
  wait(1500),
];

export const SCENES = {
  seed1: seed(0.2),
  seed2: seed(0.36),

  // Part one: sit down, choose a hand, meet the mirror, open-and-close,
  // finger touches.
  one: [
    ...sitDown,
    // A tighter lens than the emulator's default, so the hands fill the frame.
    ['eval', 'IWER_MCP.device.fovy = 1.0'],
    head(-7, 6, 0.3),
    wait(900),
    ['record'],
    mark('choose'),
    wait(2600),
    head(-20, 0, 1.6),
    wait(1600),
    hand('right', 0.03, 0.93, -0.36, 1.0),
    until('(s) => s.phase === "meet"', 8000),
    mark('mirror'),
    hand('right', ...WORK, 0.8),
    wait(1500),
    // Show that the reflection follows: lift, turn, close, open.
    hand('right', 0.2, 1.0, -0.44, 0.9),
    wait(1000),
    pose('right', 'fist', 0.6),
    wait(800),
    pose('right', 'open', 0.6),
    wait(700),
    hand('right', ...WORK, 0.8),
    wait(1000),
    // Reveal where the left hand really is.
    ['hook', 'reveal'],
    mark('reveal'),
    wait(900),
    pose('right', 'peace', 0.5),
    wait(1100),
    pose('right', 'open', 0.5),
    wait(900),
    hand('right', 0.2, 0.98, -0.42, 0.8),
    wait(900),
    hand('right', ...WORK, 0.8),
    wait(1200),
    mark('touch'),
    hand('right', 0.04, 0.93, -0.38, 0.9),
    until('(s) => s.activity === 0', 8000),
    mark('bloom'),
    hand('right', ...WORK, 0.8),
    wait(1400),
    ...repeat(6, () => [
      pose('right', 'fist', 0.9),
      wait(1250),
      pose('right', 'open', 0.9),
      wait(1250),
    ]),
    until('(s) => s.activity === 1', 6000),
    mark('chimes'),
    ['hook', 'reveal', 'off'],
    wait(1600),
    ...repeat(CHIME_ORDER.length, (i) => [
      pose('right', PINCHES[CHIME_ORDER[i]], 0.3),
      wait(680),
      pose('right', 'open', 0.3),
      wait(560),
    ]),
    until('(s) => s.activity === 2', 6000),
    mark('fireflies'),
    wait(400),
  ],

  // Part two: reach, your turn, summary, back to the landing page.
  two: [
    ['unlock'],
    ['record'],
    mark('fireflies'),
    wait(900),
    ...repeat(REACHES.length, (i) => [
      hand('right', ...reachWrist(i), 0.8),
      until(`(s) => s.progress >= ${(i + 1) / REACHES.length - 0.01} || s.activity !== 2`, 5000),
      wait(250),
    ]),
    until('(s) => s.activity === 3', 8000),
    mark('turn'),
    hand('right', ...LAP.right, 0.9),
    wait(1100),
    hand('left', -0.15, 0.93, -0.38, 1.0),
    wait(2400),
    ...repeat(6, () => [
      partFist('left', 0.45, 1.0),
      wait(1450),
      pose('left', 'default', 1.0),
      wait(1450),
    ]),
    until('(s) => s.phase === "summary"', 12000),
    mark('summary'),
    head(-13, 0, 1.2),
    hand('left', ...LAP.left, 0.9),
    wait(6500),
    mark('finish'),
    head(-20, 0, 0.8),
    wait(900),
    ['hook', 'press', 'finish'],
    wait(4500),
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
