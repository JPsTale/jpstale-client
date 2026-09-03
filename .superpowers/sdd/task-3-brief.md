### Task 3: main.ts 鎺ョ嚎锛圧 閿?+ 鎸夐挳 + 鍑哄彛锛?
**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: Task 1 `createWorldView(container, opts)`銆乣worldView.toggleRun()`锛汿ask 2 `hudPanel.setRunFlag`銆乣hudPanel.onAction`銆?- Produces: 瀹屾暣鍔熻兘銆?
- [ ] **Step 1: createWorldView 浼犲嚭鍙?*

29 琛?`const worldView = createWorldView(app);` 鏀逛负锛?```ts
const worldView = createWorldView(app, {
  onMoveModeChange: (mode) => console.log('[mmode]', mode), // P1 鍗犱綅鍑哄彛锛涙湭鏉ユ帴 C2S 鏃舵浛鎹?});
```

- [ ] **Step 2: R 閿紙walkRun锛夋帴 toggleRun**

`keyBinding.onKeyDown((action) => {...})`锛?8-67 琛岋級switch 鍔?case锛?```ts
    case 'walkRun':
      hudPanel.setRunFlag(worldView.toggleRun());
      break;
```

- [ ] **Step 3: Hud 鎸夐挳鐐瑰嚮鎺?toggleRun**

`keyBinding.onKeyDown` 璋冪敤涔嬪悗锛堢害 67 琛屽悗锛夊姞锛?```ts
hudPanel.onAction = (action) => {
  if (action === 'toggleRun') {
    hudPanel.setRunFlag(worldView.toggleRun());
  }
};
```

- [ ] **Step 4: 鏋勫缓鏍￠獙**

Run: `npm run build`
Expected: 鏃?TS 閿欒銆?
- [ ] **Step 5: 鎻愪氦**

```bash
git add src/main.ts
git commit -m "feat(main): 鎺ョ嚎R閿笌HUD鎸夐挳鍒拌蛋璺戝垏鎹?鍑哄彛鍗犱綅"
```

---

## Self-Review 缁撴灉
- **Spec 瑕嗙洊**锛毬?.1 WorldView锛圱ask 1 鍏ㄩ」锛夈€伮?.2 Hud锛圱ask 2 鍏ㄩ」锛夈€伮?.3 main.ts锛圱ask 3 鍏ㄩ」锛夈€伮?.2 鍑哄彛銆伮?.3 閿綅闆舵敼鍔紙涓嶈Е KeyBinding锛夈€伮?.4 閫熷害/鍔ㄧ敾锛圱ask 1 Step 3/4锛夈€伮?.5 鎸夐挳鍥炬爣锛堜笉鎹紝Task 2 鍙帴 tooltip+鐐瑰嚮锛夈€?- **鍗犱綅绗?*锛氭棤 TBD/TODO锛涙瘡涓敼鍔ㄧ粰鍑虹‘鍒囦唬鐮佷笌琛屼綅銆?- **绫诲瀷涓€鑷存€?*锛歚toggleRun(): boolean`銆乣isRunning(): boolean`銆乣setRunFlag(run:boolean)`銆乣onAction?: (a:'toggleRun')=>void`銆乣onMoveModeChange?: (m:'run'|'walk')=>void` 璺?Task 涓€鑷淬€?
