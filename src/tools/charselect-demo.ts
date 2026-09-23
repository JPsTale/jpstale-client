/**
 * 选角界面调试页 —— `npm run dev` 后开 `http://localhost:5173/charselect-demo.html`。
 *
 * 为什么需要它：选角界面（角色卡 + 3D 预览）要**登录 + 连服务器 + 账号上正好有**
 * "带盾 + 武器锻造过"的角色，才能看到这两样东西（用户 2026-09-23 报的正是这个界面缺盾、缺发光）。
 * 每次调一点都要走一遍登录，根本没法验。
 *
 * ★ 它**复用真实的 `createCharSelect`**（连 3D 预览、挂载、发光都是游戏那一份实现），
 *   只是喂一份**假角色列表** —— 所以这里看到的盾/发光就是游戏里会看到的（AGENTS #15）。
 *
 * 两份假外观的对照：
 *   ① "锻造 +12 的长剑 + 合成的盾" —— 主手 RGB(10,220,30) + mixS_05 叠加、副手走合成行 0（mixM_05）
 *   ② "未锻造的镰刀" —— 两件都不发光（对照）
 */
import { createCharSelect } from '../ui/CharSelect.js';
import { fallbackSummary } from '../char/fallback-log.js';
import type { CharacterAppearance, CharacterInfo } from '../ui/CharSelect.js';

const stage = document.getElementById('stage')!;
const panel = createCharSelect(stage);
const noop = (): void => {};

/**
 * 一号：**锻造 +12 的长剑**（`ItemKindCode=2` = 锻造物）+ **合成的盾**
 * （`ItemKindCode=1` = 合成物，`ItemAgingNum[0]=0` ⇒ 色表行 0）——
 * 这两列正是服务端 `S2C_AppearanceUpdate` 随外观下发的字段（`jpstale-server 55cc80e`）。
 */
const forged: CharacterAppearance = {
  classId: 1, head: 0, rank: 0, bodyModelIdcode: 0,
  weaponDorp: 'WA101', weaponIdcode: 0x01010100, weaponPos: 4,
  offHandDorp: 'ds101', offHandIdcode: 33816832, offHandKind: 1, offHandPos: 2,
  sizeLevel: 0,
  weaponKindCode: 2, weaponAgingLevel: 12,    // +12 ⇒ 表行 8：RGB(10,220,30) + mixS_05 / SCROLL8
  offHandKindCode: 1, offHandAgingLevel: 0,   // 合成 ⇒ 表行 0：RGB(13,0,5) + mixM_05 / SCROLL4
};

/**
 * 三号：**第 11 职业·格斗家**（骨架 `m8.smb`）+ 拳套 WV101。
 *
 * m8 是**唯一**没有通用 `Bip weapon01` 的骨架（m1..m7 都有；实测逐文件 grep）。格斗家是徒手职业
 * —— 拳套戴在手上 ⇒ 她的手部挂点显式登记为 **`Bip01 R Hand`**（见 weapon-loader
 * `HAND_BONE_BY_SKELETON`）。这不是回退链：**只换骨名、不换手**；表里没登记的骨架而通用骨也缺
 * ⇒ 不挂 + 降级清单可见。
 */
const martialWithWeapon: CharacterAppearance = {
  classId: 11, head: 0, rank: 0, bodyModelIdcode: 0,
  weaponDorp: 'wv101', weaponIdcode: 0x010b0100, weaponPos: 4,
  sizeLevel: 0,
  weaponKindCode: 2, weaponAgingLevel: 12,
  offHandKindCode: 0, offHandAgingLevel: 0,
};

/** 二号：未锻造的镰刀 + 无副手 —— 两件都不该发光（对照） */
const plain: CharacterAppearance = {
  classId: 4, head: 0, rank: 0, bodyModelIdcode: 0,
  weaponDorp: 'WP101', weaponIdcode: 0x01030100, weaponPos: 4,
  sizeLevel: 0,
  weaponKindCode: 0, weaponAgingLevel: 0,
  offHandKindCode: 0, offHandAgingLevel: 0,
};

const chars: CharacterInfo[] = [
  { characterId: 1, name: '锻造+12 长剑 / 合成盾', classId: 1, level: 40, mapId: 1, appearance: forged },
  { characterId: 2, name: '未锻造镰刀（对照）', classId: 4, level: 40, mapId: 1, appearance: plain },
  { characterId: 3, name: '格斗家 + 拳套（m8 手骨）', classId: 11, level: 40, mapId: 1, appearance: martialWithWeapon },
];

// `show` 会自动选中第一个角色（`renderList` 里 `selectCharacter(characters[0])`）
panel.show(chars, { onSelect: noop, onCreate: noop, onLogout: noop, onBackToServers: noop });

// 诊断入口（与 `window.__blink` 同类约定）：控制台里能切角色
(window as unknown as { __charselect: unknown }).__charselect = {
  chars,
  select: (id: number): void => {
    const card = document.querySelector(`[data-character-id="${id}"]`) as HTMLElement | null;
    card?.click();
  },
  /** 降级清单（"找不到骨就不挂"这类必须是**可见**的，AGENTS #12） */
  fallbacks: (): string => fallbackSummary(),
};
