### Task 2: Hud 澧炲姞 setRunFlag 涓?onAction 鎸夐挳鐐瑰嚮

**Files:**
- Modify: `src/ui/Hud.ts`锛坕nterface銆乧reateHud 绛惧悕銆乭it-test銆乸ointerdown 澶勭悊锛?
**Interfaces:**
- Consumes: Task 1 鐨?`WorldView.toggleRun(): boolean` / `isRunning(): boolean`
- Produces:
  - `interface Hud { show; hide; dispose; setRunFlag(run: boolean): void; onAction?: (action: 'toggleRun') => void }`
  - `createHud(container: HTMLElement): Hud`

- [ ] **Step 1: 鎵╁睍 Hud interface**

鍦?`Hud` 鎺ュ彛锛?5-19 琛岋級杩藉姞锛?```ts
export interface Hud {
  show(state: HudState): void
  hide(): void
  dispose(): void
  /** 鍚屾璧?璺戠姸鎬佸埌 tooltip 灞曠ず */
  setRunFlag(run: boolean): void
  /** 鐢ㄦ埛鍔ㄤ綔鍥炶皟锛堣蛋璺戞寜閽瓑锛?*/
  onAction?: (action: 'toggleRun') => void
}
```
骞舵妸 108 琛?`const uiState = { runFlag: false, camFlag: 2, mapOnFlag: true };` 涓?`runFlag: false` 鏀逛负 `runFlag: true`锛堥粯璁よ窇锛屼笌 WorldView 涓€鑷达級銆?
- [ ] **Step 2: setRunFlag 鏇存柊灞曠ず鎬?*

鍦?`drawHoverFx` 闄勮繎鎴?`uiState` 瀹氫箟鍚庡姞锛?```ts
  function setRunFlag(run: boolean): void {
    uiState.runFlag = run;
  }
```

- [ ] **Step 3: 鎸夐挳鐐瑰嚮 hit-test**

`drawHoverFx` 宸叉湁 `hit` 鍑芥暟涓庢寚閽堝潗鏍囨崲绠楋紙139-147 琛岋級銆傚湪鍏跺悗锛坄drawHoverFx` 鍑芥暟缁撴潫鍚庯級鍔犵偣鍑诲垽瀹氬嚱鏁帮細
```ts
  // 璧拌窇鎸夐挳鐐瑰嚮锛氬唴瀹瑰潗鏍?(569,555,595,581) 鍐呭乏閿寜涓?鈫?涓婃姤鍔ㄤ綔锛堝鐢?pointerdown 璁板綍锛?  function checkButtonClick(): void {
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
鍦?`loop()` 閲?`draw()` 璋冪敤鍚庡姞 `checkButtonClick()`锛?```ts
  function loop() {
    draw();
    checkButtonClick();
    rafId = requestAnimationFrame(loop);
  }
```

- [ ] **Step 4: 鏆撮湶 setRunFlag/onAction 鍒拌繑鍥炲璞?*

鎵惧埌 `return {`锛圚ud 杩斿洖瀵硅薄锛屽惈 show/hide/dispose锛夛紝鍔狅細
```ts
    setRunFlag,
    onAction: undefined, // main.ts 璧嬪€?```

- [ ] **Step 5: 鏋勫缓鏍￠獙**

Run: `npm run build`
Expected: 鏃?TS 閿欒銆?
- [ ] **Step 6: 鎻愪氦**

```bash
git add src/ui/Hud.ts
git commit -m "feat(hud): 璧拌窇鎸夐挳鐐瑰嚮涓婃姤onAction + setRunFlag椹卞姩tooltip"
```

---

