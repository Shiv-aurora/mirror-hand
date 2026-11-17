/**
 * Mirror Hand: demo video for the Meta VR Start Developer Competition 2026.
 * Third cut. 1920x1080, 30 fps. Lengths come from the BEATS list below.
 *
 * Every moving picture is the app's own footage, recorded in the Immersive
 * Web SDK emulator at 2304x1296 (devtools/record.mjs, scenes "one", "two",
 * "explain" and "glasses"), so the 1920x1080 frame is a window onto it with
 * no enlargement. Camera moves are real moves of the emulated headset.
 * In/out points are seconds into those recordings.
 *
 * Drawn here, not filmed: the mirror-box diagram, the words, the step rail
 * and the frame that shows the glasses' field of view.
 *
 * Rendered with raea 0.1.6 (github.com/shinyobjectz/raea) from a folder that
 * holds this file and media/ (v3/one.mp4, v3/two.mp4, v3/explain.mp4,
 * v3/closing.mp4, glasses.mp4, fonts/Inter.ttf):
 *   raea render edit.tsx -o demo.mp4 --quality master
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
/** The size the app footage was recorded at. */
const SW = 2304;
const SH = 1296;
const NIGHT = "#0c0a1d";
const INK = "#f6efe6";
const SOFT = "rgba(246,239,230,0.72)";
const ACCENT = "#ffcf8a";
const FACE = `"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif`;
const FONT_CSS = `@font-face { font-family: "Inter"; src: url(${staticFile("fonts/Inter.ttf")}); font-weight: 100 900; }`;

// ---- helpers ----------------------------------------------------------------
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const OUT = Easing.out(Easing.cubic);
const INOUT = Easing.inOut(Easing.cubic);
const sec = (s: number) => Math.round(s * FPS);
/** 0 before `from`, 1 after `to` (seconds), eased. */
const ramp = (f: number, from: number, to: number, easing = OUT) =>
  interpolate(f, [sec(from), sec(to)], [0, 1], { ...clamp, easing });
/** The recordings are quiet; this lifts all of them by the same amount, with the loudest bell still under the ceiling. */
const GAIN = 9;

// ---- data -------------------------------------------------------------------
const ONE = staticFile("v3/one.mp4");
const TWO = staticFile("v3/two.mp4");
const EXPLAIN = staticFile("v3/explain.mp4");
const CLOSING = staticFile("v3/closing.mp4");
const GLASSES = staticFile("glasses.mp4");

/** A window onto the 2304x1296 recording: its top-left corner in recording pixels, and the zoom (1 is pixel for pixel). */
interface Win { x: number; y: number; zoom: number }
/** Hands and panel a little right of centre; the left third is lake, for the words. */
const SEAT: Win = { x: 0, y: 110, zoom: 1 };

interface Line { text: string; at: number; until?: number; kind?: "say" | "note" }

// ---- parts ------------------------------------------------------------------

/** A stretch of a recording, shown through a window that can move once. */
function Shot({ src, from, dur, win = SEAT, to, moveAt = 0, moveFor = 1, gainDb = GAIN }: {
  src: string; from: number; dur: number; win?: Win; to?: Win; moveAt?: number; moveFor?: number; gainDb?: number;
}) {
  const f = useCurrentFrame();
  const startFrom = sec(from);
  const k = to ? ramp(f, moveAt, moveAt + moveFor, INOUT) : 0;
  const x = win.x + ((to?.x ?? win.x) - win.x) * k;
  const y = win.y + ((to?.y ?? win.y) - win.y) * k;
  const zoom = win.zoom + ((to?.zoom ?? win.zoom) - win.zoom) * k;
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: NIGHT }}>
      <Video
        src={src}
        startFrom={startFrom}
        endAt={startFrom + dur}
        gainDb={gainDb}
        fadeIn={0.05}
        fadeOut={0.05}
        style={{ position: "absolute", left: -x * zoom, top: -y * zoom, width: SW * zoom, height: SH * zoom }}
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
function Column({ lines, top = 250, shade = 1 }: { lines: Line[]; top?: number; shade?: number }) {
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 0, top: 0, width: 760, height: H, background: `linear-gradient(90deg, rgba(10,8,26,${0.62 * shade}) 0%, rgba(10,8,26,${0.45 * shade}) 60%, rgba(10,8,26,0) 100%)` }} />
      <div style={{ position: "absolute", left: 84, top, width: 560, display: "flex", flexDirection: "column" }}>
        {lines.map((l, i) => <Words key={i} line={l} size={62} />)}
      </div>
    </AbsoluteFill>
  );
}

/** Where we are in the session: six short bars, the current one filling as its shot plays. */
const STEPS = 6;
function Rail({ step, dur }: { step: number; dur: number }) {
  const f = useCurrentFrame();
  const fill = interpolate(f, [0, dur], [0, 1], clamp);
  const show = interpolate(f, [0, 8], [0, 1], { ...clamp, easing: OUT });
  const bar = 70;
  const gap = 8;
  return (
    <div style={{ position: "absolute", left: 84, top: 178, height: 40, display: "flex", alignItems: "center", opacity: step === 1 ? show : 1 }}>
      {Array.from({ length: STEPS }, (_, i) => (
        <div key={i} style={{ position: "relative", width: bar, height: 6, marginRight: gap, borderRadius: 3, backgroundColor: "rgba(246,239,230,0.24)", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: 6, borderRadius: 3, width: i + 1 < step ? bar : i + 1 === step ? bar * fill : 0, backgroundColor: i + 1 === step ? ACCENT : INK }} />
        </div>
      ))}
      <div style={{ marginLeft: 14, fontFamily: FACE, fontWeight: 600, fontSize: 30, color: SOFT, textShadow: "0 2px 14px rgba(8,6,22,0.75)" }}>{step} of {STEPS}</div>
    </div>
  );
}

// ---- the mirror-box diagram ---------------------------------------------------

const CREAM = "233,220,203";
const GOLD = "255,214,160";

/** A hand seen from above, palm down, drawn from rounded bars. `open` 1 is flat, 0 is a loose fist. */
function HandIcon({ x, y, flip = false, open, rgb, opacity = 1 }: {
  x: number; y: number; flip?: boolean; open: number; rgb: string; opacity?: number;
}) {
  const color = `rgb(${rgb})`;
  const fw = 31;
  const gap = 9;
  const palmW = 4 * fw + 3 * gap;
  const palmH = 150;
  const room = 170; // space above the palm for the fingers
  const lengths = [128, 150, 136, 100];
  const fan = [-7, -2, 3, 9];
  const curl = 0.4 + 0.6 * open;
  const thumb = 104 * (0.78 + 0.22 * open);
  return (
    <div style={{ position: "absolute", left: x - palmW / 2, top: y - palmH - room, width: palmW, height: room + palmH + 150, opacity, transform: `scaleX(${flip ? -1 : 1})` }}>
      <div style={{ position: "absolute", left: 24, top: room + palmH - 40, width: palmW - 48, height: 180, background: `linear-gradient(180deg, rgba(${rgb},1) 0%, rgba(${rgb},1) 30%, rgba(${rgb},0) 100%)` }} />
      {lengths.map((length, i) => (
        <div key={i} style={{
          position: "absolute", left: i * (fw + gap), top: room + 26 - length * curl, width: fw, height: length * curl,
          borderRadius: fw / 2, backgroundColor: color, transformOrigin: "50% 100%", transform: `rotate(${fan[i] * open}deg)`,
        }} />
      ))}
      <div style={{
        position: "absolute", left: -14, top: room + palmH - 34 - thumb, width: 36, height: thumb,
        borderRadius: 18, backgroundColor: color, transformOrigin: "50% 100%", transform: `rotate(${-14 - 44 * open}deg)`,
      }} />
      <div style={{ position: "absolute", left: 0, top: room, width: palmW, height: palmH, borderRadius: "46px 46px 56px 56px", backgroundColor: color }} />
    </div>
  );
}

/** Why: the weaker hand, then the mirror that hides it and puts the other hand's reflection in its place. */
function MirrorBox({ mirrorAt, reflectAt }: { mirrorAt: number; reflectAt: number }) {
  const f = useCurrentFrame();
  const t = f / FPS;
  const LX = 1130;
  const RX = 1570;
  const MX = 1350;
  const BASE = 650;
  const TOP = 205;
  const TALL = 560;
  // The stronger hand opens and closes slowly; the weaker one barely moves.
  const strong = 0.5 + 0.5 * Math.cos((t - 0.4) * (Math.PI * 2 / 2.8));
  const weak = 0.72 + 0.05 * Math.cos((t - 0.4) * (Math.PI * 2 / 2.8));
  const arrive = ramp(f, 0.1, 0.7);
  const mirror = ramp(f, mirrorAt, mirrorAt + 0.7, INOUT);
  const hidden = ramp(f, mirrorAt + 0.3, mirrorAt + 1.1);
  const reflect = ramp(f, reflectAt, reflectAt + 0.8);
  const label = (text: string, x: number, k: number, color = SOFT) => (
    <div style={{ position: "absolute", left: x - 180, top: BASE + 150, width: 360, textAlign: "center", fontFamily: FACE, fontWeight: 500, fontSize: 34, color, opacity: k }}>{text}</div>
  );
  return (
    <AbsoluteFill style={{ opacity: arrive }}>
      {/* the space inside the mirror */}
      <div style={{ position: "absolute", left: MX - 420, top: TOP, width: 420, height: TALL * mirror, opacity: mirror, background: `linear-gradient(90deg, rgba(${GOLD},0) 0%, rgba(${GOLD},0.11) 100%)` }} />
      <HandIcon x={LX} y={BASE} flip open={weak} rgb={CREAM} opacity={0.5 * (1 - 0.8 * hidden)} />
      <HandIcon x={LX} y={BASE} flip open={strong} rgb={GOLD} opacity={reflect} />
      <HandIcon x={RX} y={BASE} open={strong} rgb={CREAM} />
      {/* the mirror, seen edge on from above */}
      <div style={{ position: "absolute", left: MX - 30, top: TOP, width: 60, height: TALL * mirror, opacity: mirror, background: `linear-gradient(90deg, rgba(${GOLD},0) 0%, rgba(${GOLD},0.22) 50%, rgba(${GOLD},0) 100%)` }} />
      <div style={{ position: "absolute", left: MX - 3, top: TOP, width: 6, height: TALL * mirror, opacity: mirror, borderRadius: 3, backgroundColor: ACCENT }} />
      {label("weaker hand", LX, 1 - hidden)}
      {label("its reflection", LX, reflect, ACCENT)}
      {label("stronger hand", RX, 1)}
      <div style={{ position: "absolute", left: MX - 100, top: TOP - 56, width: 200, textAlign: "center", fontFamily: FACE, fontWeight: 500, fontSize: 32, color: SOFT, opacity: mirror }}>mirror</div>
    </AbsoluteFill>
  );
}

/** The why, as one page: words on the left, the diagram on the right. */
function Why() {
  const lines: Line[] = [
    { text: "After a stroke, one hand often moves far less than the other.", at: 0.3, until: 4.1 },
    { text: "Mirror therapy hides that hand behind a mirror.", at: 4.3 },
    { text: "The stronger hand's reflection appears in its place.", at: 6.1 },
    { text: "Thieme et al., Cochrane Review, 2018: 62 trials, moderate-quality evidence that it improves movement after stroke.", at: 8.1, kind: "note" },
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: NIGHT }}>
      <MirrorBox mirrorAt={4.3} reflectAt={6.1} />
      <div style={{ position: "absolute", left: 110, top: 250, width: 690, display: "flex", flexDirection: "column" }}>
        {lines.map((l, i) => <Words key={i} line={l} size={60} />)}
      </div>
    </AbsoluteFill>
  );
}

/** The name, wiped on from the left, then what it is. */
function Title() {
  const f = useCurrentFrame();
  const a = ramp(f, 0.05, 0.6, INOUT);
  const b = interpolate(f, [18, 28], [0, 1], { ...clamp, easing: OUT });
  return (
    <AbsoluteFill style={{ backgroundColor: NIGHT, justifyContent: "center" }}>
      <div style={{ marginLeft: 160, fontFamily: FACE }}>
        <div style={{ width: 1300 * a, height: 210, overflow: "hidden" }}>
          <div style={{ width: 1300, fontWeight: 650, fontSize: 190, lineHeight: 1.08, letterSpacing: -5, color: INK }}>Mirror Hand</div>
        </div>
        <div style={{ opacity: b, transform: `translateY(${(1 - b) * 14}px)`, marginTop: 22, fontWeight: 500, fontSize: 72, color: ACCENT }}>is that mirror, in a headset.</div>
      </div>
    </AbsoluteFill>
  );
}

/**
 * Meta VR Glasses: the emulator's whole frame first, then a frame around the
 * part the glasses show (37 degrees each side, 25 up, 43 down), then only that.
 */
function GlassesView({ from, dur }: { from: number; dur: number }) {
  const f = useCurrentFrame();
  const startFrom = sec(from);
  const box = { x: 553, y: 288, w: 814, h: 756 };
  const frame = ramp(f, 1.3, 1.9);
  const zoom = ramp(f, 3.0, 4.2, INOUT);
  const k0 = 0.8;
  const k1 = H / box.h;
  const k = k0 + (k1 - k0) * zoom;
  const left = (W - 1920 * k0) + ((W - (box.x + box.w) * k1) - (W - 1920 * k0)) * zoom;
  const top = (H - 1080 * k0) / 2 + (-box.y * k1 - (H - 1080 * k0) / 2) * zoom;
  const dim = 0.55 * frame + 0.45 * zoom;
  const shade = (x: number, y: number, w: number, h: number) => (
    <div style={{ position: "absolute", left: x * k, top: y * k, width: w * k + 1, height: h * k + 1, backgroundColor: NIGHT, opacity: dim }} />
  );
  return (
    <AbsoluteFill style={{ backgroundColor: NIGHT, overflow: "hidden" }}>
      <div style={{ position: "absolute", left, top, width: 1920 * k, height: 1080 * k, overflow: "hidden", borderRadius: 28 * (1 - zoom) }}>
        <Video
          src={GLASSES}
          startFrom={startFrom}
          endAt={startFrom + dur}
          gainDb={GAIN}
          fadeIn={0.05}
          fadeOut={0.05}
          style={{ position: "absolute", left: 0, top: 0, width: 1920 * k, height: 1080 * k }}
        />
        {shade(0, 0, 1920, box.y)}
        {shade(0, box.y + box.h, 1920, 1080 - box.y - box.h)}
        {shade(0, box.y, box.x, box.h)}
        {shade(box.x + box.w, box.y, 1920 - box.x - box.w, box.h)}
        <div style={{ position: "absolute", left: box.x * k, top: box.y * k, width: box.w * k, height: box.h * k, boxSizing: "border-box", border: `3px solid ${ACCENT}`, borderRadius: 10, opacity: frame * (1 - zoom) }} />
      </div>
    </AbsoluteFill>
  );
}

/** The last page: the name, the link and what this recording is, beside the app's closing shot (slowed). */
function End({ dur }: { dur: number }) {
  const f = useCurrentFrame();
  const row = (n: number) => {
    const k = interpolate(f, [12 + n * 10, 22 + n * 10], [0, 1], { ...clamp, easing: OUT });
    return { opacity: k, transform: `translateY(${(1 - k) * 14}px)` };
  };
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: NIGHT }}>
      <Video src={CLOSING} startFrom={0} endAt={dur} muted style={{ position: "absolute", left: 60, top: -150, width: SW, height: SH }} />
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

/** A name on the picture, with a short line down to the thing it names. */
function Tag({ text, x, y, at }: { text: string; x: number; y: number; at: number }) {
  const f = useCurrentFrame();
  const k = ramp(f, at, at + 0.35);
  const line = ramp(f, at + 0.2, at + 0.6);
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity: k, transform: `translateY(${(1 - k) * 10}px)`, fontFamily: FACE, fontWeight: 600, fontSize: 34, color: "#b9d8ff", textShadow: "0 2px 14px rgba(8,6,22,0.85)" }}>
      {text}
      <div style={{ marginTop: 10, marginLeft: 400, width: 3, height: 46 * line, borderRadius: 2, backgroundColor: "#b9d8ff" }} />
    </div>
  );
}

// ---- the cut ----------------------------------------------------------------

interface Beat { id: string; dur: number; node: (dur: number) => any }

const BEATS: Beat[] = [
  // Proof first: two hands moving together, then a look down at where the left hand really is.
  { id: "hook", dur: 8.0, node: (d) => (
    <>
      <Shot src={ONE} from={6.55} dur={d} />
      <Column shade={0.55} lines={[
        { text: "Two hands, moving together.", at: 0.5, until: 4.3 },
        { text: "Only the right one is really moving.", at: 4.5 },
        { text: "Blue outline added for this video.", at: 5.7, kind: "note" },
      ]} />
      <Tag text="the real left hand, resting in the lap" x={150} y={560} at={5.3} />
    </>
  ) },
  { id: "why", dur: 13.2, node: () => <Why /> },
  { id: "title", dur: 3.0, node: () => <Title /> },

  // One session, in order.
  { id: "choose", dur: 3.5, node: (d) => (
    <>
      {/* The welcome tone at the start of the recording is its loudest sound; this shot gets less lift. */}
      <Shot src={ONE} from={2.1} dur={d} gainDb={GAIN - 4} />
      <Column lines={[{ text: "First, hold up the hand that moves more easily.", at: 0.3 }]} />
      <Rail step={1} dur={d} />
    </>
  ) },
  { id: "open-close", dur: 7.4, node: (d) => (
    <>
      <Shot src={ONE} from={21.0} dur={d} />
      <Column lines={[
        { text: "Open and close, slowly.", at: 0.3 },
        { text: "You try to move the weaker hand along with what you see.", at: 2.6, kind: "note" },
      ]} />
      <Rail step={2} dur={d} />
    </>
  ) },
  { id: "touches", dur: 7.4, node: (d) => (
    <>
      <Shot src={ONE} from={43.5} dur={d} win={{ x: 0, y: 0, zoom: 1 }} />
      <Column lines={[
        { text: "Thumb to each fingertip.", at: 0.3 },
        { text: "Each touch rings a lantern.", at: 2.2, kind: "note" },
      ]} />
      <Rail step={3} dur={d} />
    </>
  ) },
  { id: "reach", dur: 7.6, node: (d) => (
    <>
      <Shot src={TWO} from={0.5} dur={d} />
      <Column lines={[
        { text: "Reach for pairs of fireflies.", at: 0.3 },
        { text: "They stay close to where you first held your hand.", at: 2.6, kind: "note" },
      ]} />
      <Rail step={4} dur={d} />
    </>
  ) },
  { id: "your-turn", dur: 9.6, node: (d) => (
    <>
      <Shot src={TWO} from={13.4} dur={d} />
      <Column lines={[
        { text: "Then the mirror switches off.", at: 0.3, until: 3.6 },
        { text: "The weaker hand tries on its own.", at: 3.9 },
        { text: "In this recording the left hand is scripted to close part of the way.", at: 5.2, kind: "note" },
      ]} />
      <Rail step={5} dur={d} />
    </>
  ) },
  { id: "summary", dur: 6.8, node: (d) => (
    <>
      <Shot src={TWO} from={34.2} dur={d} win={{ x: 0, y: 150, zoom: 1 }} />
      <Column lines={[
        { text: "How far it opened, against your own stronger hand.", at: 0.3 },
        { text: "Kept on the device only. The earlier sessions shown were also emulator runs.", at: 2.2, kind: "note" },
      ]} />
      <Rail step={6} dur={d} />
    </>
  ) },

  // How it works: seen as the person sees it, then from the side.
  { id: "how", dur: 13.6, node: (d) => (
    <>
      <Shot src={EXPLAIN} from={0.7} dur={d} to={{ x: 0, y: 50, zoom: 0.9 }} moveAt={3.65} moveFor={3.2} />
      <Column lines={[
        { text: "The headset tracks 25 joints in the moving hand.", at: 0.4, until: 5.0 },
        { text: "Each joint is reflected across the middle of the body, every frame.", at: 5.2 },
        { text: "The other hand is drawn from those reflected joints. The dots, lines and plane are added for this video.", at: 7.7, kind: "note" },
      ]} />
    </>
  ) },

  // The narrower device.
  { id: "glasses", dur: 8.2, node: (d) => (
    <>
      <GlassesView from={2.3} dur={d} />
      <Column top={300} shade={0} lines={[
        { text: "It also fits the narrower view of Meta VR Glasses.", at: 0.3 },
        { text: "Look at a button and pinch to press it.", at: 4.4, kind: "note" },
      ]} />
    </>
  ) },
  { id: "end", dur: 8.8, node: (d) => <End dur={d} /> },
];

const STARTS = BEATS.reduce<number[]>((acc, b, i) => [...acc, i === 0 ? 0 : acc[i - 1] + sec(BEATS[i - 1].dur)], []);
const TOTAL = STARTS[STARTS.length - 1] + sec(BEATS[BEATS.length - 1].dur);
const startOf = (id: string) => STARTS[BEATS.findIndex((b) => b.id === id)];
const WHY_AND_TITLE = 13.2 + 3.0;

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
      <Sequence from={startOf("why")} durationInFrames={sec(WHY_AND_TITLE)} layout="none" name="sound under the why page">
        <Audio src={ONE} startFrom={sec(20.4)} endAt={sec(20.4 + WHY_AND_TITLE)} gainDb={GAIN - 5} fadeIn={0.05} fadeOut={0.3} />
      </Sequence>
      <Sequence from={startOf("end")} durationInFrames={sec(6.4)} layout="none" name="sound under the end page">
        <Audio src={TWO} startFrom={sec(42.5)} endAt={sec(48.9)} gainDb={GAIN} fadeIn={0.05} fadeOut={1.2} />
      </Sequence>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="mirror-hand-demo" component={Demo} width={W} height={H} fps={FPS} durationInFrames={TOTAL} />);
