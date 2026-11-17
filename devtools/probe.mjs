// Dev-only: report canvas size, frame rate and audio state.
export default async function run({ frame, page }) {
  const target = frame ?? page;
  const info = await target.evaluate(async () => {
    const api = globalThis.__mirrorHand;
    api?.sound?.unlock();
    api?.sound?.resume();
    const canvases = [...document.querySelectorAll('canvas')].map((c) => [c.width, c.height, c.clientWidth, c.clientHeight]);
    let frames = 0;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => { frames++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else resolve(); };
      requestAnimationFrame(tick);
    });
    await new Promise((r) => setTimeout(r, 300));
    return {
      canvases,
      fps: Math.round(frames / 2),
      audio: api?.sound?.output?.context.state ?? 'none',
      inner: [innerWidth, innerHeight, devicePixelRatio],
      isFrame: window !== window.top,
      mime: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4;codecs=avc1'].filter((m) => MediaRecorder.isTypeSupported(m)),
    };
  });
  console.log('PROBE ' + JSON.stringify(info));
  return info;
}
