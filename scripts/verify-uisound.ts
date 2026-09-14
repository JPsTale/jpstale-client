/**
 * 音效分工核对（`npm run verify-uisound`）。
 *
 * 用户 2026-09-14 报："点击音效太难听了 —— 它实际上是一个失败提示音（比如把武器放进不能装备的槽位时的提示）。
 * 正常情况下拾取/点击/放下/交换道具都该播道具对应的音效，只有失败才播当前这个音。"
 * 根因：我把 `menu/button01.wav` 当成通用点击音（当初"按文件名语义选曲"的猜法），
 * 又有一条"`.jp-overlay` 内任何按钮被点都播它"的全局监听 ⇒ 道具操作与失败同声、还和道具音叠在一起。
 *
 * 原版权威依据（两份**同项目**源码互相印证）：
 *   · `sinSubMain.cpp` 的 `sinSoundWav[]`：[0]=interface-on.wav、[21]=interface.wav，**全套 `menu/*` 一处引用都没有**；
 *   · `sinItem.h` 的 `SIN_SOUND_*`：1..25 全是**道具**音（见 item-sounds.ts）。
 * 故纪律：道具操作 → 道具自带 SoundIndex；失败 → `denied`；界面按钮 → 原版 `[0]`。
 *
 * 用法：npx tsx scripts/verify-uisound.ts
 */
import { readFileSync } from 'node:fs';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

let fail = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}：${JSON.stringify(got)}${ok ? '' : `（期望 ${JSON.stringify(want)}）`}`);
}

// 最小 DOM 桩：`sfx.ts` 在 **import 时**就注册 document/window 监听（解锁音频、全局点击音），
// 不桩掉的话在 node 里根本 import 不进来 —— 那样只能退化成"读源码字符串"，验不到真表。
const noopTarget = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true };
(globalThis as unknown as Record<string, unknown>).document = {
  ...noopTarget, documentElement: { style: {} }, body: { appendChild: () => {}, style: {} },
  createElement: () => ({ style: {}, classList: { add: () => {} }, appendChild: () => {} }),
  querySelector: () => null,
};
(globalThis as unknown as Record<string, unknown>).window = {
  ...noopTarget, innerWidth: 1280, innerHeight: 720,
};

const sfxMod = await import('../src/audio/sfx.js');
const { ITEM_SOUND_FILES } = await import('../src/audio/item-sounds.js');

const sfxSrc = readFileSync(new URL('../src/audio/sfx.ts', import.meta.url), 'utf8');
const panelSrc = readFileSync(new URL('../src/ui/react/ItemPanel.tsx', import.meta.url), 'utf8');
const hudSrc = readFileSync(new URL('../src/ui/Hud.ts', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

console.log('\n① 界面音按原版 sinSoundWav[] 选文件（不再用猜的 menu/button01 当点击音）');
check('click = 原版 [0] interface-on.wav', sfxMod.sfxBank.uiFile('click').endsWith('items/interface-on.wav'), true);
check('denied = menu/button01.wav（只给失败用）', sfxMod.sfxBank.uiFile('denied').endsWith('menu/button01.wav'), true);
check('open = 原版 [21] interface.wav 不用作"展开"猜测', sfxMod.sfxBank.uiFile('open').includes('menu/turning01'), true);

console.log('\n② 道具音表与原版 sinSoundWav[] 逐项一致（9 甲 / 24 另一套甲=女版）');
check('9 → armor.wav', ITEM_SOUND_FILES[9], 'armor.wav');
check('24 → armor-w.wav（原版 [24]=Armor-w.wav，曾误取男版 armor-m）', ITEM_SOUND_FILES[24], 'armor-w.wav');
check('17 → potion.wav', ITEM_SOUND_FILES[17], 'potion.wav');
check('21 → interface.wav', ITEM_SOUND_FILES[21], 'interface.wav');
check('0 不在道具表里（0 是 UI 的 interface-on，不是"无声道具"的音）', ITEM_SOUND_FILES[0], undefined);

console.log('\n③ 道具不是界面按钮：全局点击音必须排除道具元素');
check('排除 .jp-bag-item / .jp-items-equip',
  /if \(t\.closest\('\.jp-bag-item, \.jp-items-equip'\)\) return;/.test(sfxSrc), true);

console.log('\n④ 药水槽（画布 HUD 的道具）不再播界面音 —— 交给动作处理器播道具音');
check('药水槽分支里没有 playUi', /POTION_RECTS\[i\]!\) \{[\s\S]{0,600}?playUi/.test(hudSrc), false);
check('拿起药水播的是**该物品自己的** sound（不是硬编码 17）',
  /playItemSound\(itemDefById\(it\.itemlistId\)\?\.sound\)/.test(mainSrc), true);

console.log('\n⑤ 失败音挂在"服务端拒绝"的唯一入口上（一处覆盖拿起/放下/交换/拾取的失败）');
check('item.op.* 分支里播 denied',
  /e\.key\.startsWith\('item\.op\.'\)\) \{[\s\S]{0,400}?sfx\.playUi\('denied'\)/.test(mainSrc), true);

console.log('\n⑥ 客户端本地拒绝也播失败音（这些不发请求，服务端那次拒绝覆盖不到）');
const localDenied = (panelSrc.match(/playUi\('denied'\)/g) ?? []).length;
check('ItemPanel 至少 6 处本地拒绝播 denied', localDenied >= 6, true);
check('全局监听器里 playUi 只出现在"排除道具之后"（顺序即语义）',
  sfxSrc.indexOf("closest('.jp-bag-item, .jp-items-equip')") < sfxSrc.indexOf('start(UI_SOUNDS.click'),
  true);

console.log('\n⑦ 路径不许带 `/res/` 前缀（sfx.play 内部自己拼；带两次 ⇒ 404 ⇒ 无声，已犯过两次）');
check('item-sounds 的 DIR 是相对路径',
  /const DIR = 'wav\/effects\/items\/'/.test(readFileSync(new URL('../src/audio/item-sounds.ts', import.meta.url), 'utf8')), true);
const worldSrc = readFileSync(new URL('../src/ui/WorldView.ts', import.meta.url), 'utf8');
check('WorldView 里没有写死的 /res/wav 播放', /sfx\.play\('\/res\//.test(worldSrc), false);
check('全仓没有 `sfx.play("/res/...")` 形式', /sfx\.play\(\s*['"]\/?res\//.test(sfxSrc + panelSrc + hudSrc + mainSrc + worldSrc), false);
check('play() 里对 /res 前缀有诊断（只报不改，不掩盖错误）',
  /path\.startsWith\('\/res\/'\)[\s\S]{0,200}?console\.warn/.test(sfxSrc), true);

console.log('\n⑧ 表里每个文件都真的存在，且失败路径不是静默的（用户要求"加 log"）');
check('playItemSound 没文件时 warn（不静默 return）',
  /ITEM_SOUND_FILES\[soundIndex\][\s\S]{0,300}?console\.warn/.test(readFileSync(new URL('../src/audio/item-sounds.ts', import.meta.url), 'utf8')), true);
check('loadBuffer 取不到音频时 warn（过去是 `if (!resp.ok) return null;`）',
  /!resp\.ok\)[\s\S]{0,200}?console\.warn\('\[sfx\] 取音频失败/.test(sfxSrc), true);
{
  const envRoot = (() => {
    try {
      const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
      const m = /VITE_ASSET_ROOT\s*=\s*(.+)/.exec(env);
      return m ? m[1].trim() : null;
    } catch { return null; }
  })();
  const root = process.env.VITE_ASSET_ROOT ?? envRoot ?? 'E:/JPsTale/client';
  const { existsSync } = await import('node:fs');
  if (!existsSync(root)) {
    console.log(`  （跳过）资产目录不存在：${root} —— 在 Ubuntu 上请设 VITE_ASSET_ROOT`);
  } else {
    const missing: string[] = [];
    for (const [idx, f] of Object.entries(ITEM_SOUND_FILES)) {
      if (!existsSync(`${root}/wav/effects/items/${f}`)) missing.push(`${idx}:${f}`);
    }
    check('ITEM_SOUND_FILES 全部文件在资产里存在' + `（${Object.keys(ITEM_SOUND_FILES).length} 个）`, missing, []);
  }
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项不符`);
process.exit(fail === 0 ? 0 : 1);
