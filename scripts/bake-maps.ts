/**
 * 平面图烘焙编排：起 dev server → 生成临时作业页 → 起无头 Chrome 打开它 → 等产物落盘 → 收尾。
 *
 * 入口**只有这一个脚本**（没有可手动打开的页面）。渲染仍走运行时渲染器，浏览器只是宿主；
 * 作业参数内联进临时页 `.bake-job.html`（跑完即删），所以照抄 URL 重跑这种事不会再发生。
 *
 *   npm run bake-maps -- --maps=2,3            # 烘指定地图
 *   npm run bake-maps -- --all --scale=8       # 全部（63 张）
 *   npm run bake-maps -- --maps=2 --server=http://localhost:5173 --no-server   # 复用已在跑的 dev
 *
 * 产物落 `<VITE_ASSET_ROOT>/<--out>`（默认 image/planemap），同时写 `_bake.log` 与 `index.json`。
 * 无头模式下浏览器控制台看不到，所以诊断一律走 `_bake.log`（本脚本结束时打印尾部）。
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadEnv } from 'vite';

interface Args {
  maps: number[] | null;
  all: boolean;
  scale: number;
  out: string;
  port: number;
  server: string | null;
  noServer: boolean;
  timeoutMs: number;
  debug: boolean;
  probeOnly: boolean;
  override: boolean;
  keepWater: boolean;
  format: 'png' | 'webp';
  quality: number;
  dumpMaterials: boolean;
  /** 冒烟检查：按游戏默认配置渲染该图（改过共享渲染代码后跑一次） */
  smoke: number | null;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | null => {
    const pref = `--${k}=`;
    const hit = argv.find((a) => a.startsWith(pref));
    return hit ? hit.slice(pref.length) : null;
  };
  const maps = get('maps');
  return {
    maps: maps ? maps.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n)) : null,
    all: argv.includes('--all'),
    scale: Number(get('scale') ?? '8'),
    out: get('out') ?? 'image/planemap',
    port: Number(get('port') ?? '5178'),
    server: get('server'),
    noServer: argv.includes('--no-server'),
    timeoutMs: Number(get('timeout') ?? '600000'),
    debug: argv.includes('--debug'),
    probeOnly: argv.includes('--probeOnly'),
    keepWater: argv.includes('--keepWater'),
    dumpMaterials: argv.includes('--dumpMaterials'),
    smoke: get('smoke') === null ? null : Number(get('smoke')),
    format: get('format') === 'webp' ? 'webp' : 'png',
    quality: Number(get('quality') ?? '0.9'),
    override: argv.includes('--override'),
  };
}

function findChrome(): string {
  const env = process.env.CHROME_PATH;
  if (env && existsSync(env)) return env;
  const cands = process.platform === 'win32'
    ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const c of cands) if (existsSync(c)) return c;
  throw new Error('找不到 Chrome/Edge —— 用 CHROME_PATH=<可执行文件> 指定');
}

/** 端口是否已被占用（占用就换一个 —— 上一次没清干净的 dev server 会一直挡在这里） */
async function portInUse(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/`, { method: 'HEAD' });
    return true;
  } catch {
    return false;
  }
}

/** 从 start 起找一个空闲端口 */
async function pickFreePort(start: number): Promise<number> {
  for (let p = start; p < start + 30; p++) if (!(await portInUse(p))) return p;
  throw new Error(`从 ${start} 起 30 个端口都被占用`);
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.ok || r.status === 404) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`dev server 未就绪: ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.all && args.smoke === null && (!args.maps || args.maps.length === 0)) {
    console.error('用法: npm run bake-maps -- --maps=2,3 [--scale=16] [--format=webp]  或  --all');
    console.error('      npm run bake-maps -- --smoke=3      # 冒烟检查（游戏默认配置渲染一张）');
    process.exit(2);
  }
  if (!Number.isFinite(args.scale) || args.scale <= 0) {
    console.error('scale 非法: ' + args.scale);
    process.exit(2);
  }

  const env = loadEnv('development', process.cwd(), '');
  const assetRoot = resolve(env.VITE_ASSET_ROOT || '');
  if (!assetRoot || !existsSync(assetRoot)) {
    console.error('VITE_ASSET_ROOT 不存在: ' + assetRoot);
    process.exit(2);
  }
  const outAbs = resolve(assetRoot, args.out);
  // 每轮独立日志文件名：不与上一轮混，也避免"读到上一次的日志"
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logName = `_bake-${runId}.log`;
  const logAbs = resolve(outAbs, logName);
  const doneAbs = resolve(outAbs, `_bake-${runId}.done.json`);
  // 作业页：把任务参数**内联**进一个临时 HTML（放在项目根，vite 才服务得到），跑完即删。
  // 这样没有"可以手动打开、随便带参数"的入口 —— 先前那个 bake.html 就是这么把
  // 63 张图的 index.json 覆盖成 1 条的。
  const jobPage = resolve(process.cwd(), '.bake-job.html');
  const job = {
    all: args.all, ids: args.maps ?? [], scale: args.scale, outDir: args.out,
    format: args.format, quality: args.quality,
    debug: args.debug, probeOnly: args.probeOnly, override: args.override,
    dumpMaterials: args.dumpMaterials, keepWater: args.keepWater, logFile: logName,
    ...(args.smoke === null ? {} : { smoke: args.smoke }),
  };

  // 不必清日志：文件名带 runId，每轮独立。
  // ⚠ **不要清 index.json**：它是整个集合的元数据，作业页要靠它做一致性闸门
  //   （比例尺/格式不一致就拒绝写入）—— 先前在这里删掉它，闸门读到的是 SPA 回退的 HTML，
  //   被当成"空目录"而放行，于是又一次单张重烘把 63 张的记录覆盖成 1 条。

  const port = args.server ? args.port : await pickFreePort(args.port);
  const base = args.server ?? `http://localhost:${port}`;
  if (!args.server) console.log(`[bake] 用端口 ${port}`);
  let dev: ChildProcess | null = null;
  let chrome: ChildProcess | null = null;
  // 每次跑用**独立** profile：Chrome 退出有延迟，上一次的目录常被占住，
  // 复用固定名字就会出现"浏览器提前退出 code=21"（profile in use），而且看不出原因。
  const chromeProfile = resolve(tmpdir(), `jpstale-bake-${process.pid}`);

  try {
    if (!args.noServer) {
      console.log(`[bake] 起 dev server :${port} …`);
      dev = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
        cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32',
      });
      dev.stdout?.on('data', (d: Buffer) => process.stdout.write('[vite] ' + d.toString()));
      dev.stderr?.on('data', (d: Buffer) => process.stderr.write('[vite] ' + d.toString()));
    }
    await waitForServer(base + '/', 60000);

    writeFileSync(jobPage, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>bake job</title>
<style>html,body{margin:0;background:#101014;color:#cfc;font:12px/1.5 monospace}#log{padding:8px 10px;white-space:pre}</style>
</head><body><div id="log">…</div>
<script>window.__BAKE_JOB__ = ${JSON.stringify(job)};</script>
<script type="module" src="/src/tools/bake-job.ts"></script>
</body></html>`, 'utf8');
    const url = `${base}/.bake-job.html`;
    const chromePath = findChrome();
    console.log(`[bake] 打开无头浏览器：${url}`);
    chrome = spawn(chromePath, [
      '--headless=new',
      '--enable-unsafe-swiftshader',        // 软件 WebGL（无独显/无头环境需要）
      '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${chromeProfile}`,
      '--remote-debugging-port=0',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--window-size=1600,1200',
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    chrome.stderr?.on('data', (d: Buffer) => process.stderr.write('[chrome] ' + d.toString()));

    // 等产物：以**本轮独立的** `.done.json` 为完成标志（页面最后写它，成功/失败都写）。
    // 不拿 index.json 当信号 —— 它开跑前就存在，会把上一轮当本轮结果、静默报"成功"；
    // 也不靠日志尾行（实测长时间运行下会丢）。
    // 卡死看门狗：STALL_MS 内日志没有增长 → 判定卡住并报出最后几行（"卡在哪"要看得见）。
    const STALL_MS = 120000;
    const indexAbs = resolve(outAbs, 'index.json');
    const t0 = Date.now();
    let printed = 0;   // 已转发的日志行数（增量打印，别把整份日志刷屏）
    let lastGrow = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      if (existsSync(logAbs)) {
        const lines = readFileSync(logAbs, 'utf8').trimEnd().split('\n');
        if (lines.length > printed) lastGrow = Date.now();
        for (const line of lines.slice(printed)) console.log('  ' + line);
        printed = lines.length;
      }
      if (existsSync(doneAbs)) break;
      if (Date.now() - lastGrow > STALL_MS) {
        throw new Error(`日志 ${STALL_MS}ms 无增长，判定卡住（最后一行见上）。日志: ${logAbs}`);
      }
      if (Date.now() - t0 > args.timeoutMs) throw new Error(`超时 ${args.timeoutMs}ms，未见 ${doneAbs}`);
      if (chrome.exitCode !== null) throw new Error(`浏览器提前退出（code=${chrome.exitCode}），见上方 [chrome] 输出`);
    }

    // 验收：本轮请求的图必须**全部**烘出来，否则算失败（别让"只烘了一张"也报成功）
    const marker = JSON.parse(readFileSync(doneAbs, 'utf8')) as {
      ok: number; failed: number; requested: number; failedIds: number[];
    };
    if (marker.failed > 0 || marker.ok !== marker.requested) {
      console.error(`\n[bake] 本轮未达标：请求 ${marker.requested} 张，成功 ${marker.ok}，失败 ${marker.failed}`
        + (marker.failedIds.length ? `（失败 id: ${marker.failedIds.join(',')}）` : ''));
      process.exitCode = 1;
      return;
    }

    // 失败路径：日志里有"整体失败"就说清并退出，**不要**拿旧 index.json 当结果打印
    const logText = existsSync(logAbs) ? readFileSync(logAbs, 'utf8') : '';
    const failLines = logText.split('\n').filter((l) => l.includes('整体失败'));
    if (failLines.length > 0) {
      console.error('\n[bake] 本次烘焙失败（未写入任何 index.json）：');
      for (const l of failLines) console.error('  ' + l.replace(/^\S+ /, ''));
      process.exitCode = 1;
      return;
    }

    const index = JSON.parse(readFileSync(indexAbs, 'utf8')) as {
      scale: number;
      format: string;
      totalBytes: number;
      maps: { id: number; shortname: string; w: number; h: number; bytes: number; ms: number; notes: string[] }[];
    };
    const ok = index.maps.filter((m) => m.w > 0);
    const bad = index.maps.filter((m) => m.w === 0);
    console.log(`\n[bake] 完成：成功 ${ok.length} / 失败 ${bad.length}，比例尺 1px = ${index.scale} 单位`);
    console.log(`[bake] 产物目录：${outAbs}`);
    for (const m of ok.slice(0, 20)) console.log(`  ${String(m.id).padStart(2)} ${m.shortname.padEnd(16)} ${m.w}x${m.h}  ${(m.bytes / 1024).toFixed(0)}KB  ${m.ms}ms${m.notes.length ? '  ⚠ ' + m.notes.join('; ') : ''}`);
    if (ok.length > 20) console.log(`  …另有 ${ok.length - 20} 张`);
    for (const m of bad) console.log(`  ${String(m.id).padStart(2)} ${m.shortname.padEnd(16)} 失败: ${m.notes.join('; ')}`);
    if (bad.length > 0) process.exitCode = 1;
  } finally {
    rmSync(jobPage, { force: true });
    killTree(chrome);
    killTree(dev);
    // 清目录是收尾，失败不该把整轮结果吞掉（Windows 上 Chrome 退出有延迟，目录常被占住）
    try {
      rmSync(chromeProfile, { recursive: true, force: true });
    } catch (err) {
      console.warn('[bake] 临时 profile 未清掉（不影响产物）: ' + String(err));
    }
  }
}

/** Windows 上 child.kill 杀不掉子进程树（Chrome 会留一堆进程），用 taskkill */
function killTree(p: ChildProcess | null): void {
  if (!p || p.exitCode !== null) return;
  if (process.platform === 'win32' && p.pid) {
    spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    p.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error('[bake] 失败: ' + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});
