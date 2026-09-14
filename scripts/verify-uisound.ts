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
import { installDomStub } from './dom-stub.js';

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

installDomStub();

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
// "放进容器"的判定**只有一处**（用户 2026-09-14："无论是鼠标操作、拾取操作（服务器发来消息），
// 都应该执行相同的逻辑"）：放在 store 的 commit 层，各 UI 路径不再自己播（否则就是两份判定，
// 迟早漂移成"鼠标放下有声音、拾取进背包没有"）。
const storeSrc = readFileSync(new URL('../src/app/gameStore.ts', import.meta.url), 'utf8');
check('store 里有唯一的"放进容器"判定 notifyPlacedItems',
  /function notifyPlacedItems\(/.test(storeSrc) && /notifyPlacedItems\(beforeItems/.test(storeSrc), true);
check('ItemPanel 不再自己播道具音（全部由 store 统一）', /playItemSound\(/.test(panelSrc), false);
check('main.ts 不再自己播道具音（拿起/放入都走 store）', /playItemSound\(/.test(mainSrc), false);
check('整包快照走静默（进图不该逐件出声）', /silently\(\(\) => commit\(\{ inventory: inv \}\)\)/.test(storeSrc), true);
check('回滚走静默（事情没发生，不该出声）', /silently\(\(\) => commit\(\{ inventory: \{ \.\.\.cur, items \} \}\)\)/.test(storeSrc), true);

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

console.log('\n⑨ "放进容器"是**事件**，判定只有一处（store 的 commit 层）—— 行为验证，不是读源码');
{
  const g = await import('../src/app/gameStore.js');
  const played: string[] = [];
  sfxMod.sfx.play = (p: string) => { played.push(p); };   // 劫持播放，只观察"请求了哪个文件"
  const last = () => played[played.length - 1];
  const reset = () => { played.length = 0; };
  const item = (uid: number, itemlistId: number, location: number, slot: number, count = 1) => ({
    uid, itemlistId, itemCode: 0, location, slot, count,
  });

  // ① 服务端推送：拾取进背包（原来**完全没声音**——用户 2026-09-14 报的就是它）
  reset();
  g.setInventory({ items: [], gold: 0 } as never);          // 快照：整包替换，必须静默
  const afterSnapshot = played.length;
  g.upsertInventoryItem(item(7, 1, 10, 5) as never);         // listId=1 Stone Axe → SoundIndex 1
  check('快照（整包替换）不出声', afterSnapshot, 0);
  check('拾取进背包 → 播物品自带音', last(), 'wav/effects/items/axes.wav');

  // ② **变多 = 放进**（用户 2026-09-14：捡药水合并进药水槽要有声音）；**变少 = 不是放进**（喝药）
  reset();
  g.upsertInventoryItem(item(7, 1, 10, 5, 3) as never);
  check('数量变多 → 出声（合并 = 放进）', played.length, 1);
  reset();
  g.upsertInventoryItem(item(7, 1, 10, 5, 2) as never);
  check('数量变少（喝药/消耗）→ 不出声', played.length, 0);

  // ②b **服务端推送的合并**（用户 2026-09-14 实测："捡起药水合并到药水槽没有音效"）：
  //     这条路径客户端表里**没有"消失的源"**（源是地面物），所以必须靠"某堆变多"来判 —— 正是 ② 那条规则。
  reset();
  g.setInventory({ items: [item(21, 423, 0, 11, 2)] } as never);    // 药水槽里已有 2 瓶
  reset();
  g.upsertInventoryItem(item(21, 423, 0, 11, 3) as never);          // 服务端推"变成 3 瓶"
  check('★ 捡药水合并进药水槽（服务端推送）→ 出声', last(), 'wav/effects/items/potion.wav');

  // ③ 服务端推送：进药水槽（自动灌槽），同样要出声
  reset();
  g.upsertInventoryItem(item(9, 423, 0, 11) as never);       // listId=423 Mini Mana Potion → 17
  check('进药水槽 → 播药水音', last(), 'wav/effects/items/potion.wav');

  // ④ 鼠标操作（本地乐观）走同一条判定：立即出声，不等服务端
  reset();
  g.localBagMove(9, 30, 10);                                 // 药水槽 → 背包格 30
  check('鼠标操作（本地）立即出声', last(), 'wav/effects/items/potion.wav');

  // ⑤ 合并（手上那件并进同类堆，从表里消失）→ 也是"放进"，出声
  reset();
  g.setInventory({ items: [item(20, 423, 0, -1), item(21, 423, 10, 40, 1)] } as never);
  g.localStackMerge(20, 21);
  check('合并进已有堆 → 出声（原版 LastSetInvenItem 同样播）', last(), 'wav/effects/items/potion.wav');

  // ⑤b 丢到地面（手上那件消失，但没人变多）→ **不**算放进，不出声（丢弃音另有入口）
  reset();
  g.setInventory({ items: [item(30, 423, 0, -1)] } as never);
  g.throwItem(30);
  check('丢到地面：只播丢弃音，不被误判成"放进"（原来会再播一次物品音）',
    played, ['wav/effects/items/item drop.wav']);

  // ⑤c **按 W 换武器**：服务端把主/备装备槽的行都推一遍 → 只有**真的换位**的那两件出声
  // （用户 2026-09-14："按W交换武器……也应该触发音效"。客户端 W 键没有本地捷径，
  //  只 `sendSwitchWeapon()` → 靠服务端 ItemUpdate 回来 → 走的正是同一个判定）
  reset();
  g.setInventory({ items: [
    item(40, 1, 0, 1),          // 主手：斧（SoundIndex 1）
    item(41, 301, 0, 8),        // 装备槽 8 上一件护腕（SoundIndex 14）—— 这次**不动**
    item(42, 1, 20, 1),         // 备用手：另一把斧
  ] } as never);
  reset();
  g.upsertInventoryItem(item(40, 1, 20, 1) as never);   // 主手那把 → 备用槽（换出去了）
  g.upsertInventoryItem(item(42, 1, 0, 1) as never);    // 备用那把 → 主手
  g.upsertInventoryItem(item(41, 301, 0, 8) as never);  // 这次没动 → 不应出声
  check('W 换武器：换位的两件都出声', played.length, 2);
  check('W 换武器：没换位的那件不出声', played.every((f) => f.endsWith('axes.wav')), true);

  // ⑤d **未来容器**（仓库 location=30；邮箱等同理）不需要任何新音效代码 ——
  // 规则只看 (location, slot)，与容器无关（用户 2026-09-14："未来要做的仓库、邮箱……都应该统一执行相同逻辑"）
  const { LOC } = await import('../src/game/itemLocations.js');
  reset();
  g.setInventory({ items: [item(50, 423, LOC.BAG, 60)] } as never);
  reset();
  g.localBagMove(50, 3, LOC.WAREHOUSE);                  // 背包 → 仓库
  check('PUT_ITEM 进仓库（location=30）同样出声', last(), 'wav/effects/items/potion.wav');

  // ⑤e THROW_ITEM：丢出容器 → 丢弃音；而服务端说"没了"（consume，默认）→ 安静
  reset();
  g.setInventory({ items: [item(60, 423, LOC.BAG, 5)] } as never);
  reset();
  g.throwItem(60);
  check('THROW_ITEM（玩家动作 throwItem）播丢弃音', last(), 'wav/effects/items/item drop.wav');
  reset();
  g.setInventory({ items: [item(61, 423, LOC.BAG, 6)] } as never);
  reset();
  g.applyItemRemoved(61);                                // 服务端通知（喝掉最后一瓶/扫地/GM）→ 静默
  check('服务端通知 applyItemRemoved 不出声（两个操作码分开）', played.length, 0);

  // ⑥ 回滚 = 事情没发生，不该出声（失败音另有入口）
  reset();
  g.setInventory({ items: [item(9, 423, 0, -1)] } as never);   // 手上拿着那瓶
  g.beginOptimistic([item(9, 423, 0, -1) as never] as never);
  g.localBagMove(9, 31, 10);
  check('（回滚前那次本地移动出过声）', played.length > 0, true);
  reset();
  g.rollbackOptimistic();
  check('回滚不出声', played.length, 0);
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项不符`);
process.exit(fail === 0 ? 0 : 1);
