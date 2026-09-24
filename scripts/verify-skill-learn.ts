/**
 * 技能面板「加点」（真发包 `C2S_LearnSkill`）的护栏检查（`npm run verify-skill-learn`）。
 *
 * ⚠ 2026-09-23 按用户要求删掉了面板里的**调试等级控件**（`.jp-skill-lvdbg` 的 `− n +`）+ 每档右侧的
 * 剩余点 chip（连带 `game/skillDbg.ts` 整个模块）—— 于是"两个 `+` 接错线会静默花钱"这条风险**消失了**：
 * 面板里现在只剩 `+ 学习` 一个加点入口。本脚本相应改写（**不是放宽**）：从"钉住两者没接错"
 * 改成"钉住调试件真的没了、且加点入口唯一"。
 *
 * 四组断言（都只读，失败即非零退出）：
 *   ① 加点按钮调的是 `sendLearnSkill`（唯一调用点，且只用数字 `skillId`）；
 *   ② 调试等级控件/调试工具条/`skillDbg.ts` **全仓不存在**（删干净，不留无人引用的分支）；
 *   ③ 跑**真模块** `game/skillLearn.ts` 逐条验禁用条件：表没到 / 该池 0 点 / 已满 10 级 / 身份查不到，
 *      外加"两个池不合并"（1–3 转池有点不代表 4 转池有点）；
 *   ④ `skill.op.*` 文案在 zh/en **成对齐全**，且**逐个原因码**覆盖服务端 `SkillRules.Reason`
 *      （服务端加一个原因码而客户端漏文案时，这里立刻红 —— 否则玩家看到的是原始 key）。
 *
 * 服务端仓库位置：默认 `<客户端仓库>/../jpstale-server`，可用 `PT_SERVER_ROOT` 覆盖；
 * 找不到时**报告跳过交叉核对**（本地两份语言表的成对性仍照查，不放宽）。
 */
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDomStub } from './dom-stub.js';

let fails = 0;
const ok = (label: string, cond: boolean): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};
// ⚠ 源文件是 CRLF：多行断言前先归一成 `\n`
const read = async (rel: string): Promise<string> => (await readFile(new URL(rel, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** 去掉 `//` 与块注释 —— "只出现 N 次"这类计数必须排除注释里的提及 */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** 取 `marker` 之后到 `end` 之前的一段（任一缺失 → 空串） */
function sliceBetween(src: string, marker: string, end: string): string {
  const i = src.indexOf(marker);
  if (i < 0) return '';
  const j = src.indexOf(end, i + marker.length);
  return j < 0 ? src.slice(i) : src.slice(i, j);
}

/** 子串出现顺序（`a` 必须在 `b` 之前；任一缺失即 false） */
const before = (s: string, a: string, b: string): boolean => {
  const i = s.indexOf(a), j = s.indexOf(b);
  return i >= 0 && j >= 0 && i < j;
};

const panel = await read('../src/ui/react/SkillPanel.tsx');
const panelCode = stripComments(panel);
const css = await read('../src/ui/react/panels.css');

console.log('① 加点按钮 → sendLearnSkill（唯一调用点）');
const learnBtn = sliceBetween(panel, 'className="jp-skill-learn"', '</button>');
ok('面板里有 `+ 学习` 这个真加点按钮（`.jp-skill-learn`）', learnBtn !== '');
ok('它的 onClick 走 `onLearn(gate.skillId)`（**只发数字 skillId**，不发图标名/面板下标）',
  /onClick=\{\(e\) => \{ e\.stopPropagation\(\); if \(gate\.skillId != null\) onLearn\(gate\.skillId\); \}\}/.test(learnBtn));
ok('它 disabled 直接来自加点预判 `!gate.canLearn`（三条件都由 `game/skillLearn.ts` 一处判）',
  /disabled=\{!gate\.canLearn\}/.test(learnBtn));
ok('点它不会顺手把技能绑到拳上（pointerdown 已 stopPropagation）',
  /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/.test(learnBtn));
ok('`sendLearnSkill` 全仓只在面板里出现 1 次（去注释后计数 = 1 ⇒ 没有第二份接线）',
  (panelCode.match(/sendLearnSkill\(/g) ?? []).length === 1);
ok('那 1 次就是喂给 `onLearn`：`onLearn={(id) => sendLearnSkill(id)}`',
  /onLearn=\{\(id\) => sendLearnSkill\(id\)\}/.test(panelCode));
ok('组件拿到的是 `gate={learnGate(s.iconFile)}`（图标 = 面板与身份表共用的键）',
  /gate=\{learnGate\(s\.iconFile\)\}/.test(panel));

console.log('② 技能等级调试控件已整体移除（用户 2026-09-23：'+'"加减号以及数字控件是过去调试用的，应该去掉"）');
{
  const { existsSync } = await import('node:fs');
  ok('面板里不再有调试等级控件（`.jp-skill-lvdbg` / `onChangeLevel` / `dbgLv` 全为 0 处）',
    !/jp-skill-lvdbg|onChangeLevel|dbgLv/.test(panel));
  ok('调试工具条也没了（`.jp-skill-dbgbar` 0 处 —— 去掉 ± 后它只剩下一个"重置"，留着就是死 UI）',
    !/jp-skill-dbgbar/.test(panel) && !/\.jp-skill-dbgbar/.test(css));
  ok('`game/skillDbg.ts` 已删除（没有 UI 能设值 ⇒ 那条覆盖分支不可达，留着就是没人用的死代码）',
    !existsSync(resolve(root, 'src/game/skillDbg.ts')));
  ok('全仓不再有 `SKILL_DEBUG`（技能等级是它唯一用途；怪物实验室那条路不碰 —— 它本来就不吃这个开关）',
    !/SKILL_DEBUG/.test(panel) && !/SKILL_DEBUG/.test(await read('../src/game/skillLevel.ts')));
  ok('`skillLevel.ts` 不再有"手动等级优先"的覆盖分支（等级只认 `S2C_SkillList`）',
    !/dbgLevel|setDbgLevel/.test(stripComments(await read('../src/game/skillLevel.ts'))));
  ok('面板里唯一的等级数字来源仍是服务端：`skillLevelOf(cell.skillId)` / `skillMasteryOf(...)`',
    /level=\{cell\.skillId != null \? skillLevelOf\(cell\.skillId\) : null\}/.test(panelCode));
  // 真加点按钮必须**不依赖**任何调试开关才渲染：它所在的 SkillCell 函数体（到按钮为止）里不许出现开关
  ok('真加点按钮**不在**任何调试闸门里（它是正式功能，不是调试件）',
    learnBtn !== '' && !stripComments(sliceBetween(panel, 'function SkillCell(props: {', 'className="jp-skill-learn"')).includes('SKILL_DEBUG'));
  ok('真加点按钮仍是格子里唯一的 `+` 控件（`.jp-skill-learn` 1 个、无第二个加减行）',
    (panelCode.match(/className="jp-skill-learn"/g) ?? []).length === 1
    && !/lvdbg|spin-up|spin-down/.test(panel));
}

console.log('③ 禁用条件跑**真模块** `game/skillLearn.ts`');
{
  installDomStub();   // gameStore → item-sounds → sfx 在 import 期就注册 document/window
  const { setSkillList } = await import('../src/app/gameStore.js');
  const { learnGate, skillPoolOfTier, poolFreePoints, MAX_SKILL_POINT } = await import('../src/game/skillLearn.js');
  const { skillIdByIcon } = await import('../src/game/skillIdentity.js');
  const { fallbacks, clearFallbacks } = await import('../src/char/fallback-log.js');

  const TBL = JSON.parse(readFileSync(resolve(root, 'src/game/data/skill-tables.generated.json'), 'utf8')) as {
    skills: Array<{ classDir: string; tier: number; slotInJob: number; skillId: number; iconFile: string }>;
  };
  /** 取该转职档里**图标能一对一解析回本行**的技能（多候选的图标按未学处理，不适合当样本） */
  const pickTier = (tier: number) => TBL.skills.find((r) => r.classDir === 'pikeman' && r.tier === tier
    && skillIdByIcon(r.iconFile) === r.skillId)!;
  const t1 = pickTier(1), t4 = pickTier(4), t5 = pickTier(5);
  ok('样本齐：pikeman 的 T1 / T4 / T5 各有一格（否则下面的池断言无从谈起）',
    t1.tier === 1 && t4.tier === 4 && t5.tier === 5);

  ok(`等级上限 = ${MAX_SKILL_POINT}（与服务端 SkillRules.MAX_POINT 同值）`, MAX_SKILL_POINT === 10);

  // —— 禁用①：表没到 —— 不能假装 0 点（剩余点必须是 null，不是 0）
  clearFallbacks();
  setSkillList(null);
  const g0 = learnGate(t1.iconFile);
  ok('表没到 ⇒ 不可按（block=noList）', !g0.canLearn && g0.block === 'noList');
  ok('表没到 ⇒ 剩余点 `null`（**不是 0**：0 是"明确没点"，会骗人）', g0.free === null && g0.level === null);
  ok('表没到 ⇒ 面板有可见提示（`.jp-skill-warn` + `skills.learnNoList`，不是静默disabled）',
    /jp-skill-warn/.test(panel) && /skills\.learnNoList/.test(panel) && /\.jp-skill-warn/.test(css));

  // —— 禁用②：该池剩余 0 ——
  setSkillList({ learned: {}, skillPoint: 0, specialSkillPoint: 7 });
  const g1 = learnGate(t1.iconFile);
  ok('1–3 转池 0 点 ⇒ 不可按（block=noPoint）', !g1.canLearn && g1.block === 'noPoint' && g1.free === 0);
  const g4 = learnGate(t4.iconFile);
  ok('同一时刻 4 转池有 7 点 ⇒ **T4 可以按**（两个池不合并：合并就会把 T1 也判成能按）',
    g4.canLearn && g4.free === 7 && g4.pool === 'four');
  ok('T5 不属任何池 ⇒ 不可按（block=noPool；服务端会回 slotLocked）',
    !learnGate(t5.iconFile).canLearn && learnGate(t5.iconFile).block === 'noPool'
    && learnGate(t5.iconFile).free === null);

  // —— 禁用③：已到上限 10 ——
  setSkillList({ learned: { [t1.skillId]: { point: 10, mastery: 0 } }, skillPoint: 9, specialSkillPoint: 9 });
  const g10 = learnGate(t1.iconFile);
  ok('已学 10 级 ⇒ 不可按（block=maxPoint），即使点数充足', !g10.canLearn && g10.block === 'maxPoint' && g10.free === 9);

  // —— 放行：有身份 + 有池 + 有点 + 未满 ——
  setSkillList({ learned: { [t1.skillId]: { point: 3, mastery: 0 } }, skillPoint: 5, specialSkillPoint: 0 });
  const gOk = learnGate(t1.iconFile);
  ok('3 级 + 池内 5 点 ⇒ 可以按，且 skillId = 生成物那一行（发出去的就是它）',
    gOk.canLearn && gOk.block === null && gOk.skillId === t1.skillId && gOk.pool === 'one' && gOk.level === 3);

  // —— 禁用④：图标查不到身份（查表内部已 reportFallback）——
  clearFallbacks();
  const gBad = learnGate('__verify_skill_learn_no_such.bmp');
  ok('图标不在身份表 ⇒ 不可按（block=unknownSkill）', !gBad.canLearn && gBad.block === 'unknownSkill' && gBad.skillId === null);
  ok('且**降级可见**（走 `reportFallback`，AGENTS #12）',
    fallbacks().some((f) => f.kind.startsWith('skill.identity')));

  // —— 池映射本身（**判定**仍要：加点闸门按档取池；只有**显示**被删）——
  ok('池映射：tier 1/3 → one、tier 4 → four、tier 5 → null（无池）',
    skillPoolOfTier(1) === 'one' && skillPoolOfTier(3) === 'one'
    && skillPoolOfTier(4) === 'four' && skillPoolOfTier(5) === null);
  setSkillList({ learned: {}, skillPoint: 12, specialSkillPoint: 3 });
  ok('池剩余点按池取（T1 → 1–3 转池 12、T4 → 4 转池 3；无池 → null）',
    poolFreePoints('one') === 12 && poolFreePoints('four') === 3 && poolFreePoints(null) === null);
  ok('**每档右侧的剩余点 chip 已删**（用户 2026-09-23：'+'"最下面本来就会显示技能点数，没必要在每个 rank 后面再额外显示"）',
    !/jp-skill-tierpts|jp-skill-tierrow|poolFreeOfTier/.test(panelCode) && !/\.jp-skill-tierpts/.test(css));
  ok('面板底部两池汇总保留（`.jp-skill-pts` + 两个池各自的文案 key —— 那才是用户认的显示）',
    /className="jp-skill-pts"/.test(panelCode) && /'skills\.ptSpecial'/.test(panelCode.replace(/\s+/g, ' '))
    && /skillList \? skillList\.skillPoint : c\.skillPoint/.test(panelCode));

  setSkillList(null);
}

console.log('④ `skill.op.*` 文案（zh/en 成对 + 逐个原因码覆盖服务端）');
{
  type Table = Record<string, unknown>;
  const load = (p: string): Table => JSON.parse(readFileSync(p, 'utf8')) as Table;
  /** 摊平 `skill.op.*`（本项目只取这一支，与 `i18n/index.ts` 的按 `.` 逐层查同口径） */
  const opKeys = (rel: string): Set<string> => {
    const t = load(resolve(root, rel));
    const op = ((t.skill as Table | undefined)?.op ?? {}) as Record<string, string>;
    return new Set(Object.keys(op));
  };
  const zh = opKeys('src/locales/zh.json');
  const en = opKeys('src/locales/en.json');
  const zhT = (((load(resolve(root, 'src/locales/zh.json')).skill as Table).op) as Record<string, string>);
  const enT = (((load(resolve(root, 'src/locales/en.json')).skill as Table).op) as Record<string, string>);

  ok(`zh / en 的 skill.op.* 条数相同（zh ${zh.size} / en ${en.size}）`, zh.size === en.size && zh.size > 0);
  const missingEn = [...zh].filter((k) => !en.has(k));
  const missingZh = [...en].filter((k) => !zh.has(k));
  ok('两边 key 集合逐条成对（无单边 key）', missingEn.length === 0 && missingZh.length === 0);
  ok('文案都不为空、且不是 key 本身', [...zh].every((k) => (zhT[k] ?? '').trim() !== '' && zhT[k] !== `skill.op.${k}`)
    && [...en].every((k) => (enT[k] ?? '').trim() !== '' && enT[k] !== `skill.op.${k}`));

  // 服务端 Reason 枚举是**唯一真值**：逐个原因码比对（加一个没文案 ⇒ 立刻红）
  const SERVER = process.env.PT_SERVER_ROOT ?? resolve('..', 'jpstale-server');
  const RULES = resolve(SERVER, 'modules/common-service/src/main/java/org/jpstale/common/service/skill/SkillRules.java');
  /** 冻结名单：`SkillRules.Reason` 里 OK 之外的全部 key()（= 客户端必须覆盖的 10 条） */
  const FROZEN = ['unknownSkill', 'noSkillTree', 'wrongJob', 'slotLocked', 'prevNotLearned',
    'levelTooLow', 'maxPoint', 'noSkillPoint', 'noGold', 'resetUsed'];
  if (existsSync(RULES)) {
    const java = readFileSync(RULES, 'utf8');
    const keys = [...java.matchAll(/^ {8}[A-Z_]+\("([a-zA-Z]+)"\),\r?$/gm)].map((m) => m[1]!);
    ok(`从 SkillRules.Reason 扫到 ${keys.length} 个原因码`, keys.length > 0);
    const missing = keys.filter((k) => !zh.has(k));
    const extra = [...zh].filter((k) => !keys.includes(k));
    ok(`服务端每个原因码在 zh/en 都有文案（缺 ${missing.length}：${missing.join(', ') || '无'}）`,
      missing.length === 0 && keys.every((k) => en.has(k)));
    ok(`客户端没有服务端不认识的多余 key（多 ${extra.length}：${extra.join(', ') || '无'}）`, extra.length === 0);
    ok('扫到的原因码与冻结名单一致（服务端加/删码时这条会红，提示同步更新）',
      keys.length === FROZEN.length && FROZEN.every((k) => keys.includes(k)));
  } else {
    console.log(`  · 跳过交叉核对：找不到 ${RULES}（设 PT_SERVER_ROOT 指向服务端仓库）`);
  }
  const missFrozen = FROZEN.filter((k) => !zh.has(k) || !en.has(k));
  ok(`冻结名单 ${FROZEN.length} 条在两份语言表里都有（缺：${missFrozen.join(', ') || '无'}）`, missFrozen.length === 0);
}

console.log('⑤ 熟练度写入：道具「Skill Master(1st/2nd/3rd)」+ GM `/@skill_mastery`');
{
  const SERVER = process.env.PT_SERVER_ROOT ?? resolve('..', 'jpstale-server');
  const readSrv = (rel: string): string => readFileSync(resolve(SERVER, rel), 'utf8');
  const SVC = 'modules/common-service/src/main/java/org/jpstale/common/service/skill/SkillMasteryService.java';
  const HANDLER = 'apps/game-server/src/main/java/org/jpstale/server/game/item/ItemNetworkHandler.java';
  const CHAT = 'apps/game-server/src/main/java/org/jpstale/server/game/service/ChatService.java';
  if (!existsSync(resolve(SERVER, SVC))) {
    console.log(`  · 跳过交叉核对：找不到 ${SVC}（设 PT_SERVER_ROOT 指向服务端仓库）`);
  } else {
    const svc = readSrv(SVC);
    const handler = readSrv(HANDLER);
    const chat = readSrv(CHAT);

    // ① 三颗石头的码位：11 职业 `OpenItem/BI139..141.txt` 的文件名 = Skill Master(1st/2nd/3rd)，
    //    而 `sinInvenTory.cpp:2425-2456` 用 `sinBI1 | sin39/40/41` 分派（紧邻 Aging Master 的 sin36/37/38）。
    const STONES: string[][] = [
      ['STONE_TIER_1', '0x080B3700', '1', '139'],
      ['STONE_TIER_2', '0x080B3800', '2', '140'],
      ['STONE_TIER_3', '0x080B3900', '3', '141'],
    ];
    for (const [constName, code, tier, bi] of STONES) {
      ok(`石头 ${code} → 第 ${tier} 档（与 OpenItem BI${bi}「Skill Master(${tier})」同名互证）`,
        new RegExp(`int ${constName} = ${code}`).test(svc)
        && new RegExp(`case ${constName} -> ${tier};`).test(svc));
    }
    ok('`tierIndexOf` 是**走这条链**的判据（不是按名字/按 family 猜）',
      /public static int tierIndexOf\(/.test(svc) && /tierIndexOf\(it\.getItemCode\(\)\) > 0/.test(handler));
    ok('效果 = 这一档已学技能计数 +10000（原版 `UseSkillCount += 10000`）',
      /Math\.min\(COUNT_MAX, raw \+ COUNT_MAX\)/.test(svc));
    ok('门槛（原版 `CheckMaturedSkill`）：没有可提升的技能 ⇒ 拒绝，且石头**不消耗**',
      /NOTHING_TO_MATURE/.test(svc) && /return Result\.fail\(Reason\.NOTHING_TO_MATURE\)/.test(svc)
      && handler.indexOf('matureTier') < handler.indexOf('pushRemove(session, req.getUid());              // 石头被消耗'));
    ok('被动不参与（原版 `USECODE != SIN_SKILL_USE_NOT`）', /"NOT"\.equals\(s\.useCode\(\)\)/.test(svc));
    ok('用完把技能表回推（面板熟练度条 / HUD 的 CD 立刻刷新）',
      /skillPoints\.sendSkillTables\(session, p\)/.test(handler));

    // ② GM 命令：1..100 校验 + 派生→计数的换算 + 如实回报
    ok('`/@skill_mastery` 已注册（且与其他 GM 命令同一条分派链）',
      /name\.equals\("@skill_mastery"\)/.test(chat)
      && /treatSkillMastery\(session, parts\)/.test(chat));
    ok('参数校验 1..100（越界回 `chat.cmd.skillMasteryBad`，一个技能都不动）',
      /pct < 1 \|\| pct > 100/.test(svc) && /skillMasteryBad/.test(chat));
    ok('换算 = `目标 − 才能项`（派生值 = 才能项 + 计数 ⇒ 才能高时下限更高，要**如实回报**）',
      /int raw = Math\.max\(0, Math\.min\(COUNT_MAX, target - floor\)\)/.test(svc)
      && /effectivePct/.test(chat));
    ok('`Element[0]` 的技能**不动计数**（恒满：写下去只会抹掉修炼记录）',
      /if \(s\.element0\(\) != 0\) \{\s*\n\s*elementFull\+\+;\s*\n\s*continue;/.test(svc));
    ok('未学技能**不建键**（"没学"就是键不存在，不写 0 进去）',
      /SkillKeys\.point\(s\.skillId\(\)\)\) <= 0\) \{\s*\n\s*continue;\s*\/\/ 未学：不建键/.test(svc));

    // ③ 客户端**要不要发这个请求**（两半判据必须一起改，否则右键毫无反应 —— 见 `useEffect.ts` 的注释）
    {
      const { useWithoutAnimation } = await import('../src/game/useEffect.js');
      ok('客户端对三颗熟练度石**会**发 `C2S_UseItem`（`useWithoutAnimation` 认这三档）',
        useWithoutAnimation(0x080B3700) && useWithoutAnimation(0x080B3800) && useWithoutAnimation(0x080B3900));
      ok('三颗拉满石（Aging Master）不受影响，仍是"不发请求"以外的那条路',
        useWithoutAnimation(0x080B3400) && useWithoutAnimation(0x080B3500) && useWithoutAnimation(0x080B3600));
      ok('普通石头 / 药水不被误纳入（0x080B3A00 与药水 0x04020100）',
        !useWithoutAnimation(0x080B3A00) && !useWithoutAnimation(0x04020100));
    }

    // ④ 文案成对齐全（与服务端 Reason 逐个比对 —— 服务端加码漏文案会立刻红，同 ④ 的口径）
    const RAWSVC = readSrv(SVC);
    // ⚠ 末条常量以 `);` 收尾（不是 `),`） —— 正则要同时容下两种，否则会漏掉最后一个原因码
    const reasonKeys = [...RAWSVC.matchAll(/^ {8}[A-Z_]+\((?:"([a-z-]+)")?\)[;,]\r?$/gm)].map((m) => m[1]).filter(Boolean);
    ok(`从 SkillMasteryService.Reason 扫到 ${reasonKeys.length} 个原因码`, reasonKeys.length === 5);
    for (const path of ['src/locales/zh.json', 'src/locales/en.json']) {
      const t = JSON.parse(readFileSync(resolve(root, path), 'utf8')) as {
        item?: { op?: Record<string, Record<string, string>> };
        chat?: { cmd?: Record<string, string> };
      };
      const sm = t.item?.op?.['skill-master'] ?? {};
      const missing = reasonKeys.filter((k) => !(sm[k] ?? '').trim());
      ok(`${path} 覆盖全部 ${reasonKeys.length} 条 item.op.skill-master.*（缺：${missing.join(', ') || '无'}）`,
        missing.length === 0);
      const gm = ['skillMasteryUsage', 'skillMasteryBad', 'skillMasteryDone'];
      const missGm = gm.filter((k) => !(t.chat?.cmd?.[k] ?? '').trim());
      ok(`${path} 有 GM 命令的三条 chat.cmd.*（缺：${missGm.join(', ') || '无'}）`, missGm.length === 0);
    }
  }
}

console.log(fails === 0 ? '\nPASS' : `\nFAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
