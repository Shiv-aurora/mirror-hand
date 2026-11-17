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

  await page.setViewportSize({ width: 1920, height: 1080 });
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

  const result = await target.evaluate(async (steps) => {
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
      const stream = canvas.captureStream(60);
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
        videoBitsPerSecond: 16_000_000,
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
  }, steps);

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
