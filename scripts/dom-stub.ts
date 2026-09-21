/**
 * Node 里跑 verify 脚本时的最小 DOM 桩（**唯一实现**，别在脚本里各抄一份）。
 *
 * 为什么需要：`src/audio/sfx.ts` 在 **import 时**就注册 `document`/`window` 监听（解锁音频、全局点击音）。
 * 任何间接 import 到 `gameStore`（→ `item-sounds` → `sfx`）的脚本，在 node 下都会
 * `ReferenceError: document is not defined`。桩掉之后验的就是**真实模块**，而不是退化成读源码字符串。
 */
export function installDomStub(): void {
  const noopTarget = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true };
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = {
    ...noopTarget,
    documentElement: { style: {} },
    body: { appendChild: () => {}, style: {} },
    createElement: () => ({ style: {}, classList: { add: () => {} }, appendChild: () => {} }),
    querySelector: () => null,
  };
  g.window = { ...noopTarget, innerWidth: 1280, innerHeight: 720 };
  const store = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}
