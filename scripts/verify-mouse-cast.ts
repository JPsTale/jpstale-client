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
 *  ⑧ **CD / 熟练度**（2026-09-24 用户报“CD 完全不受熟练度影响”）：
 *     ⓐ CD 时长按源码 `CheckSkillMastery` **逐帧离散**复算（`Mastery 70/35/20/10/5/1` 六个锚点）；
 *     ⓑ 熟练度必须是**服务端派生的 `UseSkillMastery`**（含 `Talent/3×100`，元素技能恒满）；
 *     ⓒ 面板两条竖条：**高 = 图标高 44**（不伸到 `+ 学习`）、熟练度条可 hover 且提示自绘；
 *     ⓓ 一个技能只在**一只拳**上（服务端写入时清另一侧；客户端如实显示 `both`）。
 *
 * 用法：`npm run verify-mouse-cast`
 */
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeAssetPath } from '../src/core/texture.js';
import { skillCooldownMs } from '../src/game/skillCost.js';
import { fistSlotOfSkill } from '../src/game/skillBinding.js';
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
  before(mouseDown, 'tryNoTargetCast()', 'monsterUnderCursor(e.clientX,'));
// 2026-09-24 改（用户实测："近战应该跟普攻一样跑到目标身边再攻击，而不是原地施法"）：
// 点怪**不再当场施法** —— 原版这一岔是 `SelMouseButton = 1/2; TraceAttackPlay()`（`Winmain.cpp:2994-2996`），
// 技能由攻击循环在攻击距离内逐次放出（`playmain.cpp:2474` 的 `PlaySkillAttack(lpAttackSkill, …)`）。
ok('点怪**不当场施法**（交给追打循环在射程内放），且记住"用哪只拳"',
  /const aim = monsterUnderCursor\(e\.clientX, e\.clientY\);/.test(mouseDown)
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
// 2026-09-24 改（用户实测"左键点击也变了施法"）：光标判定**不再要求"该拳有技能"** ——
// "用哪只拳"由按下的键决定（`SelMouseButton → pLeftSkill/pRightSkill`），左拳是普攻时也要记下"用左拳"，
// 否则追打循环会沿用上一次的右拳（就是那个 bug）。判据只剩"光标下是怪不是空地"。
ok('光标判定只看"是不是怪"（与该拳绑没绑技能无关；与点击共用同一套判定）',
  /function monsterUnderCursor\(cx: number, cy: number\): THREE\.Object3D \| null \{/.test(wv)
  && /const tag = nameplateTargetAt\(cx, cy\) \?\? pickTargetAt\(cx, cy\);/.test(wv)
  && /if \(!tag \|\| tag\.kind !== 'monster'\) return null;/.test(wv)
  && !/if \(!fistSkillOf\(slot\)\) return null;/.test(wv));
// 2026-09-24 改：绑定身份换成**数字 skillId**，判定搬进 `game/skillBinding.ts`（唯一实现）。
// 这两条比旧写法**更严**：旧的 `bind.classDir !== (CLASS_DIR[selfJobId] ?? 'fighter')` 是兜底
// （职业没下发就拿 fighter 去比），新写法查不到职业 ⇒ 不解析（invalid）。
ok('身份判定只此一处：`fistSkillOf` 走 `fistIntent`（读服务端绑定表 + 角色职业）',
  /function fistSkillOf[\s\S]{0,400}?const it = fistIntent\(slot\);/.test(wv)
  && /function fistIntent\(slot: 'left' \| 'right'\): FistIntent \{[\s\S]{0,200}?fistIntentOf\(snap\.skillBindings, snap\.character\?\.job \?\? null, slot\)/.test(wv));
ok('**没有职业兜底**：施法链上不再出现 `?? \'fighter\'`（缺职业 ⇒ invalid/unknown，不放）',
  !/\?\? 'fighter'/.test(stripComments(wv)));
ok('瞄准改用**点击这一下自己的判定**（不再读 15Hz 滞后的 `hoverTarget`；用户实测"点得到怪却没音"的一类）',
  !/hoverTarget/.test(stripComments(bodyOf(wv, 'function monsterUnderCursor('))));
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
    && /if \(!busy && !bindBroken && !rightSkillBlocked && animState/.test(wv)
    && /const rightSkillBlocked = skillBlock != null && selfAttackSlot === 'right';/.test(wv));

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
  /const base = `skill\/\$\{intent\.row\.classDir\}\/button\/\$\{intent\.row\.iconFile\.replace/.test(hud));
// 2026-09-24 加（原版 `sinSkill.cpp:570-573` 装 `Button\<File>_.bmp`、`:736-742` 不可用时画它）：
// 灰版图标 = 同目录同名 + `_` 尾巴；不可用时画它（不是把彩色图调暗那种自造做法）。
ok('灰版图标走原版命名（`<图名>_.bmp`），且只在不可用时画',
  /relGray: `\$\{base\}_.bmp`/.test(hud)
  && /gray && textures\[keyGray\]\) drawTex\(keyGray/.test(hud));
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

/* ⚠ 这里**原来就**写着 PASS/exit，而后面还有三段断言 ⇒ 那三段从来没跑过（AGENTS #74 的“假守卫”）。收尾已挪到文件末尾。 */

/* ── ⑧ CD / 熟练度（2026-09-24 用户报“CD 完全不受熟练度影响”）─────────────────────────────
   两条根因，各钉一组断言：
   a) CD 时长原先写的是**推导**出来的连续近似（`Mastery × 35/120`）—— 源码是**逐帧**累加
      （`sinSkill.cpp:2025-2075`：`TempLenght = (int)(35/(Mastery/2))`、每 `(int)(35/TempLenght)` 帧
      `GageLength++`，而 `CheckSkillMastery` 由 `MainSub()` 每帧调用、同一函数里 `sinMainCounter % 70`
      就是 1 秒 ⇒ 70fps）。这里对 6 个 Mastery 值复算**真值**：17.5 / 8.5 / 5.5 / 2.5 / 1.0 / 0.5 秒。
   b) 熟练度用的是**存下来的原始计数**（`skill.<id>.mastery`），漏了源码里的 `Talent/3×100`（最多 +5000）
      ⇒ `Mastery` 被 70 档吃掉、CD 恒定。派生改到服务端唯一实现（`SkillRules.useSkillMastery`），
      下发的那一列就是派生值 —— 这里断言“客户端不自己再派生一遍”（AGENTS #15：判定只写一份）。 */
console.log('⑧ CD 时长（源码逐帧复算）与熟练度派生');
{
  const costSrc = await read('../src/game/skillCost.ts');
  const pikeWind = 0x040101;               // pikeman 槽 1（RequireMastery = [80,4]，element0 = 0）
  // `mastery` = 派生后的 UseSkillMastery；反推某档 Mastery 所需的熟练度：m = rm0 + rm1*point − mastery/100
  const masteryForMastery = (m: number, point: number): number => (80 + 4 * point - m) * 100;
  const anchors: [number, number][] = [[70, 17.5], [35, 8.5], [20, 5.5], [10, 2.5], [5, 1.0], [1, 0.5]];
  for (const [m, sec] of anchors) {
    const frames = Math.max(1, Math.floor(35 / Math.floor(70 / m)));
    const ms = skillCooldownMs(pikeWind, 1, masteryForMastery(m, 1));
    ok(`Mastery ${m} → ${sec}s（源码：35 格 × ${frames} 帧 ÷ 70fps）`,
      ms != null && Math.abs(ms - sec * 1000) < 1);
  }
  ok('熟练度越高 CD 越短（单调不增）—— 用户报的正是“完全不变”',
    anchors.map(([m]) => skillCooldownMs(pikeWind, 1, masteryForMastery(m, 1))!)
      .every((v, i, a) => i === 0 || v <= a[i - 1]!));
  ok('CD 表取不到 ⇒ null（不编一个时长出来）', skillCooldownMs(pikeWind, 0, 0) === null);
  ok('Mastery 被钳在 [1,70]（`:2073-2074`）：熟练度极大 ⇒ 夹到 1（CD 最短）、满熟练度不会算出负时长',
    skillCooldownMs(pikeWind, 1, 1e9) === skillCooldownMs(pikeWind, 1, masteryForMastery(1, 1))
    && skillCooldownMs(pikeWind, 10, 0)! > 0);
  // 派生只写一份：客户端**不许**再抄一遍 Talent 项
  ok('客户端不再自己派生熟练度（`derivedMastery` / `Talent / 3` 不在客户端源码里）',
    !/derivedMastery/.test(stripComments(costSrc)) && !/[Tt]alent\s*\/\s*3/.test(stripComments(costSrc)));
  const srv = (rel: string): Promise<string> => readFile(
    new URL('../../jpstale-server/' + rel, import.meta.url), 'utf8');
  const svcSrc = await srv('apps/game-server/src/main/java/org/jpstale/server/game/service/SkillPointService.java');
  const rulesSrc = await srv('modules/common-service/src/main/java/org/jpstale/common/service/skill/SkillRules.java');
  ok('服务端下发派生值（`buildSkillList` 走 `SkillRules.useSkillMastery`）',
    /setMastery\(SkillRules\.useSkillMastery\(/.test(svcSrc));
  ok('派生的三处输入逐字照抄源码（Talent/3 + fMagic_Mastery、×100 + 计数、Element ⇒ 10000）',
    /TALENT_TERM_MAX\s*=\s*50/.test(rulesSrc) && /talentTerm \* 100 \+ stored/.test(rulesSrc)
    && /element0\(\) != 0[\s\S]{0,60}return MASTERY_MAX/.test(rulesSrc));
  ok('`Element[0]` 取值不取 Brazil（那份 198 条里 136 条写 1，与 English/Chinese 冲突）',
    /element0Src/.test(await read('../src/game/skillIdentity.ts')));
  // `RequireMastery` 同样不取 Brazil：巴西对 7 个高阶技能的 `[0]` 写 0（配合 element=1 ⇒ CD 0.5 秒）。
  // 锚点用旋风斩（fighter 槽 15）：English/Chinese 都写 135、Brazil 写 0 ⇒ 取 English 后 CD = 8.5 秒。
  const cyclone = 0x010403;   // fighter 4 转档 4 槽（SKILL_CYCLONE_STRIKE）
  ok('高阶技能的 `RequireMastery` 取 English（旋风斩 rm=[135,0] ⇒ 满熟练度下 CD 8.5s，而非巴西的 0.5s）',
    Math.abs((skillCooldownMs(cyclone, 1, 10000) ?? -1) - 8500) < 1);
  ok('没有 `RequireMastery` 的行（5 转 60 行）⇒ CD 返回 null（未知，不编档位）',
    skillCooldownMs(0x010501, 1, 10000) === null);
}

console.log('⑨ 面板两条竖条（位置/高度/hover）与“一技能一位置”');
{
  const barDecl = declOf('.jp-skill-bar');
  const barsDecl = declOf('.jp-skill-bars');
  const panelSrc = await read('../src/ui/react/SkillPanel.tsx');
  ok('两条竖条在格子**外**（`.jp-skill-cellwrap` 包住格子 + 竖条）',
    /className="jp-skill-cellwrap"/.test(panelSrc) && hasProp(declOf('.jp-skill-cellwrap'), 'display'));
  ok('竖条**高 = 图标高 44**（不跟格子高 ⇒ 不会伸到临时的 `+ 学习` 按钮）',
    /height:\s*44px/.test(barDecl) && !hasProp(barDecl, 'align-self')
    && /align-items:\s*flex-start/.test(barsDecl));
  ok('熟练度条可 hover（`pointer-events` 开着 + 命中区加宽）',
    /pointer-events:\s*auto/.test(declOf('.jp-skill-bar--mastery'))
    && declOf('.jp-skill-bar--mastery::after') !== '');
  ok('hover 提示是**自绘**的（`jp-skill-bartip`，不是原生 title）',
    /className="jp-skill-bartip"/.test(panelSrc) && /skills\.mastery/.test(panelSrc));
  ok('粉色条 = `Element[0] != 0`（源码 `:839` 的 `Gage-5.bmp`），不再按 tier 猜',
    /const elite = element0 !== 0;/.test(panelSrc) && !/tier >= 5/.test(stripComments(panelSrc)));
  ok('客户端 `fistSlotOfSkill` 不再“先左后右”（两只都有 ⇒ 显式 both + 上报）',
    /onLeft && onRight/.test(await read('../src/game/skillBinding.ts'))
    && fistSlotOfSkill({ fistLeft: 7, fistRight: 7, quick: [] }, 7) === 'both'
    && fistSlotOfSkill({ fistLeft: 0, fistRight: 7, quick: [] }, 7) === 'right');
  const bindRules = await readFile(new URL(
    '../../jpstale-server/modules/common-service/src/main/java/org/jpstale/common/service/skill/SkillBindRules.java',
    import.meta.url), 'utf8');
  ok('服务端绑一只拳时清掉另一侧的同名技能（原版一个技能只有一个 `MousePosi`）',
    /PlayerKey\.fistBind\(other\)/.test(bindRules));
}

// ── 技能面板：**不得再有原生 `title`**（2026-09-24 用户实测"两层 hover，白色的很恶心"）──
// 原生 tooltip 由浏览器画（不可样式化、位置不跟随鼠标、会压住自定义面板），面板内所有元素
// 一律走自定义面板（`jp-skill-tip`）；无障碍名用 `aria-label`。
// ⚠ 允许的例外：提示面板**内部**的武器图标（`jp-skill-tip-wicon` 的 `title` = 族名图例）——
//   它只在"特意悬停那个小图标"时出现，不与面板抢位；`+学习` 按钮与两个格子都必须没有。
{
  const panel = await read('../src/ui/react/SkillPanel.tsx');
  const titles = [...panel.matchAll(/^\s*title=\{([^}]*)\}/gm)].map((m) => m[1]);
  ok('技能面板里**一个原生 title 都没有**（用户 2026-09-24：两层 hover 恶心；后来连武器图例那处也删了）',
    titles.length === 0, `实测 title 处数 ${titles.length}: ${titles.join(' | ')}`);
  ok('无障碍名留在 alt / aria-label 上（不画出来）：技能图标 alt、普攻格与两条竖条 aria-label',
    /alt=\{displayName\}/.test(panel)
    && /aria-label=\{\`\$\{t\('skills.normalAttack'\)\}/.test(panel)
    && /aria-label=\{\`\$\{t\('skills.mastery'\)\}/.test(panel))
}

// ── HUD 的 **CD 弧**（用户三轮纠正后的结论，2026-09-24）──
// 事实链：
//   · **形状 = 弧**、**有技能的拳常显**（CD 中从下往上长）、**普通攻击不画**（用户真机口径）；
//     ⛔ 反例：我上一版加了 `progress >= 1 就不画` 的早退 —— 那是"只在 CD 中显示"，与"常显"不符；
//   · **资产 = `p-skill.bmp`/`p-skill2.bmp`**（16×41 左右镜像）—— 源码侧只有"创建不绘制"的痕迹
//     （`MatCircleIcon = keep\GA_Mon.tga`，`sinSkill.cpp:489`），HUD 那圈的绘制代码两份源码都缺，
//     故依据 = 资产形态 + 用户观察；
//   · **位置 = 实测几何**（不是猜）：图标圆心 (24.0,22.5)、弧曲率中心 左(22.1,20.6)/右(−7.1,20.6)、
//     半径 20.2 ⇒ 让曲率中心对齐图标圆心 ⇒ 左 dx=1.9 / 右 dx=31.1、dy=1.9（见 `Hud` 的常量注释）；
//   · **画法 = 裁切式**（只显形底部 ratio，不缩放、不铺底影）；
//   · **顺序 = 主 HUD 底图 `menu1/menu2` 之后**（图标必须在底图前才有圆孔效果，弧跟着画会被盖住）。
{
  const hud = await read('../src/ui/Hud.ts');
  const menuAt = hud.indexOf("drawTex('menu1'");
  const gageAt = hud.indexOf("drawFistGage('left'");   // 取**调用点**：ident 的首次出现是函数定义（在文件前面）
  ok('HUD 的 CD 用**弧**资产（`p-skill`/`p-skill2`）', /gageL: 'skill\/p-skill\.bmp'/.test(hud)
    && /gageR: 'skill\/p-skill2\.bmp'/.test(hud));
  ok('弧**常显**（有技能就画，不因"CD 已满"而早退）',
    /if \(view\.kind !== 'skill'\) return;\s*\/\/ 普通攻击/.test(hud)
    && !/if \(progress >= 1\) return;/.test(hud));
  // 位置**逐字来自原版**（`sinInterFace.cpp:629/635` 的硬编码屏幕坐标 338 / 446、y 542，贴图 16×41）
  ok('弧的位置 = 原版硬编码坐标（左 338 / 右 446，y 542，16×41）',
    /const GAGE_LEFT_X = 338;/.test(hud) && /const GAGE_RIGHT_X = 446;/.test(hud)
    && /const GAGE_TOP_Y = 542;/.test(hud) && /const GAGE_W = 16;/.test(hud)
    && /const GAGE_H = 41;/.test(hud));
  ok('弧是**裁切式**画（不缩放、无底影）',
    /function drawArc\(name: string/.test(hud)
    && /ctx\.drawImage\(t\.el, 0, t\.h - shown, t\.w, shown/.test(hud));
  ok('弧画在主 HUD 底图之后（否则被底图盖住 → 完全看不见）', menuAt > 0 && gageAt > menuAt);
}
// ── CD 条的**绘制顺序**：必须在主 HUD 底图（menu1/menu2）之后 ──
// 拳位图标要画在底图**之前**（底图的圆孔镂空才能露出图标 = "圆形槽内图标"），但 CD 条的 GageRect
// (349,558)/(446,558) 5×35 **落在底图覆盖区内** ⇒ 跟着图标一起画就完全看不见
// （用户 2026-09-24 实测"根本就不显示CD"）。原版顺序同理：`cSkill.Draw()`→`cInvenTory.Draw()`→`cInterFace.Draw()`（`sinMain.cpp:186/198/219`）。
{
  const hud = await read('../src/ui/Hud.ts');
  const menuAt = hud.indexOf("drawTex('menu1'");
  const gageAt = hud.indexOf("drawFistGage('left'");   // 取**调用点**：ident 的首次出现是函数定义（在文件前面）
  ok('CD 条画在主 HUD 底图之后（否则被底图盖住 → 完全看不见）',
    menuAt > 0 && gageAt > menuAt);
}
// ── 技能面板：**格子右侧的两条竖条**（熟练度 / CD）与四种状态（用户 2026-09-24 定版）──
// 口径：① 在格子**之外**、紧贴右侧；② **与格子齐高**；③ 未学 ⇒ 灰；④ 精英（5 转）⇒ 熟练度位粉色实条；
//      ⑤ 其余：熟练度绿 / CD 金；⑥ CD 用与 HUD 同一个 `skillCdProgress`，且**不能用定时器轮询**
//      （150ms 轮询会让面板比 HUD 弧慢半拍 —— 用户实测"CD 不同步"）⇒ 必须 rAF。
// 颜色全部取自原版资产实测（`Gage-2/-3/-4/-5/Gage`），只借颜色与语义、不套位图。
{
  const panel = await read('../src/ui/react/SkillPanel.tsx');
  const css = await read('../src/ui/react/panels.css');
  ok('两条竖条在**格子之外**、紧贴右侧', /className="jp-skill-cellwrap"/.test(panel)
    && /<SkillBars learned=/.test(panel) && /function SkillBars\(/.test(panel)
    && /\.jp-skill-cellwrap \{[\s\S]{0,120}?gap: 2px;/.test(css));
  // 「竖条与格子齐高」2026-09-24 被用户推翻（**不许伸到 `+ 学习`**）⇒ 断言挪到 ⑨（高 = 图标高 44）
  ok('**未学 ⇒ 灰**（`--grey`，配色 = `Gage-4.bmp` 实测 rgb(123,123,123)）',
    /!learned \? 'jp-skill-bar--grey'/.test(panel) && /rgb\(123,123,123\)/.test(css));
  // 「5 转 ⇒ 粉」也改了：粉的**判据是 `Element[0]`**（源码 `sinSkill.cpp:839`），断言在 ⑨
  ok('CD 用与 HUD 同一个 `skillCdProgress`，且**用 rAF 不用定时器**（否则与 HUD 弧不同步）',
    /skillCdProgress\(skillId\)/.test(panel) && /requestAnimationFrame\(loop\)/.test(panel)
    && !/setInterval\(/.test(panel));
  ok('百分比仍在 hover 面板里显示（`skills.mastery`）', /t\('skills\.mastery'\)/.test(panel));
}

/* ── 收尾（**必须**在最后：上面每一段都可能是新的断言块，
   早期版本把 exit 写在中间 ⇒ 后面三段断言从未执行）── */
console.log(fails === 0 ? '\nPASS' : `\nFAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
