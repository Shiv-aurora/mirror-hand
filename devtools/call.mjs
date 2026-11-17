// Dev-only: call a debug hook, e.g. MH_CALL=recentre or MH_CALL=press:skip
export default async function run({ frame, page }) {
  const target = frame ?? page;
  const call = process.env.MH_CALL ?? 'recentre';
  const [name, arg] = call.split(':');
  return target.evaluate(
    ([n, a]) => {
      const api = globalThis.__mirrorHand;
      if (!api || typeof api[n] !== 'function') return 'no hook ' + n;
      api[n](a);
      return 'called ' + n + (a ? ':' + a : '');
    },
    [name, arg],
  );
}
