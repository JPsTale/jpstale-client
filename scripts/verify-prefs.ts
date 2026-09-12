/**
 * 客户端偏好持久化核对（相机 / 界面）。
 *
 * 守住两条：
 *   ① **坏数据一律回默认**（`pt.camera` 里一个 NaN 就能把相机推到无穷远）；
 *   ② **存进去再读出来必须一致**（否则"我明明设过，怎么又变回去了"）。
 *
 * 用法：npx tsx scripts/verify-prefs.ts
 */
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

const { loadCameraPrefs, saveCameraPrefs, CAM_DIST_DEFAULT, CAM_ANX_DEFAULT } = await import('../src/ui/camera-prefs.js');
const { loadUiPrefs, saveUiPrefs, UI_PREFS_DEFAULT } = await import('../src/ui/ui-prefs.js');

let fail = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}：${JSON.stringify(got)}${ok ? '' : `（期望 ${JSON.stringify(want)}）`}`);
}

console.log('① 空存储 → 默认值');
store.clear();
check('相机', loadCameraPrefs(), { dist: CAM_DIST_DEFAULT, anx: CAM_ANX_DEFAULT, any: 0, mode: 1, autoRecenter: true });
check('界面', loadUiPrefs(), UI_PREFS_DEFAULT);

console.log('\n② 存进去再读出来一致');
const cam = { dist: 512, anx: 0.7, any: 1.25, mode: 2, autoRecenter: false };
saveCameraPrefs(cam);
check('相机往返', loadCameraPrefs(), cam);
const ui = { running: false, minimapOpen: false };
saveUiPrefs(ui);
check('界面往返', loadUiPrefs(), ui);

console.log('\n③ 坏数据 → 回默认 / 被夹到范围内');
store.set('pt.camera', '{"dist":"far","anx":null,"any":"x","mode":99,"autoRecenter":"yes"}');
const bad = loadCameraPrefs();
check('dist 非数字 → 默认', bad.dist, CAM_DIST_DEFAULT);
check('anx 非数字 → 默认', bad.anx, CAM_ANX_DEFAULT);
check('any 非数字 → 默认', bad.any, 0);
check('mode 越界 → 夹到 2', bad.mode, 2);
check('autoRecenter 非布尔 → 默认 true', bad.autoRecenter, true);

store.set('pt.camera', '{ 这不是 JSON');
check('解析失败 → 全默认', loadCameraPrefs().dist, CAM_DIST_DEFAULT);
store.set('pt.ui', '[1,2,3]');
check('界面坏数据 → 默认', loadUiPrefs(), UI_PREFS_DEFAULT);

console.log('\n④ 老数据（没有后加的两个字段）→ 补默认，不报错');
store.set('pt.camera', '{"dist":300,"anx":0.5,"any":0.1}');
check('mode 补默认', loadCameraPrefs().mode, 1);
check('autoRecenter 补默认', loadCameraPrefs().autoRecenter, true);

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项不符`);
process.exit(fail === 0 ? 0 : 1);
