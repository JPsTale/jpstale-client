/**
 * 真·鼠标左右键施法 + 技能角标 L/R + HUD 拳位同步的护栏检查。
 *
 * 2026-09-23 第二轮（**按原版重写**）：上一版把"无怪就什么都不做"当成右键语义，判错了两格
 * （源码里右键**先试无目标施放**，那才是自身 buff / 自身中心 AoE 的唯一入口）。
 * 本轮断言按 `docs/技能施法-原版流程.md` 改写，**强度只升不降**。断言分七组：
 *  ① **调试施法通路已拆**：世界里不再有 `altKey/shiftKey + 左键` 那条调试分支（SKILL_DEBUG 只剩技能等级）。
 *  ② **右键顺序 = 先试无目标施放、失败才打光标下的怪**；**左键没有这条路**（原版左键分支不看拳位）；
 *     无目标施放失败时**不弹消息**、且右拳路径不阻断传播（面板右键还要用）。
 *  ③ **四道闸门**（村庄 / 职业 / 名单 / 技能等级）跑**真模块** `game/skillNoTarget.ts` 逐条验；
 *     村庄判据必须用 `isVillageMap`（`field.cpp` 的 Field State，只 2 张图），**不许**拿 `isSafeMap` 近似。
 *  ④ **名单生成物 == 源码重算**：拿 `scripts/openplay-scan.ts` 当场重扫 `SkillSub.cpp`，
 *     与 `src/game/data/source/skill-openplay-macros.json` 逐条比对（含"为什么是 65 不是 57"）。
 *  ⑤ **角标 L/R 有定位规则且左右不同**（原先是"两个角标都无 CSS"，即用户看到的 R 压 L）。
 *  ⑥ **HUD 拳位同步**：不再对路径做百分号编码（双重编码 ⇒ 拿到 index.html ⇒ 静默退回默认图标），
 *     加载失败走 `reportFallback`（降级可见），成功后由每帧 `draw()` 兑现。
 *  ⑦ **encodeAssetPath 口径**（双重编码 = 根因）。
 *
 * 用法：`npm run verify-mouse-cast`
 */
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeAssetPath } from '../src/core/texture.js';
import { scanOpenPlayCases, scanSkillDistRangeCases } from './openplay-scan.js';
import { installDomStub } from './dom-stub.js';

let fails = 0;
const ok = (label: string, cond: boolean): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};
// ⚠ 源文件是 CRLF：多行断言前先归一成 `\n`（否则 `...\n      // ...` 这类正则永远不匹配）
const read = async (rel: string): Promise<string> => (await readFile(new URL(rel, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const wv = await read('../src/ui/WorldView.ts');
const hud = await read('../src/ui/Hud.ts');
const css = await read('../src/ui/react/panels.css');
const noTargetSrc = await read('../src/game/skillNoTarget.ts');
const mapLightSrc = await read('../src/maps/map-light.ts');

/** 去掉 `//` 与 `/* *\/` 注释 —— "某标识符只出现 N 次"这类计数必须排除注释里的提及 */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** 取一段函数体（从 `head` 起、到下一个顶格 `}` 结束）——用于"这条调用确实在这个函数里"的断言 */
function bodyOf(src: string, head: string): string {
  const i = src.indexOf(head);
  if (i < 0) return '';
  const end = src.indexOf('\n  }', i);
  return end < 0 ? src.slice(i) : src.slice(i, end);
}
/** 子串出现顺序（`a` 必须在 `b` 之前；任一缺失即 false） */
const before = (s: string, a: string, b: string): boolean => {
  const i = s.indexOf(a), j = s.indexOf(b);
  return i >= 0 && j >= 0 && i < j;
};

console.log('① 调试施法通路已移除');
ok('WorldView 不再有 altKey/shiftKey 调试分支', !/altKey|shiftKey/.test(wv));
ok('WorldView 不再引用 SKILL_DEBUG（该开关只剩技能等级，面板还在用）', !/SKILL_DEBUG/.test(wv));
ok('鼠标处理不再只认左键（button===0||button===2 同时接管）', /if \(e\.button === 0 \|\| e\.button === 2\)/.test(wv));

console.log('② 右键 = 先试无目标施放（成功即结束）；左键 = 没有这条路');
const mouseDown = bodyOf(wv, 'function onMouseDown(e: MouseEvent): void {');
const noTarget = bodyOf(wv, 'function tryNoTargetCast(): boolean {');
ok('右键先试无目标施放（进入那条路的唯一入口带 `e.button === 2` 守卫）',
  /if \(e\.button === 2 && tryNoTargetCast\(\)\) \{ e\.preventDefault\(\); return; \}/.test(wv));
ok('`tryNoTargetCast()` 在代码（去注释）里只出现 2 次：1 处定义 + 1 处调用 ⇒ 左键不可能走到它',
  (stripComments(wv).match(/tryNoTargetCast\(\)/g) ?? []).length === 2);
ok('右键"先试无目标"在"打光标下的怪"之前（原版 Winmain.cpp:3080-3090 的先后）',
  before(mouseDown, 'tryNoTargetCast()', 'fistCastTarget(slot,'));
// 2026-09-24 改（用户实测："近战应该跟普攻一样跑到目标身边再攻击，而不是原地施法"）：
// 点怪**不再当场施法** —— 原版这一岔是 `SelMouseButton = 1/2; TraceAttackPlay()`（`Winmain.cpp:2994-2996`），
// 技能由攻击循环在攻击距离内逐次放出（`playmain.cpp:2474` 的 `PlaySkillAttack(lpAttackSkill, …)`）。
ok('点怪**不当场施法**（交给追打循环在射程内放），且记住"用哪只拳"',
  /const aim = fistCastTarget\(slot, e\.clientX, e\.clientY\);/.test(mouseDown)
  && /selfAttackSlot = slot;/.test(mouseDown)
  && !/playEquippedSkill\(slot, aim\)/.test(mouseDown));
ok('右键失败且光标下有怪 ⇒ 选目标去追打（源码 break 之后落到 `SelMouseButton=2; TraceAttackPlay()`）',
  /if \(e\.button === 2\) \{/.test(mouseDown)
  && /onGroundTap\(e\.clientX, e\.clientY\);/.test(mouseDown));
ok('右键两处都失败 ⇒ 只 preventDefault（保持"什么都不做"，不新造语义）',
  /if \(e\.button === 2\) \{ e\.preventDefault\(\); return; \}/.test(mouseDown));
ok('无目标施放失败**不弹任何消息**（原版静默；内部数据缺口才走 reportFallback）',
  !/message|toast|alert|MessageBox|showError/i.test(noTarget));
ok('施法成功也**不阻塞**（原版两条路都不 stopPropagation）', !/stopPropagation/.test(mouseDown));
ok('施放分支 return 后左键原有分支仍在（移动/拾取/选目标不回归）',
  /if \(e\.button === 0\) \{\n      \/\/ 指向可交互目标/.test(wv)
  && /const overTarget = nameplateTargetAt\(e\.clientX, e\.clientY\) !== null/.test(wv));
// 2026-09-23 改：左键"点怪施法"之后**不再 return**（原版 `SelMouseButton = 1; TraceAttackPlay()`：
// 施法 与 "选中这只怪去追打" 是同一件事的两个后果；早先 return 掉，于是不再有后续的技能出手与音）。
ok('左键点怪之后**不 return**（右键那条才 return）—— 否则不会进入追打循环',
  /selfAttackSlot = slot;/.test(mouseDown)
  && /if \(e\.button === 2\) \{/.test(mouseDown)
  && !/if \(e\.button === 2\) return;/.test(mouseDown));
ok('"打光标下的怪"仍要求三件：该拳解得出来（绑定是技能）+ 光标下有怪 + 是怪不是空地',
  /if \(!fistSkillOf\(slot\)\) return null;/.test(wv)
  && /const tag = nameplateTargetAt\(cx, cy\) \?\? pickTargetAt\(cx, cy\);/.test(wv)
  && /if \(!tag \|\| tag\.kind !== 'monster'\) return null;/.test(wv));
// 2026-09-24 改：绑定身份换成**数字 skillId**，判定搬进 `game/skillBinding.ts`（唯一实现）。
// 这两条比旧写法**更严**：旧的 `bind.classDir !== (CLASS_DIR[selfJobId] ?? 'fighter')` 是兜底
// （职业没下发就拿 fighter 去比），新写法查不到职业 ⇒ 不解析（invalid）。
ok('身份判定只此一处：`fistSkillOf` 走 `fistIntent`（读服务端绑定表 + 角色职业）',
  /function fistSkillOf[\s\S]{0,400}?const it = fistIntent\(slot\);/.test(wv)
  && /function fistIntent\(slot: 'left' \| 'right'\): FistIntent \{[\s\S]{0,200}?fistIntentOf\(snap\.skillBindings, snap\.character\?\.job \?\? null, slot\)/.test(wv));
ok('**没有职业兜底**：施法链上不再出现 `?? \'fighter\'`（缺职业 ⇒ invalid/unknown，不放）',
  !/\?\? 'fighter'/.test(stripComments(wv)));
ok('瞄准改用**点击这一下自己的判定**（不再读 15Hz 滞后的 `hoverTarget`；用户实测"点得到怪却没音"的一类）',
  !/hoverTarget/.test(stripComments(bodyOf(wv, 'function fistCastTarget('))));
ok('无目标施放的顺序照源码：①动作态闸门 ②绑定/职业 ③四道闸门 ④先播后发',
  /if \(st === STATE\.ATTACK \|\| st === STATE\.SKILL \|\| st === STATE\.EAT\) return false;/.test(noTarget)
  && before(noTarget, 'noTargetCastBlock(', 'playSkillByIcon(')
  && before(noTarget, 'playSkillByIcon(', 'onCastSkill?.('));
ok('播不出来就不发包（播放层"该技能必须有目标"门 ⇒ 退回打怪那条路，不假装放出去）',
  /if \(!playSkillByIcon\(fs\.icon, null\)\) return false;/.test(noTarget));
ok('无目标施放发的包是 `targetId = 0`（原版 SkillTaget_CODE = 0；服务端对 0 目前空转，见 docs）',
  /onCastSkill\?\.\(fs\.skillId, 0\)/.test(noTarget));

console.log('③ 四道闸门（跑真模块 game/skillNoTarget.ts）+ 村庄判据出处');
{
  installDomStub();   // gameStore → item-sounds → sfx 在 import 期就注册 document/window
  const { setSkillList } = await import('../src/app/gameStore.js');
  const { noTargetCastBlock, isInNoTargetList, NO_TARGET_SKILL_COUNT } = await import('../src/game/skillNoTarget.js');
  const { fallbacks, clearFallbacks } = await import('../src/char/fallback-log.js');
  const { isVillageMap, mapLightProfile } = await import('../src/maps/map-light.js');
  const GEN = JSON.parse(readFileSync(resolve(root, 'src/game/data/source/skill-openplay-macros.json'), 'utf8')) as {
    macros: Array<{ macro: string; line: number }>;
  };
  const TBL = JSON.parse(readFileSync(resolve(root, 'src/game/data/skill-tables.generated.json'), 'utf8')) as {
    skills: Array<{ classDir: string; slotInJob: number; skillId: number; macro: string | null; useCode: string }>;
  };
  const pick = (dir: string, slot: number) => TBL.skills.find((r) => r.classDir === dir && r.slotInJob === slot)!;
  const inList = pick('pikeman', 0);      // SKILL_PIKE_WIND —— 在名单里
  const notInList = pick('pikeman', 11);  // SKILL_CHAIN_LANCE —— 不在名单里
  setSkillList({ learned: { [inList.skillId]: { point: 7, mastery: 0 }, [notInList.skillId]: { point: 7, mastery: 0 } }, skillPoint: 0, specialSkillPoint: 0 });

  ok(`名单条数 = 生成物条数（${NO_TARGET_SKILL_COUNT}）`, NO_TARGET_SKILL_COUNT === GEN.macros.length);
  ok('闸门①村庄 ⇒ village（原版 SkillSub.cpp:41）', noTargetCastBlock(inList.skillId, 'pikeman', true) === 'village');
  ok('闸门②不是本职业 ⇒ class（sinCheckSkillUseOk 的职业组掩码）', noTargetCastBlock(inList.skillId, 'knight', false) === 'class');
  ok(`闸门③不在名单里 ⇒ notInList（${notInList.macro}）`,
    !isInNoTargetList(notInList.macro) && noTargetCastBlock(notInList.skillId, 'pikeman', false) === 'notInList');
  ok(`闸门④已学且等级 1..10 ⇒ 放行（${inList.macro}）`,
    isInNoTargetList(inList.macro) && noTargetCastBlock(inList.skillId, 'pikeman', false) === null);

  setSkillList({ learned: {}, skillPoint: 0, specialSkillPoint: 0 });
  ok('未学（Point=0）⇒ unlearned（UseSkillFlag 归零 ⇒ 校验不过）',
    noTargetCastBlock(inList.skillId, 'pikeman', false) === 'unlearned');
  setSkillList({ learned: { [inList.skillId]: { point: 11, mastery: 0 } }, skillPoint: 0, specialSkillPoint: 0 });
  ok('Point > 10 ⇒ pointTooHigh（原版 SkillSub.cpp:45）',
    noTargetCastBlock(inList.skillId, 'pikeman', false) === 'pointTooHigh');

  clearFallbacks();
  setSkillList(null);
  ok('等级未知（S2C_SkillList 未到）⇒ 不拦（放行），但**降级可见**',
    noTargetCastBlock(inList.skillId, 'pikeman', false) === null
    && fallbacks().some((f) => f.kind === 'skill.cast.level'));
  clearFallbacks();
  ok('skillId 不在身份表 ⇒ unknownSkill，且**降级可见**',
    noTargetCastBlock(0x999999, 'pikeman', false) === 'unknownSkill'
    && fallbacks().some((f) => f.kind === 'skill.cast.identity'));

  // 村庄判据 = field.cpp 的 Field State（唯一实现 isVillageMap）；不许拿 isSafeMap 近似
  ok('村庄判据用 isVillageMap（3/21 两张图）', isVillageMap(3) && isVillageMap(21) && !isVillageMap(9) && !isVillageMap(29));
  ok('mapLightProfile 与 isVillageMap 同一份表（不重复实现）',
    /village: isVillageMap\(mapId\)/.test(mapLightSrc) && !/VILLAGE_IDS\.has\(mapId\)/.test(mapLightSrc.replace(/return VILLAGE_IDS\.has\(mapId\);/, '')));
  ok('mapLightProfile(3).village 一致', mapLightProfile(3).village && !mapLightProfile(9).village);
  ok('技能闸门用的是 isVillageMap，**不是** isSafeMap（近似判据禁用）',
    /isVillageMap\(currentMapId\)/.test(noTarget) && !/isSafeMap/.test(noTarget)
    && /isVillageMap\(currentMapId\)/.test(bodyOf(wv, 'function playEquippedSkill(')));
  ok('村庄里"这一击退化成普通攻击"（原版 playmain.cpp:2316 的 lpAttackSkill = 0 ⇒ 不发技能包）',
    /if \(it\.kind === 'normal' \|\| isVillageMap\(currentMapId\)\) return playSkillByIcon\('skill_normal', aim\);/.test(wv));
  // 2026-09-24 加：unknown/invalid **不放**（旧写法 `!fs || village` 会把"异职业绑定"也退成普攻 = 兜底）
  ok('绑定表没到 / 绑的不是本职业 ⇒ **这一击不放**（不退化普攻）',
    /if \(it\.kind === 'unknown' \|\| it\.kind === 'invalid'\) return false;/.test(wv));
  // 2026-09-24 改：用哪只拳**由"选中目标的那个键"决定**（原版 `SelMouseButton → pLeftSkill/pRightSkill`，
  // `playmain.cpp:2303-2313`），不再是硬编码左拳 —— 右键选的目标要放右拳技能。
  ok('追打循环逐次出手照同一个意图（村庄 ⇒ 普攻；unknown/invalid ⇒ 本轮不起手；拳位由 selfAttackSlot 决定）',
    /const it = isVillageMap\(currentMapId\) \? \{ kind: 'normal' as const \} : fistIntent\(selfAttackSlot\);/.test(stripComments(wv))
    && /const bindBroken = it\.kind === 'unknown' \|\| it\.kind === 'invalid';/.test(wv)
    && /if \(!busy && !bindBroken && !mpBlocked && animState/.test(wv)
    && /const mpBlocked = it\.kind === 'skill' && castResourceBlocked\(it\.skillId\);/.test(wv));

  // 边界必须写在代码注释里（"明确只做到名单级"，不是"没做"）
  ok('模块头注释写明未实现项（MP/SP、武器要求、互斥、CD、逐 case 守卫）',
    /MP \/ SP/.test(noTargetSrc) && /未实现/.test(noTargetSrc) && /case/.test(noTargetSrc));
}

console.log('④ 名单生成物 == 源码重算（scripts/openplay-scan.ts 是唯一扫描实现）');
{
  const REF = resolve(root, '.refsrc/tree/SkillSub.cpp');
  ok('参考源 .refsrc/tree/SkillSub.cpp 可见（`.refsrc/` 是 gitignore 的参考源目录）', existsSync(REF));
  if (existsSync(REF)) {
    const src = readFileSync(REF, 'latin1');
    const scan = scanOpenPlayCases(src);
    const dist = scanSkillDistRangeCases(src);
    const GEN = JSON.parse(readFileSync(resolve(root, 'src/game/data/source/skill-openplay-macros.json'), 'utf8')) as {
      count: number; funcLine: number; funcEndLine: number; switchLine: number; switchEndLine: number;
      macros: Array<{ macro: string; line: number }>;
    };
    ok(`重算条数一致（源码 ${scan.cases.length} == 生成物 ${GEN.count}）`, scan.cases.length === GEN.count && GEN.count === 65);
    ok('宏名逐条一致（含出现顺序）',
      scan.cases.length === GEN.macros.length
      && scan.cases.every((c, i) => c.macro === GEN.macros[i]!.macro));
    ok('行号逐条一致', scan.cases.every((c, i) => c.line === GEN.macros[i]!.line));
    ok(`边界行号一致（函数 ${scan.funcLine}-${scan.funcEndLine} / switch ${scan.switchLine}-${scan.switchEndLine}）`,
      scan.funcLine === GEN.funcLine && scan.funcEndLine === GEN.funcEndLine
      && scan.switchLine === GEN.switchLine && scan.switchEndLine === GEN.switchEndLine);
    ok('函数体内没有漏掉的 case（switch 闭合后到函数闭合前为 0 条）', scan.nestedCases.length === 0);
    ok('同文件 GetSkillDistRange（射程表）是**另一个函数**里的另一个 switch（不是嵌套）',
      dist.funcLine > scan.funcEndLine);
    // "为什么是 65 不是 57"：行号窗口会切掉 switch 尾部这 8 条
    const tail = ['SKILL_R_KNIGHT', 'SKILL_A_MIDRANDA', 'SKILL_M_PRAY', 'SKILL_S_SHOCK',
      'SKILL_INPES', 'SKILL_BLIND', 'SKILL_POLLUTED', 'SKILL_DISTORTION'];
    const names = new Set(GEN.macros.map((m) => m.macro));
    ok(`switch 尾部那 8 条在名单里（行号窗口切到 1200 会漏掉它们 ⇒ 那才是"57 条"的来源）`,
      tail.every((t) => names.has(t)));
    ok('名单里没有射程表专属的分支（SKILL_MECHANIC_BOMB 等只在 GetSkillDistRange 里）',
      ['SKILL_MECHANIC_BOMB', 'SKILL_SPARK', 'SKILL_TORNADO'].every((t) => !names.has(t)));
    // 与我方 220 行 join：覆盖率 100%（对不上的必须逐条列出，见生成器输出）
    const TBL = JSON.parse(readFileSync(resolve(root, 'src/game/data/skill-tables.generated.json'), 'utf8')) as {
      skills: Array<{ macro: string | null }>;
    };
    const byMacro = new Map<string, number>();
    for (const r of TBL.skills) if (r.macro) byMacro.set(r.macro, (byMacro.get(r.macro) ?? 0) + 1);
    const missing = [...names].filter((m) => !byMacro.has(m));
    const dup = [...names].filter((m) => (byMacro.get(m) ?? 0) > 1);
    ok(`名单 ${names.size} 条全部能按 macro 对上我方 220 行（对不上 ${missing.length}）`, missing.length === 0);
    ok('且每条只对上一行（无歧义 join）', dup.length === 0);
    if (missing.length) console.log(`      ${missing.join(', ')}`);
  }
}

console.log('⑤ 角标 L/R 定位（panels.css）');
// 极简 CSS 解析：去注释 → 收集每条规则的选择器与声明块
const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules: { sel: string; decl: string }[] = [];
for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  for (const sel of m[1].split(',')) rules.push({ sel: sel.trim(), decl: m[2] });
}
const declOf = (sel: string): string => rules.filter((r) => r.sel === sel).map((r) => r.decl).join(';');
const hasProp = (decl: string, prop: string): boolean => new RegExp(`(^|;)\\s*${prop}\\s*:`).test(decl);
const leftDecl = declOf('.jp-skill-fistbadge--left');
const rightDecl = declOf('.jp-skill-fistbadge--right');
ok('两个角标类都有 CSS 规则（原先一个都没有 ⇒ 用户看到的"R 压 L"）', leftDecl !== '' && rightDecl !== '');
ok('L 只按左定位（left，且不设 right）', hasProp(leftDecl, 'left') && !hasProp(leftDecl, 'right'));
ok('R 只按右定位（right，且不设 left）', hasProp(rightDecl, 'right') && !hasProp(rightDecl, 'left'));
ok('左右定位值相同（对称贴角，不偏向任何一侧）',
  /left:\s*([^;]+);/.exec(leftDecl)![1].trim() === /right:\s*([^;]+);/.exec(rightDecl)![1].trim());
ok('基类有 position:absolute（否则"贴角"无从谈起）', hasProp(declOf('.jp-skill-fistbadge'), 'position'));
ok('定位容器 .jp-skill-iconbox 是 position:relative（绝对定位以格子为界、不溢出）',
  hasProp(declOf('.jp-skill-iconbox'), 'position'));
ok('F1~F8 角标也有定位规则（三枚角标各占一角，互不压住）', hasProp(declOf('.jp-skill-keybadge'), 'position'));

console.log('⑥ HUD 拳位同步');
const loadFist = bodyOf(hud, 'async function loadFistIcon(');
ok('HUD 不对拳位图标路径做百分号编码（编码只归 encodeAssetPath）', !/encodeURIComponent/.test(loadFist));
ok('HUD 直接拼原始相对路径（空格原样留给 encodeAssetPath）',
  /rel: `skill\/\$\{intent\.row\.classDir\}\/button\/\$\{intent\.row\.iconFile\.replace/.test(hud));
ok('加载失败走 reportFallback（降级可见）',
  /reportFallback\('hud\.fistIcon'/.test(loadFist));
// 2026-09-24 收紧：**只有"未绑"才画默认拳头**（原版普攻格 `UseSkill[0]` 的规格，不是我们的降级），
// "绑了但图标取不到 / 异职业绑定 / 绑定表没到"一律**不画** —— 旧写法把它们全画成默认拳头 = 兜底。
ok('未绑（normal）才画默认拳头，且是显式分支', /kind === 'normal'\) drawTex\('fist'/.test(hud));
ok('非 skill 视图（unknown/invalid）⇒ 删纹理（不画）',
  /if \(view\.kind !== 'skill'\) \{\n      delete textures\[key\];/.test(loadFist));
ok('draw 里**没有**"取不到就画 fist"的三元兜底（去注释后断言 —— 注释里正讲了旧写法）',
  !/textures\['fistL'\] \? 'fistL' : 'fist'/.test(stripComments(hud))
  && !/textures\['fistR'\] \? 'fistR' : 'fist'/.test(stripComments(hud)));
ok('成功后写入纹理键（fistL/fistR）', /if \(tex\) textures\[key\] = tex;/.test(loadFist));
ok('HUD 每帧 draw ⇒ 换纹理下一帧即生效（loop → draw → rAF）',
  /function loop\(\) \{\n    draw\(\);\n    checkButtonClick\(\);\n    rafId = requestAnimationFrame\(loop\);/.test(hud));
ok('绑定由服务端下发、可能早于 HUD 建成 ⇒ 创建时主动 syncFists 一次',
  /const unsubFist = subscribeGame\(syncFists\);\n(?:.|\n)*?\n  syncFists\(\);/.test(hud));

console.log('⑦ encodeAssetPath 口径（双重编码 = 根因）');
const raw = '/res/image/sinimage/skill/fighter/button/tf10 m_mastery.bmp';
const enc = encodeAssetPath(raw);
ok('单次编码：空格 → %20、不出现 %25', enc.includes('%20') && !enc.includes('%25'));
ok('单次编码可被服务端一次解码回原路径（文件才找得到）', decodeURIComponent(enc) === raw);
ok('再编一次产出 %2520（这正是原先 HUD 的请求，dev 中间件解不回文件名 → index.html）',
  encodeAssetPath(enc).includes('%2520') && !existsSync(enc));
// 真实资产存在性（部署机资产根不同 → 明确 skip，不当成通过）
const envTxt = await readFile(new URL('../.env', import.meta.url), 'utf8').catch(() => '');
const assetRoot = /^\s*VITE_ASSET_ROOT\s*=\s*(.+)$/m.exec(envTxt)?.[1].trim();
if (assetRoot && existsSync(assetRoot + '/image/sinimage/skill/fighter/button')) {
  const p = `${assetRoot}/image/sinimage/skill/fighter/button/tf10 m_mastery.bmp`;
  ok('该图标在资产根里真实存在（"能点开"级证据）', existsSync(p));
} else {
  console.log('  · 资产根不可见（VITE_ASSET_ROOT 不是本机资产）→ 跳过文件存在性检查');
}

console.log(fails === 0 ? '\nPASS' : `\nFAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
