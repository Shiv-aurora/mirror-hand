export default async function run({ frame, page }) {
  const target = frame ?? page;
  const info = await target.evaluate(() => {
    const m = window.IWER_MCP;
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(m));
    const d = m.device;
    const dproto = d ? Object.getOwnPropertyNames(Object.getPrototypeOf(d)) : [];
    return { proto, dkeys: d ? Object.keys(d) : [], dproto };
  });
  console.log('GLOBALS ' + JSON.stringify(info));
}
