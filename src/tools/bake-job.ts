/**
 * 烘焙**作业页**（不是给人打开的页面）。
 *
 * 由 `scripts/bake-maps.ts` 在运行时生成一个临时 HTML（`.bake-job.html`），把任务参数内联成
 * `window.__BAKE_JOB__` 再加载这个模块 —— **没有 URL 参数可调**，跑完脚本就删掉那个 HTML。
 * 这样做的原因：先前有个可手动打开的 `bake.html`，任何人在浏览器里带一组参数点一下就能重烘，
 * 曾把 63 张图的 `index.json` 覆盖成 1 条（页面按错的 scale/format 读 → 看起来"图全没了"）。
 *
 * 渲染仍走**运行时渲染器**（three.js + WebGL，见 `bake-map.ts`）：烘出来的图必须与游戏内一致，
 * 所以不能另写一套 Node 光栅化 —— 那会把贴图/UV/顶点色/装饰摆放全部复制一遍，早晚与游戏漂移。
 * 浏览器只是"跑运行时渲染器"的宿主，入口只有脚本一个。
 *
 * 落盘走 vite dev 中间件的 `/__bake`（见 vite.config.ts）；诊断写 `<out>/_bake.log`
 * —— 无头模式下控制台拿不到，"没报错"很容易只是"没人看"。
 */
import { FIELDS } from '../maps/map-data.js';
import { runBake, smokeTest } from './bake-map.js';

interface BakeJob {
  /** 要烘的 mapId；`all: true` 时忽略 */
  ids?: number[];
  all?: boolean;
  scale: number;
  outDir: string;
  format: 'png' | 'webp';
  quality: number;
  smoke?: number;
  debug?: boolean;
  probeOnly?: boolean;
  override?: boolean;
  dumpMaterials?: boolean;
  keepWater?: boolean;
}

const job = (window as unknown as { __BAKE_JOB__?: BakeJob }).__BAKE_JOB__;
const log = document.getElementById('log')!;
const lines: string[] = [];
function say(msg: string): void {
  lines.push(msg);
  log.textContent = lines.slice(-14).join('\n');
}

if (!job) {
  // 没有作业参数 = 有人手动打开了这个页面 —— 直接拒绝（这正是先前出事的路径）
  say('这是一个内嵌作业页，由 `npm run bake-maps` 生成与驱动，不能手动打开。');
  document.title = 'NO JOB';
} else {
  const pushLog = (line: string): void => {
    void fetch('/__bake?path=' + encodeURIComponent(`${job.outDir}/_bake.log`) + '&append=1',
      { method: 'POST', body: `${new Date().toISOString()} [控制台] ${line}\n` }).catch(() => {});
  };
  window.addEventListener('error', (e) => pushLog(`error: ${e.message} @${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => pushLog(`unhandled: ${String((e as PromiseRejectionEvent).reason)}`));
  // 运行时的 console.warn/error（素材缺失、降级…）也落盘
  for (const level of ['warn', 'error'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]): void => {
      orig(...args);
      const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
      // 已知噪声：资产解析缓存淘汰告警（烘图会反复加载贴图，必然刷屏，与结果无关）
      if (text.includes('[asset] 解析缓存超限')) return;
      pushLog(`${level}: ${text}`);
    };
  }

  const ids = job.all ? FIELDS.map((f) => f.id) : (job.ids ?? []);
  if (job.smoke !== undefined) {
    smokeTest(job.smoke, job.outDir)
      .then((n) => { say(`冒烟检查：可见像素 ${n}`); document.title = n > 0 ? 'SMOKE OK' : 'SMOKE EMPTY'; })
      .catch((err) => { say('冒烟检查失败 ' + (err instanceof Error ? err.message : String(err))); document.title = 'SMOKE FAILED'; });
  } else if (ids.length === 0) {
    say('作业里没有 ids 且不是 all');
    document.title = 'FAILED';
  } else {
    runBake({ ...job, ids, onProgress: say })
      .then((recs) => {
        const ok = recs.filter((r) => r.w > 0);
        say(`完成：${ok.length}/${recs.length}`);
        document.title = `DONE ${ok.length}/${recs.length}`;
      })
      .catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        say('**整体失败** ' + msg);
        document.title = 'FAILED';
        // 必须写结束标记：编排脚本靠日志尾行判完成，否则它会一直等到超时，
        // 而且会把**旧的** index.json 当成本次结果打印出来。
        await fetch('/__bake?path=' + encodeURIComponent(`${job.outDir}/_bake.log`) + '&append=1',
          { method: 'POST', body: `${new Date().toISOString()} bake 结束：整体失败 — ${msg}
` }).catch(() => {});
      });
  }
}
