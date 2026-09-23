/**
 * 锻造(Aging)/合成(Craft)的"呼吸发光"纯逻辑层 —— **不依赖 three**，渲染侧（render/blink-fx.ts）
 * 只负责把它算出来的数写进材质。
 *
 * 原版链路（ex-machina，8 职业客户端；逐条与 `NewSourcePT-2023/ScrServer/src/playsub.cpp`
 * 的 11 职业**服务端**副本比对**逐字相同** —— 见 `aging-blink.generated.json` 的 note）：
 *
 *   1. `sinSetCharItem`（playsub.cpp:826-868 主手 / :884-925 副手）：装备时按
 *      `ItemKindCode` + `ItemAgingNum[0]` 从 `AgingBlinkColor[17]` / `CraftBlinkColor[6]`
 *      里取一行，写进 `sColors[R/G/B/A]`，并把 `ColorBlink` 置 **9**；
 *      随后 `GetItemKindFromBliankColor`（:771-786）用 (r,g,b,a) **反查**同一张表拿
 *      `TexMixCode` / `TexScroll`（原版 sColors 还可能来自物品的 `EffectColor`，故它只能反查）。
 *   2. `SetRenderBlinkColor`（character.cpp:6596-6659）：每帧按 `ColorBlink` 算三角波，把
 *      `(bTime*R)>>Blink` 加进 `smRender.Color_R/G/B`，并在 `TexMixCode >= 0` 时调
 *      `SetItem2PassTexture(TexMixCode, TexScroll)`；用完 `RestoreRenderBlinkColor` 撤销。
 *   3. `smRend3d.cpp` 的 `AddLight(rv, Color_R, Color_G, Color_B, Color_A)`（:2044/:2066）把这个
 *      颜色**加在顶点光上** ⇒ 贴图被它调制 ⇒ 视觉 = **武器网格上叠加一层呼吸的彩色光**。
 *   4. 第二通道：`SetItem2PassD3DRendState`（NSP SrcGame `smLib3d/smRend3d.cpp:3311-3360`）
 *      stage0 = MODULATE（贴图 × 顶点光）、stage1 = **ADD**（+ 叠加贴图），叠加贴图的 UV
 *      按 `TexScroll` 横向滚动（同文件 :2974 / :2984）。
 *
 * ⚠ **与早前一处错误模型的更正**：曾把这里的 `sColors[A]` 当成"乘性 alpha 蒙版"、把
 *   `ColorBlink != 0` 当成"布尔旁路闸门"，并据此造过 `uBlink{alpha,active,rgbAdd}` 的着色器模型。
 *   源码里没有这回事（`uBlink` 在三个参考仓库里搜不到，是自造命名）：
 *   · 表里 **A 列恒 0**（见 verify 的数据不变量）⇒ 两条 alpha 分支都不成立；
 *   · `ColorBlink=0` 只表示"这件装备没有闪烁效果"，不是"整层不过"；
 *   · 真正的可见量是**加性彩色光**（第 3 步）+ 有质量条目才有第二通道（第 4 步）。
 *   周期也不是 2.0s：`Blink=9 ⇒ BlinkTime=1<<9=512`、`bTime=dwPlayTime&511`，
 *   `dwPlayTime` 是**毫秒**（同文件里 `dwPlayTime + 60*1000` 当 60 秒用）⇒ **一个完整三角波 = 1024ms**。
 *
 * 数据（行序即下标）已压进 `src/game/data/aging-blink.generated.json`。
 */
// ⚠ **必须用普通 ESM import**（resolveJsonModule 已开，与 `itemDefs` / `potionEffects` 等生成物同规矩）：
//   这一层进浏览器（Vite 打包）也进 tsx（verify 脚本），`createRequire('node:module')` 那套在浏览器里
//   直接是"外部化模块"错误 —— 曾因此整条链路只能跑 Node、进不了游戏。
import AGBLINK_JSON from './data/aging-blink.generated.json';

/** 原版 `ColorBlink` 值：锻造物与合成物装备时都置 9（playsub.cpp:836/855/893/912）。 */
export const BLINK_STEP = 9;
/** 三角波半周期（`1 << BLINK_STEP`，即 `dwPlayTime` 的第 9 位）：颜色按 `(bTime*r)>>BLINK_STEP` 缩放。 */
export const BLINK_HALF_MS = 1 << BLINK_STEP;
/** 一个完整三角波 = 1024ms。 */
export const BLINK_PERIOD_MS = BLINK_HALF_MS * 2;
/**
 * 颜色缩放分母（= `1 << BLINK_STEP`）。原版 `bTime ∈ [0, 511]` ⇒ 波形峰值是 `511/512`，
 * 不会到 1（照抄，不平滑成 511）。
 */
export const BLINK_DIV = 1 << BLINK_STEP;

/** 原版 `ItemKind`（userdb.item.kind_code / ItemInstance.kindCode）。 */
export const ITEM_KIND_CRAFT = 1;
export const ITEM_KIND_AGING = 2;

/** 表里一行：`[R, G, B, A, TexMixCode, TexScroll]`。 */
export interface BlinkRow {
  r: number;
  g: number;
  b: number;
  a: number;
  /** 第二通道贴图序号；-1 = 只有呼吸光、没有叠加贴图。 */
  texMixCode: number;
  /** 第二通道 UV 滚动模式（`smTEXSTATE_FS_*` 数值）。 */
  texScroll: number;
}

/**
 * 当前时刻的三角波（0 …… 511/512），**未锻造时无意义**（调用方先取行）。
 *
 * 原版（character.cpp:6620-6641）：
 * ```
 * bTime = dwPlayTime & BlinkMsk;               // BlinkMsk = 511
 * if (dwPlayTime & BlinkTime) { ...按 bTime... }  // 第 9 位落 = 升半波
 * else { bTime = BlinkMsk - bTime; ... }          // 不落 = 降半波
 * ```
 * ⇒ 相位是"先降后升"（t≡0 为峰、t≡512 为谷），与"先升后降"只差一个固定相位偏移 ——
 * 原版如此，照抄（对周期性呼吸光而言无所谓，但别让两处实现各取一种相位）。
 */
export function blinkWave(nowMs: number): number {
  const t = Math.floor(nowMs) & (BLINK_PERIOD_MS - 1);
  const frac = t & (BLINK_HALF_MS - 1);
  return ((t & BLINK_HALF_MS) !== 0 ? frac : (BLINK_HALF_MS - 1) - frac) / BLINK_DIV;
}

/**
 * 锻造等级 → 表行（playsub.cpp:834-843）：`cnt = ItemAgingNum[0]`，**4..20 才有**，
 * 行号 = `cnt - 4`（表 17 行 ⇒ +4 … +20）。
 * 1..3 与 >20 都**没有**表项（原版 `ColorBlink` 保持物品自身的 `EffectBlink[0]`，
 * 我方没有该列 ⇒ 视为不发光）。
 */
export function agingRowOf(level: number): BlinkRow | null {
  if (!(level >= 4 && level <= 20)) return null;
  return AGBLINK.aging[level - 4] ?? null;
}

/**
 * 合成物 → 表行（playsub.cpp:848-866，主手；副手 :905-923 同）：
 * ```
 * cnt = ItemAgingNum[0];
 * if (6..10) cnt -= 5;          // → 行 1..5
 * else if (cnt == 0) cnt = 0;   // → 行 0
 * else cnt = -1;                // → 不发光（1..5 与 11..14 都是这条）
 * ```
 * ⚠ 合成物的 `ItemAgingNum[0]` 是**材料槽位 + 1**（NSP `sinTrade.cpp:5008`，k 为 0 基槽号），
 * 不是等级 —— 所以"合成+6"这种说法在这条链路上指的是**材料槽**。
 * 我方服务端把配方 id 记在 `aging_num2`、**不写** `aging_num`（见 MixService 注释）
 * ⇒ 我方合成物恒为 0 ⇒ 走行 0（与"原版合成物 +0"同表现）。
 */
export function craftRowOf(agingNum: number): BlinkRow | null {
  let idx: number;
  if (agingNum >= 6 && agingNum <= 10) idx = agingNum - 5;
  else if (agingNum === 0) idx = 0;
  else return null;
  return AGBLINK.craft[idx] ?? null;
}

/** 装备的 (ItemKindCode, ItemAgingNum[0]) → 发光行；非锻造/合成物返回 null。 */
export function blinkRowOf(kindCode: number, agingNum: number): BlinkRow | null {
  if (kindCode === ITEM_KIND_AGING) return agingRowOf(agingNum);
  if (kindCode === ITEM_KIND_CRAFT) return craftRowOf(agingNum);
  return null;
}

/**
 * 外观上的四个发光输入字段 —— **结构类型**（不 import `ui/CharSelect` 的接口，
 * 免得 game → ui 反向依赖；`CharacterAppearance` 恰好满足它）。
 */
export interface AppearanceBlinkInput {
  weaponKindCode?: number;
  weaponAgingLevel?: number;
  offHandKindCode?: number;
  offHandAgingLevel?: number;
}

/**
 * 一份外观 → 那只手的发光行。**唯一实现**（世界内的自机/远端、选角预览、将来的检查器都调它）：
 * 主手取 `weaponKindCode/weaponAgingLevel`、副手取 `offHandKindCode/offHandAgingLevel`；
 * 字段缺失（旧服务端不下发 / 预览没带）⇒ null = 不发光。
 */
export function blinkRowOfAppearance(app: AppearanceBlinkInput | undefined, hand: 'main' | 'off'): BlinkRow | null {
  if (!app) return null;
  const kind = hand === 'main' ? app.weaponKindCode : app.offHandKindCode;
  const level = hand === 'main' ? app.weaponAgingLevel : app.offHandAgingLevel;
  if (kind === undefined || level === undefined) return null;
  return blinkRowOf(kind, level);
}

/**
 * 移植 `GetItemKindFromBliankColor`（playsub.cpp:771-786）：先置默认
 * `{texMixCode:-1, texScroll:0}`，再按 `kind` 的整张表从第 0 行起**精确比对** (r,g,b,a)。
 *
 * 我方装备链路用不到它（我们直接由 `kindCode + agingNum` 定行 —— 原版之所以反查，是因为
 * `sColors` 也可能来自物品的 `EffectColor`），保留它是为了：① 表自洽校验（每行走一遍必须
 * 命中自己 ⇒ 表里没有重复颜色，见 verify）；② 将来接 `EffectColor` 时的唯一入口。
 */
export function findBlinkRow(r: number, g: number, b: number, a: number, kind: 'aging' | 'craft'): BlinkRow {
  const rows = kind === 'aging' ? AGBLINK.aging : AGBLINK.craft;
  for (const row of rows) {
    if (row.r === r && row.g === g && row.b === b && row.a === a) return row;
  }
  return { r, g, b, a, texMixCode: -1, texScroll: 0 };
}

// ───────────────────────── 第二通道：叠加贴图与 UV 滚动 ─────────────────────────

/** 叠加贴图目录（原版 `SetItem2PassTexture` 拼的 `Image\sinImage\Items\DropItem\`）。 */
export const MIX_TEXTURE_DIR = 'image/sinimage/items/dropitem/';

/**
 * `TexMixCode` → 叠加贴图文件名（表在 ex-machina `smRend3d.cpp:34-38`，与 11 职业**服务端**
 * 副本 `NewSourcePT-2023/ScrServer/src/smLib3d/smRend3d.cpp:36-40` **逐字相同**）：
 * `0..4 = mixS_01..05`、`5..9 = mixM_01..05`。
 *
 * ⚠ 另一份副本（`NewSourcePT-2023/SrcGame`＝11 职业**客户端**侧）把这张表改成了
 * `mixM_01..14`（14 项）。**不采信它**：① 它与同仓库服务端副本自相矛盾；
 * ② 它的 blonk 表（playsub.cpp:1218-1241）多出两行取值 256/768（超出 sColors 的有效范围、
 *    永不命中）⇒ 那一份被私服改过；③ 我方资产里恰好是 `mixs_01..05 + mixm_01..05` 十件，
 *    按 0..9 取值**全部命中**（`mixm_06` 恰好不存在，正是 14 项表缺的那一格）。
 */
export function mixOverlayTexture(texMixCode: number): string | null {
  if (!Number.isInteger(texMixCode) || texMixCode < 0 || texMixCode > 9) return null;
  const n = String((texMixCode % 5) + 1).padStart(2, '0');
  return (texMixCode < 5 ? 'mixs_' : 'mixm_') + n + '.bmp';
}

/** 滚动量的量化步长：原版 `wtime = (RendStatTime >> 6) & 0xFF`（每 64ms 一格、256 格一循环）。 */
export const SCROLL_STEP_MS = 64;
/** 滚动循环周期 = 256 × 64ms = 16.384s（走完 1.0 个 U 单位后回绕）。 */
export const SCROLL_PERIOD_MS = 256 * SCROLL_STEP_MS;

/**
 * 第二通道的 U 偏移（原版 `smRend3d.cpp:2859/2974`）：
 * ```
 * wtime = (RendStatTime >> 6) & 0xFF;  fwtime = wtime / 256;
 * SCROLL2..10: U = u + fwtime * (state - (SCROLL2 - 2));   // = ×(state-4)
 * ```
 * 我们的表只用到 SCROLL4..SCROLL10（8..14）⇒ 倍率 4…10，一个周期内扫过 0…(state-4) 个 U
 * （贴图是 WRAP 采样，越界即平铺）。
 *
 * 其余模式（NONE / FORMX-Y-Z / SCROLL / REFLEX / SCROLLSLOW1-4）**不在这条链路上**：
 * 本函数对它们返回 `null`（= 未实现），由渲染层上报，不假装成 0（AGENTS #12）。
 */
export function overlayScrollU(texScroll: number, nowMs: number): number | null {
  if (texScroll >= 6 && texScroll <= 14) {
    const wtime = Math.floor(nowMs / SCROLL_STEP_MS) & 0xFF;
    return (wtime / 256) * (texScroll - 4);
  }
  return texScroll === 0 ? 0 : null;
}

interface BlinkData {
  aging: BlinkRow[];
  craft: BlinkRow[];
}

/** JSON 里的一行是 `[R, G, B, A, TexMixCode, TexScroll]` 数组（紧凑、便于逐字比对源码）；这里转成具名对象 */
function rowOf(a: number[]): BlinkRow {
  if (!Array.isArray(a) || a.length !== 6) {
    throw new Error('aging-blink.generated.json 行长度异常（应为 6 元素）：' + JSON.stringify(a));
  }
  return { r: a[0]!, g: a[1]!, b: a[2]!, a: a[3]!, texMixCode: a[4]!, texScroll: a[5]! };
}

// 模块顶层转一次；解析守卫让"JSON 损坏/被改坏"在 import 时爆出来，而不是运行时静默。
const AGBLINK = ((): BlinkData => {
  const d = AGBLINK_JSON as { aging: number[][]; craft: number[][] };
  if (!Array.isArray(d.aging) || !Array.isArray(d.craft) || d.aging.length !== 17 || d.craft.length !== 6) {
    throw new Error('aging-blink.generated.json 结构异常（应为 aging 17 行 / craft 6 行）');
  }
  return { aging: d.aging.map(rowOf), craft: d.craft.map(rowOf) };
})();

// ⚠ 这里**不做** import 期自检：本模块进浏览器（Vite）后每次加载都会跑，抛错就等于整页起不来。
// 断言全在 `scripts/verify-aging-blink.ts`（`npm run verify-aging-blink`）。
