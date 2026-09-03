# Task 1 报告：WorldView 走跑真源 + 速度/动画切换 + onMoveModeChange 出口

## 文件
- 只修改了 `src/ui/WorldView.ts`（1 file changed, 32 insertions(+), 5 deletions(-)）

## 步骤执行明细

### Step 1: 修改 createWorldView 签名与接口
- `WorldView` 接口 (原 line 42 后)：`toggleMinimap(): void;` 后追加
  ```ts
  /** 走/跑模式（真源）；返回切换后的值 */
  toggleRun(): boolean;
  /** 当前是否跑 */
  isRunning(): boolean;
  ```
- `createWorldView` 签名（原 line 50）：在其前新增 `WorldViewOpts` 接口，签名改为
  ```ts
  export interface WorldViewOpts {
    onMoveModeChange?: (mode: 'run' | 'walk') => void; // 可替换出口（未来 C2S）
  }
  export function createWorldView(container: HTMLElement, opts?: WorldViewOpts): WorldView {
  ```
- 函数体顶部（`let currentMapId = 0` 附近，原 line 67 后）：新增
  ```ts
  // ---- 走/跑模式（真源；切换动作经 onMoveModeChange 出口，未来可替换为 C2S）---
  let running = true; // 默认跑
  ```

### Step 2: 替换移动速度常量
- 原 line 101-102：
  ```ts
  let moveSpeed = 3;         // 移动速度（world 单位/帧）
  ```
  改为：
  ```ts
  const WALK_STEP = 3;       // 走（world 单位/帧）
  const RUN_STEP = 7.5;      // 跑（≈走×2.5，对齐原版 MoveAngle2 460/180）
  ```
  删除了 `moveSpeed`，新增两个常量；保留了 `wasMoving` 等其余移动状态。

### Step 3: updateMovement 用 running 选速度
- 原 line 710 `const step = moveSpeed;` 改为：
  ```ts
  // 6. 移动一步（复刻 /pt/maps/ MoveAngle2）；速度随走/跑
  const step = running ? RUN_STEP : WALK_STEP;
  ```

### Step 4: renderLoop 动画触发按 running
- 原 line 931-937 的移动态机切换改为：
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

### Step 5: 加 setRunMode 内部函数
- 在 `updateMovement` 定义之前（原 line 687 前）插入：
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

### Step 6: 返回对象暴露 toggleRun/isRunning
- 在 `return {` 对象的 `toggleMinimap,` 后追加：
  ```ts
  toggleRun: () => setRunMode(!running),
  isRunning: () => running,
  ```

### Step 7: 构建校验
- `npm run build` 通过，**无 TS 错误**，`tsc --noEmit && vite build` 均成功，`✓ built in 448ms`。

### Step 8: 提交
- 提交信息：`feat(worldview): 走跑真源+速度/动画切换+onMoveModeChange出口`
- 提交哈希：`494a92920a643d286632842edde5f798ce404794`

## 产物接口（供 Task 2/3 使用）
- `interface WorldViewOpts { onMoveModeChange?: (mode: 'run' | 'walk') => void }`
- `createWorldView(container: HTMLElement, opts?: WorldViewOpts): WorldView`
- `WorldView.toggleRun(): boolean`
- `WorldView.isRunning(): boolean`
- 内部 `running: boolean`（默认 true）与 `wasMoving` 保留待后续任务引用
