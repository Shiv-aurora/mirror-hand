// Dev-only: scripted sessions for devtools/record.mjs.
// Each step is [operation, argument, argument].

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
const look = (x, y, z) => ['xr', 'look_at', { device: 'headset', target: { x, y, z } }];
const wait = (ms) => ['wait', ms];
const mark = (label) => ['mark', label];

/** Sit down: enter VR with both hands resting in the lap. */
const sitDown = [
  ['xr', 'accept_session'],
  wait(1200),
  ['xr', 'set_input_mode', { mode: 'hand' }],
  [
    'xr',
    'set_transform',
    { device: 'headset', position: { x: 0, y: 1.18, z: 0 }, orientation: { pitch: 0, yaw: 0, roll: 0 } },
  ],
  place('right', 0.2, 0.84, -0.3),
  place('left', -0.2, 0.84, -0.3),
  ['xr', 'set_hand_pose', { device: 'hand-right', poseId: 'open' }],
  ['xr', 'set_hand_pose', { device: 'hand-left', poseId: 'default' }],
  wait(1500),
  ['hook', 'recentre'],
  ['unlock'],
];

export const SCENES = {
  trial: [
    ...sitDown,
    look(0, 0.9, -0.7),
    wait(800),
    ['record'],
    mark('start'),
    hand('right', 0.0, 0.92, -0.36),
    wait(2800),
    mark('chosen'),
    hand('right', 0.14, 0.9, -0.36),
    wait(1500),
    mark('end'),
  ],
};
