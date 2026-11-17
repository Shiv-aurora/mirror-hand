// Dev-only: print the app's debug state from the managed browser.
export default async function run({ frame, page }) {
  const target = frame ?? page;
  const state = await target.evaluate(() => {
    const api = globalThis.__mirrorHand;
    return api ? api.state() : null;
  });
  console.log('STATE ' + JSON.stringify(state));
  return state;
}
