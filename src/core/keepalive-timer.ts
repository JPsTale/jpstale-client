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
 */
type TimerCallback = () => void;

interface Slot {
  kind: 'interval' | 'timeout';
  fn: TimerCallback;
}

let worker: Worker | null = null;
let nextId = 1;
const slots = new Map<number, Slot>();

function ensureWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./keepalive-timer.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number }>) => {
    const slot = slots.get(e.data.id);
    if (!slot) return;
    if (slot.kind === 'timeout') slots.delete(e.data.id);
    slot.fn();
  };
  worker = w;
  return w;
}

function schedule(kind: 'interval' | 'timeout', fn: TimerCallback, ms: number): number {
  const id = nextId++;
  slots.set(id, { kind, fn });
  ensureWorker().postMessage({ cmd: kind, id, ms });
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
  if (!slots.delete(id)) return;
  worker?.postMessage({ cmd: 'clear', id });
}
