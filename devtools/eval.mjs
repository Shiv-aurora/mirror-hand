// Dev-only: evaluate MH_EVAL (a JS expression) in the running app.
export default async function run({ frame, page }) {
  const target = frame ?? page;
  const out = await target.evaluate((code) => {
    try { return JSON.stringify((0, eval)(code)); } catch (e) { return 'ERR ' + e; }
  }, process.env.MH_EVAL ?? '1');
  console.log('EVAL ' + out);
}
