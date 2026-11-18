// Dev-only: save a clean 1920x1080 picture of the page (no emulator buttons).
//   MH_OUT=<png inside the workspace> iwsdk browser run devtools/still.mjs
// MH_ZOOM=2 saves the same layout at twice the pixels (3840x2160).
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export default async function run({ frame, page, workspaceRoot }) {
  const outFile = resolve(
    workspaceRoot ?? process.cwd(),
    process.env.MH_OUT ?? '.iwsdk/rec/still.png',
  );
  mkdirSync(dirname(outFile), { recursive: true });
  const zoom = Number(process.env.MH_ZOOM ?? 1);
  await page.setViewportSize({ width: 1920 * zoom, height: 1080 * zoom });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('iframe')) {
      el.setAttribute(
        'style',
        'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483000;border:0;background:#000',
      );
    }
  });
  const target = frame ?? page;
  await target.evaluate((value) => {
    document.documentElement.style.zoom = value === 1 ? '' : String(value);
  }, zoom);
  const setOverlay = (display) =>
    target.evaluate((value) => {
      for (const el of document.body.children) {
        if (el.shadowRoot) {
          el.style.display = value;
        }
      }
    }, display);
  await setOverlay('none');
  await new Promise((r) => setTimeout(r, Number(process.env.MH_WAIT ?? 1500)));
  await page.screenshot({ path: outFile });
  await setOverlay('');
  await target.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
  console.log('STILL ' + outFile);
}
