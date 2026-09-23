/**
 * 锻造/合成呼吸发光（aging/craft blink）的回归 —— `npm run verify-aging-blink`。
 *
 * 为什么单独一条：这张表与几个映射**都是从源码抄的**（playsub.cpp:740-769 / 771-786 的
 * 反查 / :834-866 的等级→行 / character.cpp:6596-6659 的三角波 / NSP smRend3d.cpp:3311-3360
 * 的第二通道），抄错一行在画面上表现为"等级到了却不亮""亮了但色不对""贴图不滚"，**都不会报错**。
 * 所以这里①逐行钉死整张表（含 A 列恒 0 这条不变量）、②逐条钉死映射与波形、③钉死叠加贴图名与滚动量。
 *
 * ⚠ 与实现同源的口径：全部断言读的是 `src/game/agingBlink.ts`（渲染层只是把它的输出写进材质），
 *   故这里的"期望值"必须能从源码行**复算**，不是照抄实现的输出。
 */
import {
  agingRowOf, craftRowOf, blinkRowOf, blinkRowOfAppearance, findBlinkRow, blinkWave, mixOverlayTexture, overlayScrollU,
  BLINK_STEP, BLINK_PERIOD_MS, BLINK_HALF_MS, BLINK_DIV, ITEM_KIND_AGING, ITEM_KIND_CRAFT,
  SCROLL_PERIOD_MS, SCROLL_STEP_MS, MIX_TEXTURE_DIR,
} from '../src/game/agingBlink.js';

let failed = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ok   ${name}`); return; }
  console.log(`  FAIL ${name}${detail ? ' —— ' + detail : ''}`);
  failed++;
}

// ───────────────── ① 表本身：逐行逐字段（行序即下标） ─────────────────
// 期望值抄自 ex-machina playsub.cpp:740-759（aging）/ :761-768（craft）。
// 第二列 Scroll 写成 smTEXSTATE_FS_* 的**宏名**再折算数值 —— 手抄数值最容易在
// SCROLL4=8 与 SCROLL5=9 之间错一格（AGENTS #7b 的同类陷阱）。
const S = { NONE: 0, SCROLL4: 8, SCROLL5: 9, SCROLL6: 10, SCROLL8: 12, SCROLL9: 13, SCROLL10: 14 } as const;
const AGING_EXPECT: Array<[number, number, number, number, number, number]> = [
  [100, 40, 90, 0, -1, S.NONE],       // +4
  [120, 100, 10, 0, -1, S.NONE],      // +5
  [0, 110, 30, 0, -1, S.NONE],        // +6
  [0, 50, 140, 0, 0, S.SCROLL5],      // +7
  [100, 0, 90, 0, 1, S.SCROLL6],      // +8
  [150, 60, 0, 0, 2, S.SCROLL6],      // +9
  [150, 10, 0, 0, 3, S.SCROLL8],      // +10
  [20, 220, 190, 0, 4, S.SCROLL8],    // +11
  [10, 220, 30, 0, 4, S.SCROLL8],     // +12
  [170, 40, 170, 0, 4, S.SCROLL9],    // +13
  [250, 30, 160, 0, 4, S.SCROLL9],    // +14
  [30, 190, 255, 0, 4, S.SCROLL9],    // +15
  [250, 130, 30, 0, 4, S.SCROLL9],    // +16
  [120, 30, 30, 0, 5, S.SCROLL10],    // +17
  [130, 0, 255, 0, 5, S.SCROLL10],    // +18
  [220, 240, 70, 0, 5, S.SCROLL10],   // +19
  [240, 240, 240, 0, 5, S.SCROLL10],  // +20
];
const CRAFT_EXPECT: Array<[number, number, number, number, number, number]> = [
  [13, 0, 5, 0, 9, S.SCROLL4],
  [13, 0, 6, 0, 5, S.SCROLL4],
  [13, 0, 7, 0, 6, S.SCROLL5],
  [13, 0, 8, 0, 7, S.SCROLL5],
  [13, 0, 9, 0, 8, S.SCROLL5],
  [13, 0, 10, 0, 9, S.SCROLL5],
];

// 行号 → 期望行 的唯一入口：等级映射（aging 4..20 → 行 0..16）
for (let i = 0; i < AGING_EXPECT.length; i++) {
  const [r, g, b, a, mix, scroll] = AGING_EXPECT[i]!;
  const got = agingRowOf(i + 4);
  check(`aging 行 ${i}（=+${i + 4}）逐字段`, !!got && got.r === r && got.g === g && got.b === b
    && got.a === a && got.texMixCode === mix && got.texScroll === scroll,
    JSON.stringify(got) + ' 期望 ' + JSON.stringify(AGING_EXPECT[i]));
}
for (let i = 0; i < CRAFT_EXPECT.length; i++) {
  // craft 行的取值来源：itemAgingNum 0 → 行 0；6..10 → 行 1..5
  const num = i === 0 ? 0 : i + 5;
  const [r, g, b, a, mix, scroll] = CRAFT_EXPECT[i]!;
  const got = craftRowOf(num);
  check(`craft 行 ${i}（=agingNum ${num}）逐字段`, !!got && got.r === r && got.g === g && got.b === b
    && got.a === a && got.texMixCode === mix && got.texScroll === scroll,
    JSON.stringify(got) + ' 期望 ' + JSON.stringify(CRAFT_EXPECT[i]));
}

// A 列恒 0 —— 这条同时否掉了"乘性 alpha 蒙版 / 布尔旁路闸门"那套模型（见 agingBlink.ts 文件头）
check('全 23 行 A 列恒 0（原版两条 alpha 分支都不成立）',
  [...AGING_EXPECT, ...CRAFT_EXPECT].every((row) => row[3] === 0), '');

// 反查（GetItemKindFromBliankColor）必须命中它自己 —— 证明表里没有重复颜色，
// 否则"由色反查"会把两行搞混（原版这条路径用在 EffectColor 上）
for (const [i, row] of AGING_EXPECT.entries()) {
  const got = findBlinkRow(row[0], row[1], row[2], row[3], 'aging');
  check(`aging 行 ${i} 由 (r,g,b,a) 反查命中自己`, got.texMixCode === row[4] && got.texScroll === row[5],
    JSON.stringify(got));
}
for (const [i, row] of CRAFT_EXPECT.entries()) {
  const got = findBlinkRow(row[0], row[1], row[2], row[3], 'craft');
  check(`craft 行 ${i} 由 (r,g,b,a) 反查命中自己`, got.texMixCode === row[4] && got.texScroll === row[5],
    JSON.stringify(got));
}

// ───────────────── ② 等级 → 行映射的边界（playsub.cpp:834-843 / :848-866） ─────────────────
check('aging 3 及以下不发光（原版 4..20 才有表项）', agingRowOf(0) === null && agingRowOf(3) === null);
check('aging 4..20 发光', !!agingRowOf(4) && !!agingRowOf(20));
check('aging 21 以上不发光（表只到 +20）', agingRowOf(21) === null && agingRowOf(30) === null);
check('craft 0 → 行 0', craftRowOf(0)?.texMixCode === 9);
check('craft 6..10 → 行 1..5', craftRowOf(6)?.texMixCode === 5 && craftRowOf(10)?.texMixCode === 9);
check('craft 1..5 不发光（原版 cnt = -1 那条分支）',
  craftRowOf(1) === null && craftRowOf(5) === null);
check('craft 11..14 不发光', craftRowOf(11) === null && craftRowOf(14) === null);
check('kindCode 旁路：普通装备(0)不发光', blinkRowOf(0, 20) === null);
check('kindCode 分发：2=锻造、1=合成', blinkRowOf(ITEM_KIND_AGING, 4)?.r === 100
  && blinkRowOf(ITEM_KIND_CRAFT, 0)?.texMixCode === 9);

// ───────────────── ③ 三角波（character.cpp:6596-6659） ─────────────────
check('周期常量 = 2^(9+1) = 1024ms', BLINK_PERIOD_MS === 1024 && BLINK_HALF_MS === 512 && BLINK_DIV === 512 && BLINK_STEP === 9,
  `${BLINK_PERIOD_MS}/${BLINK_HALF_MS}/${BLINK_DIV}`);
check('t=0 是峰（bTime=511 → 511/512，不是 1）', blinkWave(0) === 511 / 512, String(blinkWave(0)));
check('t=511 → 0（降半波走到底）', blinkWave(511) === 0, String(blinkWave(511)));
check('t=512 是谷（升半波起点）', blinkWave(512) === 0, String(blinkWave(512)));
check('t=1023 → 511/512（升半波走满）', blinkWave(1023) === 511 / 512, String(blinkWave(1023)));
check('周期后完全重复', blinkWave(1234) === blinkWave(1234 + BLINK_PERIOD_MS) && blinkWave(7) === blinkWave(7 + 4 * BLINK_PERIOD_MS));
check('波形恒在 [0,1)（逐毫秒扫两个周期）', (() => {
  for (let ms = 0; ms < 2 * BLINK_PERIOD_MS; ms++) {
    const w = blinkWave(ms);
    if (!(w >= 0 && w < 1)) return false;
  }
  return true;
})(), '');
check('相邻采样不跳变（|Δ| ≤ 1/512：真·逐帧渐变，不是闪烁）', (() => {
  for (let ms = 0; ms < 4 * BLINK_PERIOD_MS; ms++) {
    if (Math.abs(blinkWave(ms + 1) - blinkWave(ms)) > 1 / BLINK_DIV + 1e-9) return false;
  }
  return true;
})(), '');

// ───────────────── ④ 第二通道：贴图名与滚动量 ─────────────────
check('叠加贴图目录 = Image\\sinImage\\Items\\DropItem（我方资产小写同名）',
  MIX_TEXTURE_DIR === 'image/sinimage/items/dropitem/', MIX_TEXTURE_DIR);
check('TexMixCode 0..4 → mixS_01..05', [0, 1, 2, 3, 4].every((i) => mixOverlayTexture(i) === `mixs_0${i + 1}.bmp`),
  [0, 4].map(mixOverlayTexture).join(','));
check('TexMixCode 5..9 → mixM_01..05', [5, 6, 7, 8, 9].every((i) => mixOverlayTexture(i) === `mixm_0${i - 4}.bmp`),
  [5, 9].map(mixOverlayTexture).join(','));
check('TexMixCode 越界（-1/10）→ null（不静默取第 0 张）',
  mixOverlayTexture(-1) === null && mixOverlayTexture(10) === null && mixOverlayTexture(1.5) === null);
// 表里实际出现的 TexMixCode 都要能落到真实文件上（-1 除外）
{
  const codes = new Set([...AGING_EXPECT, ...CRAFT_EXPECT].map((r) => r[4]).filter((c) => c >= 0));
  check('表里用到的每个 TexMixCode 都能映射到贴图名', [...codes].every((c) => mixOverlayTexture(c) !== null),
    [...codes].join(','));
}
// 滚动：SCROLL2..10 → u + fwtime*(state-4)，fwtime = ((t/64)&0xFF)/256
check('滚动量 = ((t/64)&255)/256 × (mode-4)',
  overlayScrollU(8, 0) === 0 && overlayScrollU(8, 64) === 4 / 256 && overlayScrollU(14, 64) === 10 / 256,
  `${overlayScrollU(8, 64)} / ${overlayScrollU(14, 64)}`);
check('滚动一个周期后回绕到 0（16.384s）',
  SCROLL_PERIOD_MS === 16384 && overlayScrollU(14, SCROLL_PERIOD_MS) === 0 && overlayScrollU(14, SCROLL_PERIOD_MS - 64) === (255 / 256) * 10,
  String(overlayScrollU(14, SCROLL_PERIOD_MS)));
check('滚动单调不减（回绕点之外）', (() => {
  let prev = -1;
  for (let ms = 0; ms < SCROLL_PERIOD_MS - SCROLL_STEP_MS; ms += 64) {
    const u = overlayScrollU(14, ms)!;
    if (u < prev) return false;
    prev = u;
  }
  return true;
})(), '');
check('未实现的滚动模式返回 null（不假装 0）',
  overlayScrollU(4, 0) === null && overlayScrollU(5, 0) === null && overlayScrollU(15, 0) === null
  && overlayScrollU(0, 0) === 0,
  `${overlayScrollU(4, 0)} / ${overlayScrollU(0, 0)}`);

// ───────────────── ⑤ 反查未命中（原版默认值，调用方据此走"无发光"） ─────────────────
{
  const missA = findBlinkRow(1, 2, 3, 4, 'aging');
  const missC = findBlinkRow(1, 2, 3, 4, 'craft');
  check('未命中 aging 行 → texMixCode=-1、texScroll=0', missA.texMixCode === -1 && missA.texScroll === 0, JSON.stringify(missA));
  check('未命中 craft 行 → 同上', missC.texMixCode === -1 && missC.texScroll === 0, JSON.stringify(missC));
}

// ───────────────── ⑥ 外观 → 行（世界内自机/远端、选角预览**共用**的入口） ─────────────────
{
  // 自机/远端外观上的四个字段就是服务端下发的 ItemKindCode + ItemAgingNum[0]
  const app = { weaponKindCode: 2, weaponAgingLevel: 12, offHandKindCode: 2, offHandAgingLevel: 0 };
  check('外观主手 → +12 那行', blinkRowOfAppearance(app, 'main')?.r === 10 && blinkRowOfAppearance(app, 'main')?.texMixCode === 4,
    JSON.stringify(blinkRowOfAppearance(app, 'main')));
  check('外观副手 → 各自那行（互不串用主手的值）',
    blinkRowOfAppearance({ ...app, offHandKindCode: 1, offHandAgingLevel: 0 }, 'off')?.texMixCode === 9,
    JSON.stringify(blinkRowOfAppearance({ ...app, offHandKindCode: 1, offHandAgingLevel: 0 }, 'off')));
  check('字段缺失（旧服务端不下发 / 预览没给）→ null，不发光',
    blinkRowOfAppearance(undefined, 'main') === null && blinkRowOfAppearance({}, 'main') === null
    && blinkRowOfAppearance({ weaponKindCode: 2 }, 'main') === null);
  check('普通装备（kindCode=0）→ null', blinkRowOfAppearance({ weaponKindCode: 0, weaponAgingLevel: 20 }, 'main') === null);
  check('与 blinkRowOf 同源（同一份映射，不另写一套）',
    blinkRowOfAppearance({ weaponKindCode: 2, weaponAgingLevel: 20 }, 'main') === blinkRowOf(2, 20));
}

console.log(failed === 0 ? '\n锻造/合成呼吸发光：全部通过' : `\n锻造/合成呼吸发光：${failed} 条失败`);
process.exit(failed === 0 ? 0 : 1);
