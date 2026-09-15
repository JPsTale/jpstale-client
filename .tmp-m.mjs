import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { createServer } = await import('vite');
const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const PORT = Number(/:(\d+)/.exec(server.resolvedUrls.local[0])[1]);
const profile = mkdtempSync(join(tmpdir(), 'm-'));
const DEBUG = 9501;
spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--enable-unsafe-swiftshader', '--window-size=1600,900',
  `http://127.0.0.1:${PORT}/index.html`,
], { stdio: 'ignore' });
async function waitJson(url, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {} await new Promise((r) => setTimeout(r, 300)); }
  throw new Error('no ' + url);
}
const list = await waitJson(`http://127.0.0.1:${DEBUG}/json/list`);
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 150)); };
const send = (m, p) => { const mid = ++id; return new Promise((r) => { pending.set(mid, r); ws.send(JSON.stringify({ id: mid, method: m, params: p })); }); };
await new Promise((r) => { ws.onopen = r; });
await send('Runtime.enable');
await new Promise((r) => setTimeout(r, 4500));
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) return 'THROW: ' + (r.exceptionDetails.exception?.description ?? '').slice(0, 200);
  return r?.result?.value;
};
// 推到 WORLD，然后页面内派发 M
await ev(`(async () => { const m = await import('/src/app/State.ts'); const ctx = { showBoot(){},showLogin(){},showServerSelect(){},showCharSelect(){},showCharCreate(){},showWorld(){},hideAll(){} }; m.transition(m.getScreen(), m.AppScreen.LOGIN, ctx); m.transition(m.getScreen(), m.AppScreen.SERVER_SELECT, ctx); m.transition(m.getScreen(), m.AppScreen.CHAR_SELECT, ctx); m.transition(m.getScreen(), m.AppScreen.WORLD, ctx); return m.getScreen(); })()`);
console.log('层栈里的层:', await ev(`(async () => { const L = await import('/src/ui/layerStack.ts'); return JSON.stringify(L.listLayers()); })()`));
console.log('地图 win 的 data-layer:', await ev(`document.querySelector('.jp-wm-win')?.dataset.layer ?? '(无)'`));
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true, cancelable: true }))`);
await new Promise((r) => setTimeout(r, 500));
console.log('按 M 后 .jp-wm class:', await ev(`document.querySelector('.jp-wm')?.className ?? '(无)'`));
console.log('  .jp-wm computed display:', await ev(`(() => { const e = document.querySelector('.jp-wm'); return e ? getComputedStyle(e).display : '-'; })()`));
console.log('  .jp-wm-win:', await ev(`(() => { const e = document.querySelector('.jp-wm-win'); if (!e) return '(无)'; const r = e.getBoundingClientRect(); return JSON.stringify({ z: e.style.zIndex, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), display: getComputedStyle(e).display, vis: getComputedStyle(e).visibility }); })()`));
console.log('  层栈:', await ev(`(async () => { const L = await import('/src/ui/layerStack.ts'); return JSON.stringify(L.listLayers()); })()`));
console.log('--- 相关 console ---');
for (const l of logs.filter((x) => /worldmap|wm|层|layer/i.test(x)).slice(-6)) console.log(' ', l);
process.exit(0);
