/**
 * `npm run verify-worldmap` —— 跑 `worldmap.html?selftest=1`，把结果打出来。
 *
 * 流程：起一个临时 vite（端口交给它自己挑）→ 无头 Chrome 打开自检页 → 读**落盘**的
 * `<资产根>/image/planemap/_selftest.log`（自检里有 await，落盘发生在页面 load 之后，
 * 所以这里轮询等文件里出现 SELFTEST 标题）。退出码：全过 0，有 FAIL 1。
 *
 * 两个踩过的坑写在这儿免得重蹈：
 *   ① 端口别写死 —— 上次留下的孤儿 vite 会占着它，然后白等一轮超时（改用 vite JS API 自动挑）。
 *   ② `--dump-dom` 抓不到 rAF 之后的内容，控制台也不一定刷出来 —— 所以自检把结果**落盘**，
 *      这里读文件，不依赖浏览器时序。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ASSET_ROOT = process.env.PT_ASSET_ROOT || 'E:/JPsTale/client';
const LOG = `${ASSET_ROOT}/image/planemap/_selftest.log`;
const CHROME = process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : '/usr/bin/google-chrome';
const DEBUG_PORT = 9300 + (process.pid % 400);
const profile = resolve(tmpdir(), `jpstale-wm-${process.pid}`);

let PORT = 0;
let viteServer = null;
let chrome = null;

async function startVite() {
  const { createServer } = await import('vite');
  viteServer = await createServer({ server: { port: 0, strictPort: false } });
  await viteServer.listen();
  const url = viteServer.resolvedUrls?.local?.[0] ?? '';
  const m = /:(\d+)/.exec(url);
  if (!m) throw new Error(`vite 没给出端口（resolvedUrls=${JSON.stringify(viteServer.resolvedUrls)}）`);
  PORT = Number(m[1]);
  process.stdout.write(`[vite] ${url}\n`);
}

/** 轮询等某个 URL 可用（vite 的 listen() 已 resolve，这里只是兜一层） */
async function waitHttp(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

try {
  rmSync(LOG, { force: true });
  await startVite();
  if (!(await waitHttp(`http://127.0.0.1:${PORT}/worldmap.html`))) throw new Error('vite 起来了但页面取不到');

  mkdirSync(profile, { recursive: true });
  chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,900',
    '--disable-gpu', '--enable-unsafe-swiftshader',
    `http://127.0.0.1:${PORT}/worldmap.html?selftest=1`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  chrome.stderr.on('data', (d) => {
    const s = String(d);
    if (/FATAL|Failed to launch/.test(s)) process.stderr.write('[chrome!] ' + s);
  });

  const t0 = Date.now();
  let body = '';
  while (Date.now() - t0 < 60000) {
    await new Promise((r) => setTimeout(r, 1000));
    if (!existsSync(LOG)) continue;
    body = readFileSync(LOG, 'utf8');
    const head = body.split('\n')[0] ?? '';
    // 首行出现标题 + 内容够多 ⇒ 自检跑完了（首行的是旧内容时也靠这两条挡掉）
    if (/SELFTEST (OK|FAIL|CRASH)/.test(head) && body.split('\n').length > 20) break;
    body = '';
  }
  if (!body) throw new Error('没等到自检结果（页面报错？先手动开 worldmap.html?selftest=1 看看控制台）');

  console.log('\n===== _selftest.log =====\n' + body);
  const fails = body.split('\n').filter((l) => l.startsWith('FAIL'));
  console.log(`\n===== ${body.split('\n')[0]} | FAIL ${fails.length} =====`);
  process.exitCode = fails.length === 0 ? 0 : 1;
} finally {
  chrome?.kill();
  try { await viteServer?.close(); } catch { /* ignore */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
