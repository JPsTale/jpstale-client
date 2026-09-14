/**
 * 悬停物品信息的状态核对（`npm run verify-itemhover`）。
 *
 * 守四点（都是过去出过问题的地方）：
 *  ① 悬停状态在 **store** 里（不是某个面板组件的 useState）—— HUD 药水槽悬停也要能显示，
 *     面板关着也得显示（用户 2026-09-14 报"药水槽悬停没信息"，根因就是状态活在 ItemPanel 内部）；
 *  ② **同一处原地移动不重复提交**（鼠标一动就 commit → 面板/HUD 每帧重渲染）；
 *  ③ 存的是**位置**（来源）而不是 uid ⇒ **同一位置换了内容要解析到新那件**
 *     （用户 2026-09-14 报："换装后 hover 信息还停在换下去的那件上"）；
 *  ④ "悬停来源消失 → 悬停就该消失"（面板卸载 / HUD 隐藏时调用 clearHoverItem）；
 *  ⑤ 接线层：悬停不由**会消失/会被重建**的元素（背包物品按钮、HUD barrier）用边沿事件维护
 *     —— 改由**容器**随 `pointermove` 幂等刷新（用户 2026-09-14 报"交换后物品栏/药水槽不更新"）。
 *
 * 用法：npx tsx scripts/verify-itemhover.ts
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

// gameStore → item-sounds → sfx 在 import 时注册 DOM 监听；Node 里必须先装桩（唯一实现见 dom-stub）
installDomStub();
const g = await import('../src/app/gameStore.js');

let fail = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}：${JSON.stringify(got)}${ok ? '' : `（期望 ${JSON.stringify(want)}）`}`);
}

/** 造一件最小可用物品（itemlistId=1 在 itemDefs 里能查到，1×1 占格） */
const item = (uid: number, location = 10, slot = 0) => ({
  uid, itemlistId: 1, itemCode: 0, location, slot, count: 1,
  durability: 0, durabilityMax: 0, damageMin: 0, damageMax: 0, attackRating: 0,
  defence: 0, blockRating: 0, absorb: 0, speed: 0, resBionic: 0, resFire: 0, resIce: 0,
  resLightning: 0, resPoison: 0, resEarth: 0, resWater: 0, resWind: 0,
  increaseLife: 0, increaseMana: 0, increaseStamina: 0,
  reqLevel: 0, reqStrength: 0, reqSpirit: 0, reqTalent: 0, reqAgility: 0, reqHealth: 0,
  price: 0, jobCodeMask: 0, agingLevel: 0, critical: 0, range: 0, attackSpeed: 0,
  manaRegen: 0, lifeRegen: 0, staminaRegen: 0,
}) as never;

let commits = 0;
const unsub = g.subscribeGame(() => { commits++; });

console.log('① 悬停状态在 store 里（HUD 也能设、面板关着也显示）');
g.setHoverSpot({ kind: 'equip', slot: 1 }, 100, 200);
check('setHoverSpot 落到快照', g.getGameSnapshot().hoverSpot,
  { src: { kind: 'equip', slot: 1 }, x: 100, y: 200 });
check('通知了一次订阅者', commits, 1);

console.log('\n② 同一处原地移动不重复提交');
g.setHoverSpot({ kind: 'equip', slot: 1 }, 100, 200);
check('完全相同 → 不提交', commits, 1);
g.setHoverSpot({ kind: 'equip', slot: 1 }, 101, 200);
check('坐标变了 → 提交', commits, 2);
g.setHoverSpot({ kind: 'equip', slot: 2 }, 101, 200);
check('来源变了 → 提交', commits, 3);
g.clearHoverItem();
check('clear → null', g.getGameSnapshot().hoverSpot, null);
g.clearHoverItem();
check('重复 clear → 不提交', commits, 4);

console.log('\n③ 存位置不存 uid：**同一位置换了内容要解析到新那件**（用户 2026-09-14 报）');
g.setInventory({ items: [item(7, 0, 1)], gold: 0 } as never);      // 装备槽 1 里是 7
g.setHoverSpot({ kind: 'equip', slot: 1 }, 10, 10);
check('槽 1 里是 7 → 解析到 7', g.hoveredItemOf()?.uid, 7);
// 换装：槽 1 换成 8，7 被换到鼠标位（slot = -1）→ 同一悬停位置必须解析到 8，不能仍停在 7
g.setInventory({ items: [item(8, 0, 1), item(7, 0, -1)], gold: 0 } as never);
check('换装后解析到新件 8（不是仍停在 7）', g.hoveredItemOf()?.uid, 8);
g.setInventory({ items: [], gold: 0 } as never);
check('位置上空了 → null（不留"幽灵信息框"）', g.hoveredItemOf(), null);
check('悬停状态本身仍在（只是解析不到）', g.getGameSnapshot().hoverSpot?.src.kind, 'equip');
// 背包格：按足迹覆盖判定（itemlistId=1 是 1×1，锚格即命中格）
g.setInventory({ items: [item(9, 10, 5 * 12 + 3)], gold: 0 } as never);
g.setHoverSpot({ kind: 'bag', cell: 5 * 12 + 3 }, 0, 0);
check('背包格按足迹覆盖解析', g.hoveredItemOf()?.uid, 9);
g.setHoverSpot({ kind: 'bag', cell: 5 * 12 + 4 }, 0, 0);
check('相邻格不误命中', g.hoveredItemOf(), null);

console.log('\n③b 背包**交换**后：同一格换了内容也要跟着换（用户 2026-09-14 报"物品栏不更新"）');
const bagCell = 2 * 12 + 3;
g.setInventory({ items: [item(11, 10, bagCell), item(12, 10, bagCell + 1)], gold: 0 } as never);
g.setHoverSpot({ kind: 'bag', cell: bagCell }, 0, 0);
check('交换前该格是 11', g.hoveredItemOf()?.uid, 11);
g.setInventory({ items: [item(12, 10, bagCell), item(11, 10, bagCell + 1)], gold: 0 } as never);  // 两件互换锚格
check('交换后同一格解析到 12', g.hoveredItemOf()?.uid, 12);

console.log('\n③c 药水槽：**喝/放入**导致内容变化后，同一槽也要跟着变');
g.setInventory({ items: [{ ...(item(21, 0, 11) as object), count: 5 }], gold: 0 } as never);
g.setHoverSpot({ kind: 'potion', idx: 0 }, 0, 0);
check('槽 1（ITEMSLOT 11）解析到那瓶', g.hoveredItemOf()?.uid, 21);
check('数量是当前值 5', (g.hoveredItemOf() as { count?: number } | null)?.count, 5);
g.setInventory({ items: [{ ...(item(21, 0, 11) as object), count: 4 }], gold: 0 } as never);
check('喝掉一瓶后同一槽解析到 4', (g.hoveredItemOf() as { count?: number } | null)?.count, 4);
g.setInventory({ items: [], gold: 0 } as never);
check('喝空后同一槽 → null（信息框收起）', g.hoveredItemOf(), null);

console.log('\n④ "悬停来源消失 → 悬停就该消失"（面板卸载 / HUD 隐藏都调 clearHoverItem）');
g.setHoverSpot({ kind: 'potion', idx: 0 }, 5, 5);
check('先有悬停', g.getGameSnapshot().hoverSpot?.src.kind, 'potion');
g.clearHoverItem();
check('清掉后判据为 null（信息框不再挂在屏幕上）', g.hoveredItemOf(), null);
check('悬停本身也没了', g.getGameSnapshot().hoverSpot, null);

/**
 * ⑤ 接线层的两条纪律（store 级测不出来，但**已经犯过两次**）：
 *
 * 缺陷类：用**边沿事件**（进/出）维护"指针下面是什么"，而承载它的元素会**消失或被重建** ——
 *   ① 背包物品按钮是 `key=uid` 的，交换会把它**移除** ⇒ `pointerleave` 清掉悬停，
 *      而新按钮出现在**静止的指针**下不会再补发 `enter` ⇒ 信息框空到鼠标动为止；
 *   ② HUD 药水槽 barrier 会随面板开关**重建** ⇒ 同样等不到第二次 `mouseenter`；
 *   ③ 拿起/放下时顺手 `onHoverEnd()`（"拿着时不显示信息"的遗留）—— 装备槽那次改掉了，背包漏了。
 * 纪律：**悬停源只由"指针在哪一格 / 哪个槽"决定**，在**稳定的容器**上随 `pointermove` 幂等刷新；
 * 只在指针真的离开容器时清。
 */
const itemPanelSrc = readFileSync(new URL('../src/ui/react/ItemPanel.tsx', import.meta.url), 'utf8');
const hudSrc = readFileSync(new URL('../src/ui/Hud.ts', import.meta.url), 'utf8');

console.log('\n⑤ 接线层：悬停不由会消失的元素（物品按钮 / 会被重建的 barrier）维护');
check('物品按钮上不再挂 onPointerLeave={onHoverEnd}', /\bonPointerLeave=\{onHoverEnd\}/.test(itemPanelSrc), false);
check('物品按钮上不再自设 bag 悬停（改由容器统一）', /onPointerEnter=\{\(e\) => \{ e\.stopPropagation\(\); onHover\(\{ kind: 'bag'/.test(itemPanelSrc), false);
check('拿起/放下不再清悬停（放下后那格的现查会跟着换）', /onHoverEnd\(\);\s*on(PutSlot|Pick)\(/.test(itemPanelSrc), false);
check('背包容器指针进入即登记悬停', /onPointerEnter=\{\(e\) => \{ syncHover\(cellFromEvent\(e\), e\); \}\}/.test(itemPanelSrc), true);
check('背包容器 pointermove 同时刷新落点与悬停', /onPointerMove=\{\(e\) => \{ updatePreview\([^)]*\); syncHover\(cellFromEvent\(e\), e\); \}\}/.test(itemPanelSrc), true);
check('背包容器指针离开才清悬停', /onPointerLeave=\{\(\) => \{[^}]*onHoverEnd\(\)/.test(itemPanelSrc), true);
check('药水槽 barrier 同时挂 mouseenter 与 mousemove（重建后能补回来）',
  /addEventListener\('mouseenter', sync\)/.test(hudSrc) && /addEventListener\('mousemove', sync\)/.test(hudSrc), true);

unsub();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项不符`);
process.exit(fail === 0 ? 0 : 1);
