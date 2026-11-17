// Dev-only: make the runtime view fill a 1920x1080 window (MH_STAGE=on) for
// recording, or put the managed window back (MH_STAGE=off).
export default async function run({ frame, page }) {
  const on = (process.env.MH_STAGE ?? 'on') !== 'off';
  if (on) {
    await page.setViewportSize({ width: 1920, height: 1080 });
  }
  const frames = await page.evaluate((fill) => {
    const list = [...document.querySelectorAll('iframe')];
    for (const el of list) {
      if (fill) {
        el.dataset.mhStyle = el.getAttribute('style') ?? '';
        el.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483000;border:0;background:#000');
      } else if (el.dataset.mhStyle !== undefined) {
        el.setAttribute('style', el.dataset.mhStyle);
      }
    }
    return list.map((el) => [el.src.slice(0, 60), el.clientWidth, el.clientHeight]);
  }, on);
  const target = frame ?? page;
  await new Promise((r) => setTimeout(r, 800));
  const info = await target.evaluate(async () => {
    let n = 0;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else resolve(); };
      requestAnimationFrame(tick);
    });
    return {
      canvases: [...document.querySelectorAll('canvas')].map((c) => [c.width, c.height, c.className || c.id || '-']),
      fps: Math.round(n / 2),
      inner: [innerWidth, innerHeight],
    };
  });
  console.log('STAGE ' + JSON.stringify({ frames, info }));
  return info;
}
