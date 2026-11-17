// Dev-only: record real footage of the app running in the IWSDK emulator.
//
//   MH_SCENE=<name> MH_OUT=<file inside the workspace> \
//     iwsdk browser run devtools/record.mjs --timeout 600000
//
// It makes the runtime view fill a 1920x1080 window, drives the emulated
// headset and hands through a scripted session, and records the app's own
// canvas and sound with MediaRecorder. Nothing here ships in the build.
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SCENES } from './scenes.mjs';

export default async function run({ frame, page, workspaceRoot }) {
  const sceneName = process.env.MH_SCENE ?? 'trial';
  const steps = SCENES[sceneName];
  if (!steps) {
    throw new Error(`Unknown scene ${sceneName}`);
  }
  const outFile = resolve(
    workspaceRoot ?? process.cwd(),
    process.env.MH_OUT ?? `.iwsdk/rec/${sceneName}.webm`,
  );
  mkdirSync(dirname(outFile), { recursive: true });

  // MH_W x MH_H is the picture size; a larger one leaves room to punch in.
  const width = Number(process.env.MH_W ?? 1920);
  const height = Number(process.env.MH_H ?? 1080);
  const options = {
    fps: Number(process.env.MH_FPS ?? 60),
    bitrate: Number(process.env.MH_BITRATE ?? 16_000_000),
  };
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('iframe')) {
      el.setAttribute(
        'style',
        'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483000;border:0;background:#000',
      );
    }
  });
  const target = frame ?? page;
  await new Promise((r) => setTimeout(r, 1200));

  const result = await target.evaluate(async ([steps, options]) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const remote = window.IWER_MCP.device.remote;
    const api = () => globalThis.__mirrorHand;
    const marks = [];
    const log = [];
    let recorder = null;
    let chunks = [];
    let startedAt = 0;

    const startRecording = () => {
      const canvases = [...document.querySelectorAll('canvas')];
      const canvas =
        window.IWER_MCP.device.appCanvas ?? canvases[canvases.length - 1];
      log.push(
        'canvases ' +
          canvases.map((c) => `${c.width}x${c.height}`).join(',') +
          ' using ' + canvas.width + 'x' + canvas.height,
      );
      const stream = canvas.captureStream(options.fps);
      const out = api()?.sound?.output;
      if (out) {
        const dest = out.context.createMediaStreamDestination();
        out.node.connect(dest);
        const track = dest.stream.getAudioTracks()[0];
        if (track) {
          stream.addTrack(track);
        }
        log.push('audio ' + out.context.state);
      } else {
        log.push('no audio');
      }
      const mime = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
      ].find((m) => MediaRecorder.isTypeSupported(m));
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: options.bitrate,
        audioBitsPerSecond: 160_000,
      });
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
        }
      };
      recorder.start(1000);
      startedAt = performance.now();
      log.push('recording ' + mime);
    };

    // The camera: the emulated headset, moved along a path of our own so a
    // move can ease, orbit a point and change the lens at the same time.
    const device = window.IWER_MCP.device;
    const cam = { p: [0, 1.18, 0], look: [0, 0.84, -1], fov: device.fovy, token: 0 };
    const EASE = {
      linear: (u) => u,
      inout: (u) => u * u * u * (u * (6 * u - 15) + 10),
      out: (u) => 1 - (1 - u) ** 3,
      in: (u) => u ** 3,
    };
    const aim = (p, look, fov) => {
      const norm = (v) => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const cross = (a, b) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      const z = norm([p[0] - look[0], p[1] - look[1], p[2] - look[2]]);
      const x = norm(cross([0, 1, 0], z));
      const y = cross(z, x);
      const [m00, m10, m20] = x;
      const [m01, m11, m21] = y;
      const [m02, m12, m22] = z;
      const trace = m00 + m11 + m22;
      let q;
      if (trace > 0) {
        const k = 0.5 / Math.sqrt(trace + 1);
        q = [(m21 - m12) * k, (m02 - m20) * k, (m10 - m01) * k, 0.25 / k];
      } else if (m00 > m11 && m00 > m22) {
        const k = 2 * Math.sqrt(1 + m00 - m11 - m22);
        q = [0.25 * k, (m01 + m10) / k, (m02 + m20) / k, (m21 - m12) / k];
      } else if (m11 > m22) {
        const k = 2 * Math.sqrt(1 + m11 - m00 - m22);
        q = [(m01 + m10) / k, 0.25 * k, (m12 + m21) / k, (m02 - m20) / k];
      } else {
        const k = 2 * Math.sqrt(1 + m22 - m00 - m11);
        q = [(m02 + m20) / k, (m12 + m21) / k, 0.25 * k, (m10 - m01) / k];
      }
      device.position.set(p[0], p[1], p[2]);
      device.quaternion.set(q[0], q[1], q[2], q[3]);
      device.fovy = fov;
    };
    /** Move the camera to { p, look, fov } over `dur` seconds, circling `look`. */
    const moveCam = (to) => {
      const token = ++cam.token;
      const from = { p: cam.p.slice(), look: cam.look.slice(), fov: cam.fov };
      const goal = { p: to.p ?? from.p, look: to.look ?? from.look, fov: to.fov ?? from.fov };
      const polar = (state) => {
        const o = state.p.map((v, i) => v - state.look[i]);
        return { r: Math.hypot(o[0], o[2]), az: Math.atan2(o[0], o[2]), h: o[1] };
      };
      const a = polar(from);
      const b = polar(goal);
      let turn = b.az - a.az;
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      const ms = (to.dur ?? 0) * 1000;
      const ease = EASE[to.ease ?? 'inout'];
      const t0 = performance.now();
      const step = () => {
        if (cam.token !== token) return;
        const u = ms <= 0 ? 1 : Math.min(1, (performance.now() - t0) / ms);
        const k = ease(u);
        const look = from.look.map((v, i) => v + (goal.look[i] - v) * k);
        const r = a.r + (b.r - a.r) * k;
        const az = a.az + turn * k;
        cam.p = [look[0] + r * Math.sin(az), look[1] + a.h + (b.h - a.h) * k, look[2] + r * Math.cos(az)];
        cam.look = look;
        cam.fov = from.fov + (goal.fov - from.fov) * k;
        aim(cam.p, cam.look, cam.fov);
        if (u < 1) requestAnimationFrame(step);
      };
      step();
    };

    for (const step of steps) {
      const [op, a, b] = step;
      try {
        if (op === 'wait') {
          await wait(a);
        } else if (op === 'xr') {
          // Timed commands resolve when they finish; do not block on them.
          const pending = remote.dispatch(a, b ?? {});
          if (pending && typeof pending.catch === 'function') {
            pending.catch((error) => log.push(`xr ${a} failed: ${error}`));
          }
        } else if (op === 'cam') {
          moveCam(a);
        } else if (op === 'hook') {
          api()?.[a]?.(b);
        } else if (op === 'eval') {
          (0, eval)(a);
        } else if (op === 'unlock') {
          api()?.sound?.unlock();
          api()?.sound?.resume();
        } else if (op === 'record') {
          startRecording();
        } else if (op === 'mark') {
          marks.push([a, Math.round(performance.now() - startedAt) / 1000]);
        } else if (op === 'until') {
          // ['until', phase/activity predicate source, timeout ms]
          const test = (0, eval)(a);
          const deadline = performance.now() + (b ?? 20000);
          while (performance.now() < deadline && !test(api().state())) {
            await wait(100);
          }
          if (!test(api().state())) {
            log.push('until timed out: ' + a);
          }
        }
      } catch (error) {
        log.push(`${op} ${a} threw: ${error}`);
      }
    }

    if (recorder) {
      await new Promise((resolveStop) => {
        recorder.onstop = resolveStop;
        recorder.stop();
      });
      globalThis.__recBlob = new Blob(chunks, { type: recorder.mimeType });
      chunks = [];
    }
    return {
      marks,
      log,
      size: globalThis.__recBlob?.size ?? 0,
      state: api()?.state(),
    };
  }, [steps, options]);

  // Pull the recording out of the page in pieces.
  writeFileSync(outFile, Buffer.alloc(0));
  const piece = 4 * 1024 * 1024;
  for (let offset = 0; offset < result.size; offset += piece) {
    const base64 = await target.evaluate(
      async ([from, length]) => {
        const buffer = new Uint8Array(
          await globalThis.__recBlob.slice(from, from + length).arrayBuffer(),
        );
        let text = '';
        for (let i = 0; i < buffer.length; i += 0x8000) {
          text += String.fromCharCode.apply(null, buffer.subarray(i, i + 0x8000));
        }
        return btoa(text);
      },
      [offset, piece],
    );
    appendFileSync(outFile, Buffer.from(base64, 'base64'));
  }
  await target.evaluate(() => {
    globalThis.__recBlob = undefined;
  });
  writeFileSync(
    outFile.replace(/\.webm$/, '.json'),
    JSON.stringify({ marks: result.marks, log: result.log, state: result.state }, null, 2),
  );
  console.log(
    'RECORDED ' +
      JSON.stringify({ outFile, size: result.size, marks: result.marks, log: result.log }),
  );
  return { outFile, size: result.size };
}
