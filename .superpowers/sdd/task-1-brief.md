### Task 1: WorldView 澧炲姞 running 鐪熸簮銆侀€熷害/鍔ㄧ敾鍒囨崲銆佸彲鏇挎崲鍑哄彛

**Files:**
- Modify: `src/ui/WorldView.ts`锛坈reateWorldView 绛惧悕銆乵oving 甯搁噺銆乽pdateMovement銆乺enderLoop 鍔ㄧ敾瑙﹀彂銆乄orldView 鎺ュ彛锛?
**Interfaces:**
- Produces:
  - `interface WorldViewOpts { onMoveModeChange?: (mode: 'run' | 'walk') => void }`
  - `createWorldView(container: HTMLElement, opts?: WorldViewOpts): WorldView`
  - `WorldView.toggleRun(): boolean`锛堢炕杞苟杩斿洖鏂板€硷級
  - `WorldView.isRunning(): boolean`
  - 鍐呴儴 `wasMoving`銆乣running` 琚?Task 2/3 寮曠敤銆?
- [ ] **Step 1: 淇敼 createWorldView 绛惧悕涓庢帴鍙?*

鍦?`WorldView` 鎺ュ彛锛?2 琛岄檮杩?`toggleMinimap(): void;`锛夊悗杩藉姞锛?```ts
  /** 璧?璺戞ā寮忥紙鐪熸簮锛夛紱杩斿洖鍒囨崲鍚庣殑鍊?*/
  toggleRun(): boolean;
  /** 褰撳墠鏄惁璺?*/
  isRunning(): boolean;
}
```
鏀?`createWorldView` 绛惧悕锛?0 琛岋級锛?```ts
export interface WorldViewOpts {
  onMoveModeChange?: (mode: 'run' | 'walk') => void; // 鍙浛鎹㈠嚭鍙ｏ紙鏈潵 C2S锛?}

export function createWorldView(container: HTMLElement, opts?: WorldViewOpts): WorldView {
```
鍦ㄥ嚱鏁颁綋椤堕儴锛坄let currentMapId = 0` 闄勮繎锛夊姞锛?```ts
  // ---- 璧?璺戞ā寮忥紙鐪熸簮锛涘垏鎹㈠姩浣滅粡 onMoveModeChange 鍑哄彛锛屾湭鏉ュ彲鏇挎崲涓?C2S锛?---
  let running = true; // 榛樿璺?```

- [ ] **Step 2: 鏇挎崲绉诲姩閫熷害甯搁噺**

鎶?101-102 琛岋細
```ts
  // 鈹€鈹€ 绉诲姩鐘舵€侊紙澶嶅埢 /pt/maps/ dummy 绉诲姩锛夆攢鈹€
  let moveSpeed = 3;         // 绉诲姩閫熷害锛坵orld 鍗曚綅/甯э級
```
鏀逛负锛堜繚鐣欐敞閲婇鏍硷級锛?```ts
  // 鈹€鈹€ 绉诲姩鐘舵€侊紙澶嶅埢 /pt/maps/ dummy 绉诲姩锛夆攢鈹€
  const WALK_STEP = 3;       // 璧帮紙world 鍗曚綅/甯э級
  const RUN_STEP = 7.5;      // 璺戯紙鈮堣蛋脳2.5锛屽榻愬師鐗?MoveAngle2 460/180锛?```

- [ ] **Step 3: updateMovement 鐢?running 閫夐€熷害**

鍦?`updateMovement` 鍐咃紙WorldView.ts:710 `const step = moveSpeed;`锛夋敼涓猴細
```ts
    // 6. 绉诲姩涓€姝ワ紙澶嶅埢 /pt/maps/ MoveAngle2锛夛紱閫熷害闅忚蛋/璺?    const step = running ? RUN_STEP : WALK_STEP;
```

- [ ] **Step 4: renderLoop 鍔ㄧ敾瑙﹀彂鎸?running**

鎶?931-937 琛岋細
```ts
        if (moved && !wasMoving) {
          animState.triggerRun();
          wasMoving = true;
        } else if (!moved && wasMoving) {
          animState.triggerIdle();
          wasMoving = false;
        }
```
鏀逛负锛?```ts
        if (moved && !wasMoving) {
          if (running) animState.triggerRun();
          else animState.triggerWalk();
          wasMoving = true;
        } else if (!moved && wasMoving) {
          animState.triggerIdle();
          wasMoving = false;
        }
```

- [ ] **Step 5: 鍔?setRunMode 鍐呴儴鍑芥暟 + toggleRun/isRunning**

鍦?`updateMovement` 瀹氫箟涔嬪墠锛堢害 676 琛屽墠锛夋彃鍏ワ細
```ts
  // 璧?璺戝垏鎹㈡牳蹇冿細缈昏浆鏈湴鐘舵€佸苟缁忓嚭鍙ｉ€氭姤锛涚Щ鍔ㄤ腑绔嬪嵆鍒囧搴斿姩鐢伙紙鍘熺増 character.cpp ChangeMoveMode锛?  function setRunMode(next: boolean): boolean {
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

- [ ] **Step 6: 鍦ㄨ繑鍥炲璞￠噷鏆撮湶 toggleRun/isRunning**

鎵惧埌 `return {`锛圵orldView 杩斿洖瀵硅薄锛屽惈 `setGameTime`銆乣toggleMinimap` 澶勶級锛屽姞锛?```ts
    toggleRun: () => setRunMode(!running),
    isRunning: () => running,
```

- [ ] **Step 7: 鏋勫缓鏍￠獙**

Run: `npm run build`
Expected: 鏃?TS 閿欒锛宍built in` 鎴愬姛銆?
- [ ] **Step 8: 鎻愪氦**

```bash
git add src/ui/WorldView.ts
git commit -m "feat(worldview): 璧拌窇鐪熸簮+閫熷害/鍔ㄧ敾鍒囨崲+onMoveModeChange鍑哄彛"
```

---

