/**
 * 循环驱动 —— "**这一帧由谁驱动**"的唯一实现（前台 rAF ↔ 后台闹钟）。
 *
 * 为什么要有它：浏览器在标签页隐藏时**完全停掉 `requestAnimationFrame`**，并把主线程定时器节流
 * （≥1Hz；Chrome 隐藏 ≥5min 收紧到 ≥1/min）。网络游戏的主循环一旦压在 rAF 上，切 tab / 最小化就
 * "世界停摆 + 心跳超时掉线"（用户 2026-09-21 实测："客户端整个卡死"）。做法：隐藏时改用 Timer Worker
 * 当"后台闹钟"按 30Hz 驱动**同一个** `onFrame`（Worker 只提供时间源，游戏状态一律留主线程 ——
 * 见 `core/keepalive-timer.ts` 的定案："搬状态进 Worker 是另一条代价高得多的路，本项目不走"）。
 *
 * 这段逻辑起初散在 `WorldView.renderLoop` 里（`worldActive` / `bgTimerId` / `onVisibilityChange`
 * 三个变量 + 一条自排 rAF 链），出过两个真问题：**`worldActive` 只置 false 从不置回 true**
 * （"回选角再进游戏"后只渲染一帧就永久停摆），以及**"进来时页面已经隐藏"没人处理**（后台进来的
 * 会话永不启动闹钟）。状态+生命周期必须收进一个对象（AGENTS #15/#39），故抽成这里。
 *
 * 分工（**别把业务塞进来**）：
 *   - 本模块只管"谁驱动、什么时候驱动、何时解绑"；
 *   - **帧内容、限帧策略（`targetFps`）、后台帧跳过哪些渲染**都留在调用方（WorldView）——
 *     各循环本来就不一样（AGENTS #39：机制上移成唯一实现，策略留调用方）。
 *
 * 三条硬约束（`npm run verify-loop-driver` 逐条钉住）：
 *   ① 同一时刻**只有一条驱动链**：世代号（`gen`）作废一切过期回调 ——
 *      "隐藏期间排下的 rAF 在恢复可见时补跑"这类回调必须被丢掉，否则两条链同跑 = 逻辑双倍推进；
 *   ② `start()` **按当前可见性直接落位**，不是等 `visibilitychange`：会话恢复的后台标签页可以
 *      无手势直接进世界（`main.ts` 的自动续期），那一刻不会再有可见性事件；
 *   ③ `stop()` 之后**不许再有任何回调**（hide/destroy 语义）。
 *   ④ **以"帧有没有真的来"为准**，不信可见性 API：webview / 被遮挡窗口里 rAF 已停而
 *      `document.hidden` 仍是 false（实测过）⇒ 前台超过 `stallMs` 没帧就自己切后台闹钟，
 *      后台每 ~0.5s 探一次 rAF，恢复了再切回来（自愈，两个方向都有）。
 */
export type LoopMode = 'foreground' | 'background' | 'stopped';

export interface LoopDriverDeps {
  /** 当前是否隐藏（生产：`() => document.hidden`） */
  isHidden: () => boolean;
  /** 前台驱动（生产：`requestAnimationFrame`） */
  raf: (cb: (tsMs: number) => void) => number;
  cancelRaf: (id: number) => void;
  /**
   * 后台驱动（生产：`keepalive-timer` 的 `setKeepaliveInterval` / `clearKeepaliveInterval`）。
   * 语义与 `setInterval` 相同（重复触发），由驱动自己保证只排一条。
   */
  scheduleBackground: (cb: () => void, ms: number) => number;
  cancelBackground: (id: number) => void;
  /** 帧时基（生产：`() => performance.now()`）—— 后台帧没有 rAF 时间戳，用它 */
  now: () => number;
  /** 订阅可见性变化，返回取消订阅（生产：`document.addEventListener('visibilitychange', …)`） */
  subscribeVisibility: (cb: () => void) => () => void;
  /** 一帧。`mode` 由驱动给出 = **判断"要不要跳过 GPU 提交"的唯一依据**（别在帧里再读一次 document.hidden） */
  onFrame: (tsMs: number, mode: 'foreground' | 'background') => void;
  /** 模式切换通知（生产：退出前台时释放按键/鼠标 —— 否则过期光标会继续驱动角色走） */
  onModeChange?: (mode: LoopMode) => void;
  /**
   * **前台帧心跳看门狗**周期，默认 250ms。
   *
   * 为什么不只信 `document.hidden`：**rAF 停掉的原因不止"页面隐藏"** —— 被遮挡窗口、嵌入式浏览器/webview
   * 的可见性实现差异、主线程被长任务（例如 200 秒的地图分块构建）压住……都可能让前台长时间没有帧，
   * 而 `document.hidden` 仍是 `false`。那种情况下"等人通知我隐藏"永远等不到 ⇒ 世界停摆（用户报的卡死形态）。
   * 所以驱动**以"帧有没有真的来"为准**：前台模式下超过 `stallMs` 没有帧，就自己切到后台闹钟
   * （并 `onWarn` 说明原因，不静默 —— AGENTS #12）。
   *
   * ⚠ 依据边界（别把它写成"实测某某浏览器会撒谎"）：本项目在 ZCode 应用内浏览器里**没能**造出
   * "`hidden=false` 但 rAF 停"的真实场景（它的后台标签页照跑 rAF）。这条是**防御性设计**，
   * 理由是"可见性只是众多停帧原因之一"，真机只验证了它的行为（停 rAF ⇒ 自动接管并继续跑）。
   */
  watchdogMs?: number;
  /**
   * 判定"rAF 已被停"的阈值，默认 2000ms。
   * 必须大于最慢的合法帧间隔（`targetFps` 设 1 时是 1s），否则会误判。
   */
  stallMs?: number;
  /** 诊断上报（生产：`console.warn`）——看门狗纠正驱动方式时说明原因 */
  onWarn?: (detail: string) => void;
  /**
   * 后台驱动间隔，默认 `1000/30`（30Hz）。
   *
   * **为什么是 30Hz 而不是 1Hz**：主循环的位移与动画都有 `dt ≤ 0.1s` 的钳位
   * （`updateMovement` 的 `mdt`、`advanceAnimFrame` 的 `maxDt`）——更慢的驱动会让
   * 它们**按比例变慢**（挂机时"移动/挥拳像慢动作"）。30Hz（33ms）稳定落在钳位以内。
   */
  backgroundIntervalMs?: number;
}

export interface LoopDriver {
  /** 开始驱动（幂等）。按当前可见性落位，见约束 ② */
  start(): void;
  /** 停止（幂等）。停后不再有任何回调，见约束 ③ */
  stop(): void;
  /** 当前驱动方式（诊断/断言用；只能靠 start/stop/可见性变化改变） */
  readonly mode: LoopMode;
}

export function createLoopDriver(deps: LoopDriverDeps): LoopDriver {
  const bgMs = deps.backgroundIntervalMs ?? 1000 / 30;
  const watchdogMs = deps.watchdogMs ?? 250;
  const stallMs = deps.stallMs ?? 2000;
  /** 世代号：每次换链/停止都 +1，令所有在飞回调作废（约束 ①） */
  let gen = 0;
  let mode: LoopMode = 'stopped';
  let rafId = 0;
  let bgId = 0;
  let watchdogId = 0;
  let unsub: (() => void) | null = null;
  /** 上一帧送达的时刻（用注入的 now()，与后台帧同一时基）——看门狗判"rAF 是否真的在给帧" */
  let lastFrameAt = 0;
  /** 后台第几次 tick（每 N 次探一次 rAF，用于"rAF 恢复了"的自愈） */
  let bgTicks = 0;
  const RECOVER_PROBE_EVERY = 16;   // ≈ 0.5s（30Hz 下）

  function stopChains(): void {
    if (rafId) { deps.cancelRaf(rafId); rafId = 0; }
    if (bgId) { deps.cancelBackground(bgId); bgId = 0; }
    if (watchdogId) { deps.cancelBackground(watchdogId); watchdogId = 0; }
  }

  /** 一帧的入口：世代号不符 = 过期回调（已换链/已停）→ 丢掉，不产生第二条链 */
  function tick(tsMs: number, myGen: number): void {
    if (myGen !== gen || mode === 'stopped') return;
    lastFrameAt = deps.now();                  // 帧心跳（看门狗据此判断 rAF 是否还在给帧）
    deps.onFrame(tsMs, mode);
    // onFrame 里可能 stop()/切链（重入）：再查一次世代号，避免多排一条链
    if (myGen !== gen) return;
    if (mode === 'foreground') {
      rafId = deps.raf((ts) => tick(ts, myGen));
      return;
    }
    // 后台：闹钟自重复；每 ~0.5s 探一次 rAF —— 可见性 API 若一直不翻转（webview），
    // 靠这个自愈回 vsync 节奏（探测回调只在"rAF 真的恢复了"时才会被执行）
    if (++bgTicks % RECOVER_PROBE_EVERY === 0) {
      deps.raf(() => {
        if (myGen === gen && mode === 'background') enter('foreground');
      });
    }
  }

  /** 看门狗（仅前台运行）：rAF 若被浏览器停掉而 `document.hidden` 仍撒谎，就改由闹钟驱动 */
  function watchdog(): void {
    if (mode !== 'foreground') return;
    const idle = deps.now() - lastFrameAt;
    if (idle <= stallMs) return;
    deps.onWarn?.(`前台已有 ${Math.round(idle)}ms 没有帧（rAF 被停，但 document.hidden=`
      + `${deps.isHidden()}）→ 改用后台闹钟驱动`);
    enter('background');
  }

  function enter(next: 'foreground' | 'background'): void {
    if (mode === next) return;                 // 已在这条链上（幂等，别排出第二条）
    mode = next;
    gen++;
    stopChains();                              // 先停旧链，再起新链
    // ⚠ 世代号必须**按值快照**进闭包：写成 `(ts) => tick(ts, gen)` 会在回调真正被投递时才读 `gen`
    //   —— 那正是"过期回调"场景（切链后旧回调才到），守卫会失效（verify-loop-driver ④ 抓过）。
    const myGen = gen;
    lastFrameAt = deps.now();
    if (next === 'foreground') {
      rafId = deps.raf((ts) => tick(ts, myGen));
      watchdogId = deps.scheduleBackground(() => watchdog(), watchdogMs);
    } else {
      bgTicks = 0;
      bgId = deps.scheduleBackground(() => tick(deps.now(), myGen), bgMs);
    }
    deps.onModeChange?.(mode);
  }

  return {
    get mode(): LoopMode { return mode; },
    start(): void {
      if (mode !== 'stopped') return;
      if (!unsub) {
        // 只在运行时订阅：stop() 会解绑（生命周期跟着状态走，AGENTS #15）
        unsub = deps.subscribeVisibility(() => {
          if (mode === 'stopped') return;
          enter(deps.isHidden() ? 'background' : 'foreground');
        });
      }
      enter(deps.isHidden() ? 'background' : 'foreground');   // 约束 ②：按当前可见性落位
    },
    stop(): void {
      if (mode === 'stopped') return;
      mode = 'stopped';
      gen++;
      stopChains();
      unsub?.();
      unsub = null;
      deps.onModeChange?.(mode);
    },
  };
}
