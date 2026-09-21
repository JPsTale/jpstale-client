/// <reference lib="webworker" />
/**
 * keepalive-timer 的计时核心（purpose 见 `keepalive-timer.ts` 顶部说明）。
 *
 * 只在标签页隐藏/最小化时使用：主线程的 `setTimeout/setInterval` 会被浏览器节流
 * （≥1Hz；Chrome 隐藏 ≥5min 后收紧到 ≥1/min），而 **Worker 线程的定时器不受页面可见性节流**。
 * 到点后 `postMessage` 回主线程即可 —— 主线程的 `message` 事件同样不会被节流。
 *
 * ⚠ 本 Worker **不搬任何状态**：它只是"后台闹钟"。所有游戏逻辑（three 场景、骨骼、实体）都留在
 * 主线程，主线程收到通知后跑同一份循环（见 `WorldView.renderLoop`）。搬状态进 Worker 是另一条
 * 代价高得多的路，本项目不走。
 */
interface Slot {
  kind: 'interval' | 'timeout';
  handle: number;
}

const slots = new Map<number, Slot>();

self.onmessage = (e: MessageEvent<{ cmd: string; id: number; ms?: number }>) => {
  const { cmd, id, ms } = e.data;
  if (cmd === 'interval' || cmd === 'timeout') {
    // 同 id 重设：先清旧句柄（幂等，调用方不必先 clear）
    const old = slots.get(id);
    if (old) (old.kind === 'interval' ? clearInterval : clearTimeout)(old.handle);
    const fire = () => { (self as unknown as Worker).postMessage({ id }); };
    const handle = cmd === 'interval' ? setInterval(fire, ms) : setTimeout(fire, ms);
    slots.set(id, { kind: cmd === 'interval' ? 'interval' : 'timeout', handle });
  } else if (cmd === 'clear') {
    const old = slots.get(id);
    if (old) {
      (old.kind === 'interval' ? clearInterval : clearTimeout)(old.handle);
      slots.delete(id);
    }
  }
};
