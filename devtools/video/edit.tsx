/**
 * Mirror Hand: demo video for the Meta VR Start Developer Competition 2026.
 * 1920x1080, 30 fps. Lengths come from the BEATS list below.
 *
 * Every picture is the app's own footage, recorded in the Immersive Web SDK
 * emulator (devtools/record.mjs). In/out points are seconds into those
 * recordings, taken from the marks the recorder wrote beside each one.
 *
 * Rendered with raea 0.1.6 (github.com/shinyobjectz/raea) from a folder that
 * holds this file and media/ (the recordings as one.mp4, two.mp4, glasses.mp4,
 * closing.mp4, and fonts/Inter.ttf):  raea render edit.tsx -o demo.mp4
 *
 * Layout: the footage is punched in and held to the right, the words sit in
 * a column on the left over the lake. Hard cuts; the app's own sound.
 */
import {
  AbsoluteFill,
  Audio,
  Composition,
  Easing,
  Sequence,
  Video,
  interpolate,
  registerRoot,
  staticFile,
  useCurrentFrame,
} from "raea";

// ---- the look ---------------------------------------------------------------
const FPS = 30;
const W = 1920;
const H = 1080;
const NIGHT = "#0c0a1d";
const INK = "#f6efe6";
const SOFT = "rgba(246,239,230,0.72)";
const ACCENT = "#ffcf8a";
const FACE = `"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif`;
const FONT_CSS = `@font-face { font-family: "Inter"; src: url(${staticFile("fonts/Inter.ttf")}); font-weight: 100 900; }`;

// ---- helpers ----------------------------------------------------------------
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const OUT = Easing.out(Easing.cubic);
const sec = (s: number) => Math.round(s * FPS);
/** The recordings are quiet; this lifts all of them by the same amount, with the loudest bell still under the ceiling. */
const GAIN = 9;

// ---- data -------------------------------------------------------------------
const ONE = staticFile("one.mp4");
const TWO = staticFile("two.mp4");
const GLASSES = staticFile("glasses.mp4");
const CLOSING = staticFile("closing.mp4");

/** A window onto the 1920x1080 recording: its top-left corner and the zoom. */
interface Win { x: number; y: number; scale: number }
/** Hands and panel held to the right; the left 640 px is lake, for the words. */
const RIGHT: Win = { x: 0, y: 40, scale: 1.2 };
/** The same, lower, so the lap is in frame. */
const LAP: Win = { x: 0, y: 180, scale: 1.2 };

interface Line { text: string; at: number; until?: number; kind?: "say" | "note" }

// ---- parts ------------------------------------------------------------------

/** A stretch of a recording, shown through a window that can move once. */
function Shot({ src, from, dur, win, to, moveAt = 0, moveFor = 1, gainDb = GAIN }: {
  src: string; from: number; dur: number; win: Win; to?: Win; moveAt?: number; moveFor?: number; gainDb?: number;
}) {
  const f = useCurrentFrame();
  const startFrom = sec(from);
  const k = to ? interpolate(f, [sec(moveAt), sec(moveAt + moveFor)], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) }) : 0;
  const x = win.x + ((to?.x ?? win.x) - win.x) * k;
  const y = win.y + ((to?.y ?? win.y) - win.y) * k;
  const scale = win.scale + ((to?.scale ?? win.scale) - win.scale) * k;
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: NIGHT }}>
      <Video
        src={src}
        startFrom={startFrom}
        endAt={startFrom + dur}
        gainDb={gainDb}
        fadeIn={0.05}
        fadeOut={0.05}
        style={{ position: "absolute", left: -x * scale, top: -y * scale, width: W * scale, height: H * scale }}
      />
    </AbsoluteFill>
  );
}

/** One block of words: it rises in, and leaves when the next one is due. */
function Words({ line, size }: { line: Line; size: number }) {
  const f = useCurrentFrame();
  const at = sec(line.at);
  if (f < at || (line.until !== undefined && f >= sec(line.until))) return null;
  const k = interpolate(f, [at, at + 9], [0, 1], { ...clamp, easing: OUT });
  const note = line.kind === "note";
  return (
    <div style={{
      opacity: k,
      transform: `translateY(${(1 - k) * 14}px)`,
      fontFamily: FACE,
      fontWeight: note ? 500 : 600,
      fontSize: note ? Math.round(size * 0.58) : size,
      lineHeight: note ? 1.3 : 1.12,
      letterSpacing: note ? 0 : -0.5,
      color: note ? SOFT : INK,
      marginTop: note ? 26 : 0,
      marginBottom: note ? 0 : 22,
      textShadow: "0 2px 18px rgba(8,6,22,0.75)",
    }}>{line.text}</div>
  );
}

/** The words for a shot, in the left column, over a shade so they read on the water. */
function Column({ lines, top = 250 }: { lines: Line[]; top?: number }) {
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 0, top: 0, width: 760, height: H, background: "linear-gradient(90deg, rgba(10,8,26,0.62) 0%, rgba(10,8,26,0.45) 60%, rgba(10,8,26,0) 100%)" }} />
      <div style={{ position: "absolute", left: 84, top, width: 560, display: "flex", flexDirection: "column" }}>
        {lines.map((l, i) => <Words key={i} line={l} size={62} />)}
      </div>
    </AbsoluteFill>
  );
}

/** Words alone on the night colour, for the two things footage can't say. */
function Page({ lines, size = 84, width = 1380 }: { lines: Line[]; size?: number; width?: number }) {
  return (
    <AbsoluteFill style={{ backgroundColor: NIGHT }}>
      <div style={{ position: "absolute", left: 160, top: 360, width, display: "flex", flexDirection: "column" }}>
        {lines.map((l, i) => <Words key={i} line={l} size={size} />)}
      </div>
    </AbsoluteFill>
  );
}

/** The name, then what it is. */
function Title() {
  const f = useCurrentFrame();
  const a = interpolate(f, [0, 10], [0, 1], { ...clamp, easing: OUT });
  const b = interpolate(f, [16, 26], [0, 1], { ...clamp, easing: OUT });
  return (
    <AbsoluteFill style={{ backgroundColor: NIGHT, justifyContent: "center" }}>
      <div style={{ marginLeft: 160, fontFamily: FACE }}>
        <div style={{ opacity: a, transform: `translateY(${(1 - a) * 14}px)`, fontWeight: 650, fontSize: 190, lineHeight: 1, letterSpacing: -5, color: INK }}>Mirror Hand</div>
        <div style={{ opacity: b, transform: `translateY(${(1 - b) * 14}px)`, marginTop: 30, fontWeight: 500, fontSize: 72, color: ACCENT }}>is that mirror, in a headset.</div>
      </div>
    </AbsoluteFill>
  );
}

/** The Meta VR Glasses field of view (37° each side, 25° up, 43° down), cut out of the emulator's 90° frame. */
function GlassesView({ from, dur }: { from: number; dur: number }) {
  const startFrom = sec(from);
  const k = H / 756; // the 814x756 window, scaled to the frame's height
  const boxW = Math.round(814 * k);
  return (
    <AbsoluteFill style={{ backgroundColor: NIGHT }}>
      <div style={{ position: "absolute", right: 0, top: 0, width: boxW, height: H, overflow: "hidden" }}>
        <Video
          src={GLASSES}
          startFrom={startFrom}
          endAt={startFrom + dur}
          gainDb={GAIN}
          fadeIn={0.05}
          fadeOut={0.05}
          style={{ position: "absolute", left: -553 * k, top: -288 * k, width: W * k, height: H * k }}
        />
      </div>
    </AbsoluteFill>
  );
}

/** The last page: the name, the link and what this recording is, beside the app's closing shot (half speed). */
function End({ dur }: { dur: number }) {
  const f = useCurrentFrame();
  const row = (n: number) => {
    const k = interpolate(f, [12 + n * 10, 22 + n * 10], [0, 1], { ...clamp, easing: OUT });
    return { opacity: k, transform: `translateY(${(1 - k) * 14}px)` };
  };
  const scale = 1.3;
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: NIGHT }}>
      <Video src={CLOSING} startFrom={0} endAt={dur} muted style={{ position: "absolute", left: 0, top: -70 * scale, width: W * scale, height: H * scale }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: 1000, height: H, background: "linear-gradient(90deg, rgba(10,8,26,0.78) 0%, rgba(10,8,26,0.6) 65%, rgba(10,8,26,0) 100%)" }} />
      <div style={{ position: "absolute", left: 84, top: 250, width: 800, fontFamily: FACE, textShadow: "0 2px 18px rgba(8,6,22,0.75)" }}>
        <div style={{ ...row(0), fontWeight: 650, fontSize: 124, lineHeight: 1, letterSpacing: -3, color: INK }}>Mirror Hand</div>
        <div style={{ ...row(1), marginTop: 30, fontWeight: 500, fontSize: 50, lineHeight: 1.2, color: INK }}>A three-minute daily practice.<br />Seated, hands only.</div>
        <div style={{ ...row(2), marginTop: 40, fontWeight: 600, fontSize: 46, color: ACCENT }}>shiv-aurora.github.io/mirror-hand</div>
        <div style={{ ...row(3), marginTop: 48, width: 790, fontWeight: 500, fontSize: 34, lineHeight: 1.35, color: SOFT }}>Recorded in the Immersive Web SDK emulator with scripted hands. Not yet tested on a headset or with patients. Not a medical device.</div>
      </div>
    </AbsoluteFill>
  );
}

// ---- the cut ----------------------------------------------------------------

interface Beat { id: string; dur: number; node: (dur: number) => any }

const BEATS: Beat[] = [
  // Proof first: two hands moving together, then where the left hand really is.
  { id: "hook", dur: 9.8, node: (d) => (
    <>
      <Shot src={ONE} from={6.6} dur={d} win={RIGHT} to={LAP} moveAt={4.1} moveFor={1.1} />
      <Column lines={[
        { text: "Two hands, moving together.", at: 0.5, until: 4.3 },
        { text: "Only the right one is really moving.", at: 4.6 },
        { text: "The left hand is resting in the lap. Blue outline added for this video.", at: 5.6, kind: "note" },
      ]} />
    </>
  ) },
  { id: "why-1", dur: 4.0, node: () => <Page lines={[{ text: "After a stroke,", at: 0.15 }, { text: "one hand often moves far less than the other.", at: 0.9 }]} /> },
  { id: "why-2", dur: 7.4, node: () => (
    <Page lines={[
      { text: "In mirror therapy,", at: 0.15 },
      { text: "you watch a mirror image of the stronger hand, in the place of the weaker one.", at: 0.9 },
      { text: "Thieme et al., Cochrane Review, 2018: 62 trials, moderate-quality evidence that it improves movement after stroke.", at: 2.5, kind: "note" },
    ]} />
  ) },
  { id: "title", dur: 3.2, node: () => <Title /> },

  // One session, in order.
  { id: "choose", dur: 3.5, node: (d) => (
    <>
      <Shot src={ONE} from={2.4} dur={d} win={RIGHT} />
      <Column lines={[{ text: "First, hold up the hand that moves more easily.", at: 0.3 }]} />
    </>
  ) },
  { id: "open-close", dur: 7.7, node: (d) => (
    <>
      <Shot src={ONE} from={17.9} dur={d} win={RIGHT} />
      <Column lines={[
        { text: "Open and close, slowly.", at: 0.3 },
        { text: "You try to move the weaker hand along with what you see.", at: 2.6, kind: "note" },
      ]} />
    </>
  ) },
  { id: "touches", dur: 7.6, node: (d) => (
    <>
      <Shot src={ONE} from={35.4} dur={d} win={RIGHT} />
      <Column lines={[
        { text: "Thumb to each fingertip.", at: 0.3 },
        { text: "Each touch rings a lantern.", at: 2.2, kind: "note" },
      ]} />
    </>
  ) },
  { id: "reach", dur: 8.4, node: (d) => (
    <>
      <Shot src={TWO} from={0.6} dur={d} win={RIGHT} />
      <Column lines={[
        { text: "Reach for pairs of fireflies.", at: 0.3 },
        { text: "They stay close to where you first held your hand.", at: 2.6, kind: "note" },
      ]} />
    </>
  ) },
  { id: "your-turn", dur: 9.6, node: (d) => (
    <>
      <Shot src={TWO} from={13.4} dur={d} win={RIGHT} />
      <Column lines={[
        { text: "Then the mirror switches off.", at: 0.3, until: 3.6 },
        { text: "The weaker hand tries on its own.", at: 3.9 },
        { text: "In this recording the left hand is scripted to close part of the way.", at: 5.2, kind: "note" },
      ]} />
    </>
  ) },
  { id: "summary", dur: 6.6, node: (d) => (
    <>
      <Shot src={TWO} from={33.5} dur={d} win={RIGHT} />
      <Column lines={[
        { text: "How far it opened, against your own stronger hand.", at: 0.3 },
        { text: "Kept on the device only. The earlier sessions shown were also emulator runs.", at: 2.2, kind: "note" },
      ]} />
    </>
  ) },

  // The narrower device.
  { id: "glasses", dur: 6.5, node: (d) => (
    <>
      <GlassesView from={4.6} dur={d} />
      <Column top={300} lines={[
        { text: "It also fits the narrower view of Meta VR Glasses.", at: 0.3 },
        { text: "Look at a button and pinch to press it.", at: 2.4, kind: "note" },
      ]} />
    </>
  ) },
  { id: "end", dur: 8.6, node: (d) => <End dur={d} /> },
];

const STARTS = BEATS.reduce<number[]>((acc, b, i) => [...acc, i === 0 ? 0 : acc[i - 1] + sec(BEATS[i - 1].dur)], []);
const TOTAL = STARTS[STARTS.length - 1] + sec(BEATS[BEATS.length - 1].dur);
const startOf = (id: string) => STARTS[BEATS.findIndex((b) => b.id === id)];

export default function Demo() {
  return (
    <AbsoluteFill style={{ backgroundColor: NIGHT }}>
      <style>{FONT_CSS}</style>
      {BEATS.map((b, i) => (
        <Sequence key={b.id} from={STARTS[i]} durationInFrames={sec(b.dur)} name={b.id}>
          {b.node(sec(b.dur))}
        </Sequence>
      ))}
      {/* The app's own sound carries on under the pages that have no footage. */}
      <Sequence from={startOf("why-1")} durationInFrames={sec(4.0 + 7.4 + 3.2)} layout="none" name="sound under the why pages">
        <Audio src={ONE} startFrom={sec(15.9)} endAt={sec(15.9 + 14.6)} gainDb={GAIN - 5} fadeIn={0.05} fadeOut={0.3} />
      </Sequence>
      <Sequence from={startOf("end")} durationInFrames={sec(5.3)} layout="none" name="sound under the end page">
        <Audio src={TWO} startFrom={sec(39.9)} endAt={sec(45.2)} gainDb={GAIN} fadeIn={0.05} fadeOut={1.2} />
      </Sequence>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="mirror-hand-demo" component={Demo} width={W} height={H} fps={FPS} durationInFrames={TOTAL} />);
