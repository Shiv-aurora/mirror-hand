import test from 'node:test';
import assert from 'node:assert/strict';
import { planSession, standardPlan } from '../src/tailor.ts';

const settings = (over = {}) => ({
  tailor: true,
  gentle: false,
  ...over,
  leaveOut: { bloom: false, chimes: false, reach: false, ...(over.leaveOut ?? {}) },
});
let clock = 0;
// Each record is a day after the one before, unless a test sets `at`.
const DAY = 86400000;
const rec = (over = {}) => ({ at: (clock += DAY), lead: 'left', range: 0.8, ...over });
const smooth = (over = {}) => rec({ stalls: 0, skipped: 0, comfort: 'fine', level: 0, ...over });
const hard = (over = {}) => rec({ stalls: 3, skipped: 0, comfort: 'fine', level: 0, ...over });
const sore = (over = {}) => rec({ stalls: 0, skipped: 0, comfort: 'sore', level: 0, ...over });
const painful = (over = {}) => rec({ stalls: 0, skipped: 0, comfort: 'painful', level: 0, ...over });
const plan = (sessions, s = settings()) => planSession(sessions, 'left', s);

const L0 = [0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3];
const L1 = [0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3, 3, 2, 1, 0];
const L_1 = [0, 1, 2, 3, 3, 2, 1, 0];

test('no history, default settings equals standardPlan', () => {
  assert.deepEqual(plan([]), standardPlan());
  assert.deepEqual(standardPlan().chimes, L0);
});

test('chimes and numbers for each level', () => {
  const down = plan([hard(), hard()]);
  assert.equal(down.level, -1);
  assert.deepEqual([down.bloom, down.reach, down.reachScale], [4, 5, 0.75]);
  assert.deepEqual(down.chimes, L_1);
  const up = plan([smooth(), smooth()]);
  assert.equal(up.level, 1);
  assert.deepEqual([up.bloom, up.reach, up.reachScale], [8, 8, 1.15]);
  assert.deepEqual(up.chimes, L1);
  assert.deepEqual(plan([]).chimes, L0);
});

test('rule a: painful', () => {
  const p = plan([painful()]);
  assert.equal(p.level, -1);
  assert.match(p.caution, /^Last time you said this was painful\./);
  assert.equal(p.note, "Shorter today, after last time's pain.");
  assert.equal(p.reasons[0], 'A shorter session with nearer targets, because you said the last one was painful.');
  // applies even with tailoring off
  const off = plan([painful()], settings({ tailor: false }));
  assert.equal(off.level, -1);
  assert.ok(off.caution);
});

test('rule b: gentle', () => {
  const p = plan([], settings({ gentle: true }));
  assert.equal(p.level, -1);
  assert.equal(p.note, 'Shorter session, as set.');
  assert.deepEqual(p.reasons, ['A shorter session with nearer targets, as set on the start page.']);
  assert.equal(p.caution, null);
});

test('rule c: tailoring off', () => {
  const p = plan([hard(), hard()], settings({ tailor: false }));
  assert.deepEqual(p, standardPlan());
  const f = plan(fingerSessions(), settings({ tailor: false }));
  assert.equal(f.focus, null);
});

test('rule d: two sore', () => {
  const p = plan([sore(), sore()]);
  assert.equal(p.level, -1);
  assert.equal(p.note, 'Shorter today, after two sore sessions.');
  assert.deepEqual(p.reasons, ['A shorter session, because the last two left your hand sore.']);
  const stay = plan([sore({ level: -1 }), sore({ level: -1 })]);
  assert.equal(stay.level, -1);
  assert.equal(stay.note, 'Shorter today, after two sore sessions.');
  assert.equal(plan([sore({ level: 1 }), sore({ level: 1 })]).level, 0);
});

test('rule e: two hard', () => {
  const p = plan([hard(), hard()]);
  assert.equal(p.level, -1);
  assert.equal(p.note, 'Shorter today, with nearer targets.');
  assert.match(p.reasons[0], /hard to finish in the last two sessions\.$/);
  assert.equal(plan([hard({ level: -1 }), hard({ level: -1 })]).level, -1);
  assert.equal(plan([hard({ level: 1 }), hard({ level: 1 })]).level, 0);
  // a skip alone makes a record hard
  assert.equal(plan([smooth({ skipped: 1 }), smooth({ skipped: 2 })]).level, -1);
});

test('rule f: two smooth', () => {
  const up = plan([smooth(), smooth()]);
  assert.equal(up.level, 1);
  assert.equal(up.note, 'A little more today: the last two went well.');
  assert.deepEqual(up.reasons, ['A little more of each movement, because the last two sessions went smoothly.']);
  const back = plan([smooth({ level: -1 }), smooth({ level: -1 })]);
  assert.equal(back.level, 0);
  assert.equal(back.note, null);
  assert.deepEqual(back.reasons, ['Back to the standard session, because the last two went smoothly.']);
  assert.equal(plan([smooth({ level: 1 }), smooth({ level: 1 })]).level, 1);
});

test('rule g: hold', () => {
  const one = plan([smooth({ level: 1 }), hard({ level: 1 })]);
  assert.equal(one.level, 1);
  assert.deepEqual(one.reasons, ['Staying with a little more of each movement.']);
  assert.equal(one.note, null);
  const down = plan([smooth({ level: -1 }), smooth({ level: -1, comfort: 'sore' })]);
  assert.equal(down.level, -1);
  assert.deepEqual(down.reasons, ['Staying with the shorter session for now.']);
  assert.equal(down.note, 'Shorter session, as last time.');
  const zero = plan([smooth()]);
  assert.deepEqual(zero.reasons, []);
  assert.equal(zero.note, null);
  assert.equal(zero.level, 0);
});

test('precedence: painful > gentle > sore > hard > smooth', () => {
  assert.ok(plan([sore(), painful()], settings({ gentle: true })).caution);
  assert.equal(plan([sore(), sore()], settings({ gentle: true })).note, 'Shorter session, as set.');
  const soreHard = () => rec({ stalls: 5, skipped: 1, comfort: 'sore', level: 0 });
  assert.equal(plan([soreHard(), soreHard()]).note, 'Shorter today, after two sore sessions.');
  // a hard pair beats a smooth pair is by definition exclusive; hard+smooth mix holds
  assert.equal(plan([hard(), smooth()]).level, 0);
});

test('only sessions with the same lead hand count', () => {
  const p = plan([hard(), hard({ lead: 'right' }), hard({ lead: 'right' }), smooth({ level: 1 })]);
  // left sessions: hard, smooth(level 1) -> hold at 1
  assert.equal(p.level, 1);
  assert.equal(planSession([hard({ lead: 'right' }), hard({ lead: 'right' })], 'left', settings()).level, 0);
  // only the last three are looked at
  const many = [hard(), hard(), hard(), smooth(), smooth()];
  assert.equal(plan(many).level, 1);
});

test('old records without optional fields', () => {
  const old = () => rec();
  assert.deepEqual(plan([old(), old(), old()]), standardPlan());
  assert.equal(plan([old(), old()]).level, 0);
  // unmeasured records are neither hard nor smooth
  assert.equal(plan([old(), hard()]).level, 0);
});

test('leave-out and the never-empty fallback', () => {
  const p = plan([], settings({ leaveOut: { bloom: true } }));
  assert.deepEqual(p.include, { bloom: false, chimes: true, reach: true });
  const all = plan([], settings({ leaveOut: { bloom: true, chimes: true, reach: true } }));
  assert.deepEqual(all.include, { bloom: true, chimes: true, reach: true });
});

function fingerSessions(fingers = [[0.9, 0.9, 0.5, 0.9], [0.9, 0.9, 0.6, 0.9]]) {
  return fingers.map((f) => smooth({ fingers: f, comfort: 'fine', stalls: 1 }));
}

test('focus finger triggered for each finger', () => {
  const names = ['index', 'middle', 'ring', 'little'];
  const passes = [[0, 1, 0, 2], [1, 0, 1, 2], [2, 1, 2, 3], [3, 2, 3, 1]];
  for (let f = 0; f < 4; f++) {
    const a = [0.9, 0.9, 0.9, 0.9];
    a[f] = 0.5;
    const p = plan(fingerSessions([a, a]));
    assert.equal(p.focus, f);
    assert.deepEqual(p.chimes, [...L0.slice(0, 8), ...passes[f]]);
    assert.equal(p.reasons.at(-1), `Extra touches for your ${names[f]} finger, which opened least in your last sessions.`);
    assert.equal(p.note, `Extra touches for your ${names[f]} finger today.`);
  }
});

test('focus keeps an existing note and adds a second reason', () => {
  const a = [0.9, 0.5, 0.9, 0.9];
  const p = plan([...fingerSessions([a, a]).map((s) => ({ ...s, level: 1 }))].slice(0, 2));
  // hold at level 1: reason already present, note null -> focus note
  assert.equal(p.reasons.length, 2);
  const g = plan(fingerSessions([a, a]), settings({ gentle: true }));
  assert.equal(g.note, 'Shorter session, as set.');
  assert.equal(g.focus, 1);
  assert.equal(g.reasons.length, 2);
  assert.deepEqual(g.chimes, [0, 1, 2, 3, 1, 0, 1, 2]);
});

test('focus not triggered under the 0.15 gap', () => {
  const a = [0.9, 0.9, 0.9, 0.9];
  const small = [0.9, 0.9, 0.9, 0.9].map((v, i) => (i === 2 ? 0.76 : v)); // gap 0.14
  assert.equal(plan(fingerSessions([small, small])).focus, null);
  const edge = [0.9, 0.9, 0.9, 0.9].map((v, i) => (i === 2 ? 0.7 : v)); // gap 0.2
  assert.equal(plan(fingerSessions([edge, edge])).focus, 2);
  void a;
});

test('focus needs enough records and values', () => {
  const a = [0.9, 0.9, 0.5, 0.9];
  assert.equal(plan(fingerSessions([a])).focus, null);
  // records with fingers null, missing or wrong length are ignored
  const s = [smooth({ fingers: a }), smooth({ fingers: null }), smooth({ fingers: [1, 2] })];
  assert.equal(plan(s).focus, null);
  // null values: ring only has one value
  const n1 = [0.9, 0.9, 0.5, 0.9];
  const n2 = [0.9, 0.9, null, 0.9];
  assert.equal(plan(fingerSessions([n1, n2])).focus, null);
  // null values are skipped in the average when there are enough others
  const three = fingerSessions([n1, n2, [0.9, 0.9, 0.5, 0.9]]);
  assert.equal(plan(three).focus, 2);
});

test('focus uses only the last three same-lead sessions', () => {
  const bad = [0.9, 0.9, 0.5, 0.9];
  const ok = [0.9, 0.9, 0.9, 0.9];
  const s = fingerSessions([bad, bad, ok, ok, ok]);
  assert.equal(plan(s).focus, null);
});

test('focus skipped when chimes left out or caution set', () => {
  const a = [0.9, 0.9, 0.5, 0.9];
  const s = fingerSessions([a, a]);
  const out = plan(s, settings({ leaveOut: { chimes: true } }));
  assert.equal(out.focus, null);
  assert.equal(out.reasons.length, 0);
  const caution = plan([...s, painful({ fingers: a }), painful({ fingers: a })]);
  assert.ok(caution.caution);
  assert.equal(caution.focus, null);
  assert.deepEqual(caution.chimes, L_1);
});

test('every note is 60 characters or fewer', () => {
  const a = [0.9, 0.9, 0.5, 0.9];
  const cases = [
    plan([painful()]),
    plan([], settings({ gentle: true })),
    plan([sore(), sore()]),
    plan([hard(), hard()]),
    plan([smooth(), smooth()]),
    plan([smooth({ level: -1 }), smooth({ level: -1, comfort: 'sore' })]),
    plan(fingerSessions([a, a])),
  ];
  for (const p of cases) {
    assert.ok(p.note !== null);
    assert.ok(p.note.length <= 60, p.note);
  }
  for (const n of ['index', 'middle', 'ring', 'little']) {
    assert.ok(`Extra touches for your ${n} finger today.`.length <= 60);
  }
});

test('inputs are not mutated and results are fresh', () => {
  const a = [0.9, 0.9, 0.5, 0.9];
  const sessions = fingerSessions([a, a, a]);
  const st = settings();
  const before = JSON.stringify([sessions, st]);
  const p1 = planSession(sessions, 'left', st);
  const p2 = planSession(sessions, 'left', st);
  assert.equal(JSON.stringify([sessions, st]), before);
  assert.notEqual(p1.chimes, p2.chimes);
  assert.notEqual(p1.include, p2.include);
  assert.notEqual(p1.reasons, p2.reasons);
  assert.notEqual(p1.include, st.leaveOut);
  p1.chimes.push(9);
  assert.deepEqual(standardPlan().chimes, L0);
  const s1 = standardPlan();
  s1.chimes.push(1);
  assert.deepEqual(standardPlan().chimes, L0);
});

test('stepping up needs two smooth sessions on different days', () => {
  const noon = new Date(2026, 10, 10, 12).getTime();
  const sameDay = [smooth({ at: noon }), smooth({ at: noon + 3600000 })];
  assert.equal(plan(sameDay).level, 0);
  assert.deepEqual(plan(sameDay).reasons, []);
  const nextDay = [smooth({ at: noon }), smooth({ at: noon + DAY })];
  assert.equal(plan(nextDay).level, 1);
});

test('stepping down does not wait for another day', () => {
  const noon = new Date(2026, 10, 10, 12).getTime();
  assert.equal(plan([hard({ at: noon }), hard({ at: noon + 60000 })]).level, -1);
  assert.equal(plan([sore({ at: noon }), sore({ at: noon + 60000 })]).level, -1);
});

test('a step down from the fuller session says it is back to standard', () => {
  for (const make of [hard, sore]) {
    const p = plan([make({ level: 1 }), make({ level: 1 })]);
    assert.equal(p.level, 0);
    assert.equal(p.note, null);
    assert.equal(p.reasons.length, 1);
    assert.match(p.reasons[0], /^Back to the standard session/);
    assert.doesNotMatch(p.reasons[0], /shorter|nearer/i);
  }
});

test('pain reported with the other hand leading still brings the caution', () => {
  const p = plan([smooth(), smooth(), painful({ lead: 'right' })]);
  assert.equal(p.level, -1);
  assert.notEqual(p.caution, null);
});

test('a damaged save with empty entries does not throw', () => {
  const p = plan([null, smooth(), undefined, smooth()]);
  assert.equal(p.level, 1);
});

test('a stored level outside the range is treated as the nearest level', () => {
  assert.equal(plan([rec({ stalls: 1, skipped: 0, comfort: 'fine', level: 5 })]).level, 1);
});
