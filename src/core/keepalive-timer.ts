/**
 * 后台可用的定时器（标签页隐藏/最小化时依然按时触发）。
 *
 * 背景：浏览器会把隐藏页的 `setTimeout/setInterval` 节流 —— 常规压到 ≥1Hz，Chrome 在页面隐藏
 * 超过 5 分钟后还会进入 intensive throttling，收紧到 ≥1/min；`requestAnimationFrame` 更是直接
 * 停止回调。网络游戏的主循环 / 心跳 / 游戏时钟一旦压在 window 定时器上，切到别的标签页几分钟后
 * 就会「逻辑停摆 + 心跳掉线」。
 *
 * 做法：把一个只负责计时的极简 Worker（`keepalive-timer.worker.ts`）当「后台闹钟」。Worker 线程
 * 的定时器**不受页面可见性节流**，到点 `postMessage` 回主线程 —— 主线程的 `message` 事件同样不被
 * 节流。主线程在回调里继续跑原有逻辑。
 *
 * ⚠ 本模块**不搬任何状态**：Worker 只是闹钟，游戏状态与渲染对象都留在主线程。
 *
 * 用法与 `setInterval` / `setTimeout` 一致（返回 number 句柄）。前台也照常可用 —— 它只是绕开了
 * 节流，不改变触发语义。
 *
 * ⚠ **句柄必须成对清理，且不许混用原生 clear**：本模块的句柄是**自己的编号空间**（不是 DOM 定时器
 * 句柄 —— 两者都从 1 开始，数值会撞）。拿 `clearTimeout`/`clearInterval` 去清一个本模块的句柄
 * **清不掉**（回调仍会飞、Worker 侧还泄漏一条），且这种失效是静默的。一律用
 * `clearKeepaliveTimeout` / `clearKeepaliveInterval`。
 *
 * 降级（**可见，不静默** —— AGENTS #12）：Worker 构造失败或运行期 `onerror` 时，
 * 已登记的定时器改由窗口定时器承载，并 `console.warn` 说明"后台会被节流"这一后果。
 * 游戏内 DevLogPanel 包裹了 console.warn，所以这条在游戏里也看得见；core 层不反向依赖 `char/`，
 * 故不用 `reportFallback`（同 `asset-manager.ts` 的先例）。
 */
type TimerCallback = () => void;

interface Slot {
  kind: 'interval' | 'timeout';
  fn: TimerCallback;
  /** 周期（降级迁移时要用） */
  ms: number;
  /** 承载方式：'worker' = 后台闹钟（不节流）；'window' = 降级（会节流，已上报） */
  carrier: 'worker' | 'window';
  /** carrier='window' 时的原生句柄 */
  nativeId: number;
}

let worker: Worker | null = null;
/** Worker 已确认不可用（构造抛错 / 运行期 onerror）⇒ 之后一律走窗口定时器，不再重试、不刷屏 */
let workerBroken = false;
let nextId = 1;
const slots = new Map<number, Slot>();

function warnDegraded(why: string, err?: unknown): void {
  console.warn(`[keepalive] Timer Worker 不可用（${why}）→ 定时器退回窗口承载；`
    + '隐藏标签页会被浏览器节流（≥1Hz，隐藏 ≥5min 后 ≥1/min），心跳/主循环可能掉线或停摆：', err);
}

/** 用窗口定时器承载一个槽（降级路径） */
function registerNative(slot: Slot, id: number): void {
  const fire = (): void => {
    if (slot.kind === 'timeout') slots.delete(id);
    slot.fn();
  };
  slot.nativeId = slot.kind === 'interval' ? window.setInterval(fire, slot.ms) : window.setTimeout(fire, slot.ms);
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  if (workerBroken) return null;
  try {
    const w = new Worker(new URL('./keepalive-timer.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number }>) => {
      const slot = slots.get(e.data.id);
      if (!slot) return;
      if (slot.kind === 'timeout') slots.delete(e.data.id);
      slot.fn();
    };
    w.onerror = (e) => {
      // 运行期出错 = 闹钟整体作废：把还活着的槽迁到窗口定时器（否则心跳会静默消失）
      warnDegraded('运行时 onerror', e);
      workerBroken = true;
      const dead = worker;
      worker = null;
      try { dead?.terminate(); } catch { /* 已经死了 */ }
      for (const [id, slot] of slots) {
        if (slot.carrier !== 'worker') continue;
        slot.carrier = 'window';
        registerNative(slot, id);
      }
    };
    worker = w;
    return w;
  } catch (err) {
    workerBroken = true;
    warnDegraded('构造失败', err);
    return null;
  }
}

function schedule(kind: 'interval' | 'timeout', fn: TimerCallback, ms: number): number {
  const id = nextId++;
  const slot: Slot = { kind, fn, ms, carrier: 'worker', nativeId: 0 };
  slots.set(id, slot);
  const w = ensureWorker();
  if (w) w.postMessage({ cmd: kind, id, ms });
  else { slot.carrier = 'window'; registerNative(slot, id); }
  return id;
}

/** 后台安全版 `setInterval`。返回句柄，用 `clearKeepaliveInterval` 清除。 */
export function setKeepaliveInterval(fn: TimerCallback, ms: number): number {
  return schedule('interval', fn, ms);
}

/** 后台安全版 `setTimeout`。返回句柄，用 `clearKeepaliveTimeout` 清除。 */
export function setKeepaliveTimeout(fn: TimerCallback, ms: number): number {
  return schedule('timeout', fn, ms);
}

export function clearKeepaliveInterval(id: number): void {
  clearKeepaliveTimeout(id);
}

export function clearKeepaliveTimeout(id: number): void {
  const slot = slots.get(id);
  if (!slot) return;
  slots.delete(id);
  if (slot.carrier === 'worker') worker?.postMessage({ cmd: 'clear', id });
  else if (slot.nativeId) (slot.kind === 'interval' ? clearInterval : clearTimeout)(slot.nativeId);
}
