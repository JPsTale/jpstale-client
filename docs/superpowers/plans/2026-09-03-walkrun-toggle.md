# 走跑切换（R 键 + HUD 按钮）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现走/跑切换：R 键（默认可重绑）+ HUD 走跑按钮点击，同步改变移动速度与角色动画（WALK/RUN），走跑为本地状态但经可替换出口以便未来接 C2S。

**Architecture:** WorldView 持有 `running` 真源并决定速度/动画；切换动作经 `onMoveModeChange` 出口；Hud 纯展示（setRunFlag + onAction 上报点击）；main.ts 接线 R 键与 Hud 按钮。R 键走 keyBinding 的 `walkRun` 动作分发（零改动 KeyBinding.ts）。

**Tech Stack:** TypeScript，Three.js，Vite（`npm run build` 校验）。

## Global Constraints

- 全程中文注释；保留现有代码风格。
- 状态真源在 WorldView；Hud 纯展示。
- 走跑切换必须经 `onMoveModeChange` 出口（C 方案，可替换为未来 C2S）。
- KeyBinding.ts **零改动**（`walkRun` 已存在）。
- 按钮图标两态不换（原版仅 walk.bmp），tooltip 变 iWalk↔iRun。
- 速度：`WALK_STEP=3`、`RUN_STEP=7.5`（比≈2.56 对齐原版）。
- 默认跑（`running=true`）。
- 移动速度/动画逻辑是 frame-based（不乘 dt）。

---

### Task 1: WorldView 增加 running 真源、速度/动画切换、可替换出口

**Files:**
- Modify: `src/ui/WorldView.ts`（createWorldView 签名、moving 常量、updateMovement、renderLoop 动画触发、WorldView 接口）

**Interfaces:**
- Produces:
  - `interface WorldViewOpts { onMoveModeChange?: (mode: 'run' | 'walk') => void }`
  - `createWorldView(container: HTMLElement, opts?: WorldViewOpts): WorldView`
  - `WorldView.toggleRun(): boolean`（翻转并返回新值）
  - `WorldView.isRunning(): boolean`
  - 内部 `wasMoving`、`running` 被 Task 2/3 引用。

- [ ] **Step 1: 修改 createWorldView 签名与接口**

在 `WorldView` 接口（42 行附近 `toggleMinimap(): void;`）后追加：
```ts
  /** 走/跑模式（真源）；返回切换后的值 */
  toggleRun(): boolean;
  /** 当前是否跑 */
  isRunning(): boolean;
}
```
改 `createWorldView` 签名（50 行）：
```ts
export interface WorldViewOpts {
  onMoveModeChange?: (mode: 'run' | 'walk') => void; // 可替换出口（未来 C2S）
}

export function createWorldView(container: HTMLElement, opts?: WorldViewOpts): WorldView {
```
在函数体顶部（`let currentMapId = 0` 附近）加：
```ts
  // ---- 走/跑模式（真源；切换动作经 onMoveModeChange 出口，未来可替换为 C2S）----
  let running = true; // 默认跑
```

- [ ] **Step 2: 替换移动速度常量**

把 101-102 行：
```ts
  // ── 移动状态（复刻 /pt/maps/ dummy 移动）──
  let moveSpeed = 3;         // 移动速度（world 单位/帧）
```
改为（保留注释风格）：
```ts
  // ── 移动状态（复刻 /pt/maps/ dummy 移动）──
  const WALK_STEP = 3;       // 走（world 单位/帧）
  const RUN_STEP = 7.5;      // 跑（≈走×2.5，对齐原版 MoveAngle2 460/180）
```

- [ ] **Step 3: updateMovement 用 running 选速度**

在 `updateMovement` 内（WorldView.ts:710 `const step = moveSpeed;`）改为：
```ts
    // 6. 移动一步（复刻 /pt/maps/ MoveAngle2）；速度随走/跑
    const step = running ? RUN_STEP : WALK_STEP;
```

- [ ] **Step 4: renderLoop 动画触发按 running**

把 931-937 行：
```ts
        if (moved && !wasMoving) {
          animState.triggerRun();
          wasMoving = true;
        } else if (!moved && wasMoving) {
          animState.triggerIdle();
          wasMoving = false;
        }
```
改为：
```ts
        if (moved && !wasMoving) {
          if (running) animState.triggerRun();
          else animState.triggerWalk();
          wasMoving = true;
        } else if (!moved && wasMoving) {
          animState.triggerIdle();
          wasMoving = false;
        }
```

- [ ] **Step 5: 加 setRunMode 内部函数 + toggleRun/isRunning**

在 `updateMovement` 定义之前（约 676 行前）插入：
```ts
  // 走/跑切换核心：翻转本地状态并经出口通报；移动中立即切对应动画（原版 character.cpp ChangeMoveMode）
  function setRunMode(next: boolean): boolean {
    if (running === next) return running;
    running = next;
    opts?.onMoveModeChange?.(next ? 'run' : 'walk');
    if (wasMoving) {
      if (running) animState?.triggerRun();
      else animState?.triggerWalk();
    }
    return running;
  }
```

- [ ] **Step 6: 在返回对象里暴露 toggleRun/isRunning**

找到 `return {`（WorldView 返回对象，含 `setGameTime`、`toggleMinimap` 处），加：
```ts
    toggleRun: () => setRunMode(!running),
    isRunning: () => running,
```

- [ ] **Step 7: 构建校验**

Run: `npm run build`
Expected: 无 TS 错误，`built in` 成功。

- [ ] **Step 8: 提交**

```bash
git add src/ui/WorldView.ts
git commit -m "feat(worldview): 走跑真源+速度/动画切换+onMoveModeChange出口"
```

---

### Task 2: Hud 增加 setRunFlag 与 onAction 按钮点击

**Files:**
- Modify: `src/ui/Hud.ts`（interface、createHud 签名、hit-test、pointerdown 处理）

**Interfaces:**
- Consumes: Task 1 的 `WorldView.toggleRun(): boolean` / `isRunning(): boolean`
- Produces:
  - `interface Hud { show; hide; dispose; setRunFlag(run: boolean): void; onAction?: (action: 'toggleRun') => void }`
  - `createHud(container: HTMLElement): Hud`

- [ ] **Step 1: 扩展 Hud interface**

在 `Hud` 接口（15-19 行）追加：
```ts
export interface Hud {
  show(state: HudState): void
  hide(): void
  dispose(): void
  /** 同步走/跑状态到 tooltip 展示 */
  setRunFlag(run: boolean): void
  /** 用户动作回调（走跑按钮等） */
  onAction?: (action: 'toggleRun') => void
}
```
并把 108 行 `const uiState = { runFlag: false, camFlag: 2, mapOnFlag: true };` 中 `runFlag: false` 改为 `runFlag: true`（默认跑，与 WorldView 一致）。

- [ ] **Step 2: setRunFlag 更新展示态**

在 `drawHoverFx` 附近或 `uiState` 定义后加：
```ts
  function setRunFlag(run: boolean): void {
    uiState.runFlag = run;
  }
```

- [ ] **Step 3: 按钮点击 hit-test**

`drawHoverFx` 已有 `hit` 函数与指针坐标换算（139-147 行）。在其后（`drawHoverFx` 函数结束后）加点击判定函数：
```ts
  // 走跑按钮点击：内容坐标 (569,555,595,581) 内左键按下 → 上报动作（复用 pointerdown 记录）
  function checkButtonClick(): void {
    if (!currentState || !ptrDown) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || ptrX < rect.left || ptrX > rect.right || ptrY < rect.top || ptrY > rect.bottom) return;
    const s = rect.width / W;
    const mx = (ptrX - rect.left) / s - 240;
    const my = (ptrY - rect.top) / s - 120;
    if (mx >= 569 && mx < 595 && my >= 555 && my < 581) {
      onAction?.('toggleRun');
    }
  }
```
在 `loop()` 里 `draw()` 调用后加 `checkButtonClick()`：
```ts
  function loop() {
    draw();
    checkButtonClick();
    rafId = requestAnimationFrame(loop);
  }
```

- [ ] **Step 4: 暴露 setRunFlag/onAction 到返回对象**

找到 `return {`（Hud 返回对象，含 show/hide/dispose），加：
```ts
    setRunFlag,
    onAction: undefined, // main.ts 赋值
```

- [ ] **Step 5: 构建校验**

Run: `npm run build`
Expected: 无 TS 错误。

- [ ] **Step 6: 提交**

```bash
git add src/ui/Hud.ts
git commit -m "feat(hud): 走跑按钮点击上报onAction + setRunFlag驱动tooltip"
```

---

### Task 3: main.ts 接线（R 键 + 按钮 + 出口）

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: Task 1 `createWorldView(container, opts)`、`worldView.toggleRun()`；Task 2 `hudPanel.setRunFlag`、`hudPanel.onAction`。
- Produces: 完整功能。

- [ ] **Step 1: createWorldView 传出口**

29 行 `const worldView = createWorldView(app);` 改为：
```ts
const worldView = createWorldView(app, {
  onMoveModeChange: (mode) => console.log('[mmode]', mode), // P1 占位出口；未来接 C2S 时替换
});
```

- [ ] **Step 2: R 键（walkRun）接 toggleRun**

`keyBinding.onKeyDown((action) => {...})`（58-67 行）switch 加 case：
```ts
    case 'walkRun':
      hudPanel.setRunFlag(worldView.toggleRun());
      break;
```

- [ ] **Step 3: Hud 按钮点击接 toggleRun**

`keyBinding.onKeyDown` 调用之后（约 67 行后）加：
```ts
hudPanel.onAction = (action) => {
  if (action === 'toggleRun') {
    hudPanel.setRunFlag(worldView.toggleRun());
  }
};
```

- [ ] **Step 4: 构建校验**

Run: `npm run build`
Expected: 无 TS 错误。

- [ ] **Step 5: 提交**

```bash
git add src/main.ts
git commit -m "feat(main): 接线R键与HUD按钮到走跑切换+出口占位"
```

---

## Self-Review 结果
- **Spec 覆盖**：§5.1 WorldView（Task 1 全项）、§5.2 Hud（Task 2 全项）、§5.3 main.ts（Task 3 全项）、§4.2 出口、§4.3 键位零改动（不触 KeyBinding）、§4.4 速度/动画（Task 1 Step 3/4）、§4.5 按钮图标（不换，Task 2 只接 tooltip+点击）。
- **占位符**：无 TBD/TODO；每个改动给出确切代码与行位。
- **类型一致性**：`toggleRun(): boolean`、`isRunning(): boolean`、`setRunFlag(run:boolean)`、`onAction?: (a:'toggleRun')=>void`、`onMoveModeChange?: (m:'run'|'walk')=>void` 跨 Task 一致。
