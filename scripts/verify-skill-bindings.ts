/**
 * 技能绑定（拳位 / F1~F8）的护栏检查（`npm run verify-skill-bindings`）。
 *
 * 背景（用户 2026-09-24）：绑定原先存在**全局 localStorage**（`pt.fistBindings`/`pt.quickBindings`），
 * 于是"换个角色进去看到的还是上一个角色的绑定、HUD 中央两个拳位还画出**别的职业**的技能图标"。
 * 现在绑定是**服务端权威、按角色存在 `characterinfo.props`**（`bind.fist.left|right` / `bind.quick.1..8`），
 * 客户端只认 `S2C_SkillBindings`。
 *
 * 六组断言（都只读，失败即非零退出）：
 *   ① 客户端**没有任何绑定相关的本地持久化**（localStorage / 全局 key 名全仓 0 处）；
 *   ② 绑定**只能**由 `S2C_SkillBindings` 写入（`setSkillBindings` 是唯一写口；本地面板只发包不提交）；
 *   ③ 跑**真模块** `game/skillBinding.ts`：未绑=普攻（规格）、异职业/未知 id=**不解析**（不是"当没绑"）、
 *      F 键目标拳按 源码 MousePosi→useCode 顺序判、ALL 类**不猜**（返回 null）；
 *   ④ HUD：绑了但图标取不到 ⇒ **不画**（不许退回 `skill_normal`）；未绑才画默认拳头（原版规格）；
 *   ⑤ `skill.bind.*` 文案在 zh/en **成对齐全**，且逐个覆盖服务端 `SkillBindRules.Reason`；
 *   ⑥ 协议两边同号同形（224 / 213），客户端只发 (kind, index, skillId) —— **不发 props 键**。
 *
 * 服务端仓库位置：默认 `<客户端仓库>/../jpstale-server`，可用 `PT_SERVER_ROOT` 覆盖；
 * 找不到时**报告跳过交叉核对**（本地断言照查，不放宽）。
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
/** 源文件是 CRLF：多行断言前先归一成 `\n`（仓库里两种行尾都有） */
const read = async (rel: string): Promise<string> =>
  (await readFile(new URL(rel, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** 去掉 `//` 与块注释 —— "只出现 N 次"这类计数必须排除注释里的提及（本次改动大量注释讲了旧实现） */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const store = await read('../src/app/gameStore.ts');
const storeCode = stripComments(store);
const hud = await read('../src/ui/Hud.ts');
const hudCode = stripComments(hud);
const panel = await read('../src/ui/react/SkillPanel.tsx');
const panelCode = stripComments(panel);
const bridge = await read('../src/net/bridge.ts');
const binding = await read('../src/game/skillBinding.ts');
const bindingCode = stripComments(binding);
const protocol = await read('../src/net/protocol.ts');

/* ─────────── ① 本地持久化：一条都不许剩 ─────────── */
console.log('① 绑定没有本地持久化（跨角色串台的根因）');
{
  const withLocalStorage = (['../src/app/gameStore.ts', '../src/game/skillBinding.ts',
    '../src/ui/Hud.ts', '../src/ui/react/SkillPanel.tsx', '../src/net/bridge.ts'] as const);
  const hits: string[] = [];
  for (const rel of withLocalStorage) {
    const src = stripComments(await read(rel));
    if (/localStorage/.test(src)) hits.push(rel);
  }
  ok(`绑定链上 5 个文件都不碰 localStorage（命中：${hits.join(', ') || '无'}）`, hits.length === 0);
  ok('旧的两个全局 key 名（`pt.fistBindings` / `pt.quickBindings`）在绑定链上 0 处',
    !/pt\.fistBindings|pt\.quickBindings/.test(storeCode) && !/pt\.fistBindings|pt\.quickBindings/.test(bindingCode));
  ok('绑定相关的 `localStorage.setItem` 全仓 0 处（`gameStore` 里连 `persist()` 都没了）',
    !/persist\(\)/.test(storeCode) && !/setItem\(/.test(storeCode));
  ok('快照初始值 `skillBindings: null`（= **显式未知**，不是"空绑定表"）',
    /skillBindings: null/.test(storeCode));
  {
    // 进图窗口：清表必须发生在 `case 'enterGame'` 之后（否则"换角色进图"的头几帧会画旧绑定）
    const mainSrc = await read('../src/main.ts');
    const egCase = mainSrc.indexOf("case 'enterGame': {");
    const cleared = mainSrc.indexOf('clearCharacterTables();');
    ok('进图时把"按角色权威表"清成未知：`clearCharacterTables` 只有它一处 commit，'
      + '且在 `case \'enterGame\'` 块内被调',
      (storeCode.match(/commit\(\{ skillList: null, skillBindings: null \}\)/g) ?? []).length === 1
      && /export function clearCharacterTables\(\): void \{/.test(store)
      && egCase > 0 && cleared > egCase
      && (mainSrc.match(/clearCharacterTables\(\)/g) ?? []).length === 1);
  }
}

/* ─────────── ② 绑定只由 S2C_SkillBindings 写入 ─────────── */
console.log('② 绑定只认服务端下发');
{
  ok('`setSkillBindings` 是唯一的本地写口（`commit({ skillBindings: v })` 全仓 1 处；'
    + '其余 `skillBindings:` 只是快照字段声明与类型注释）',
    (storeCode.match(/commit\(\{ skillBindings: v \}\)/g) ?? []).length === 1);
  ok('bridge 里 `if (msg.skillBindings)` 是唯一入口（1 处），并把它交给 `setSkillBindings`',
    (stripComments(bridge).match(/if \(msg\.skillBindings\)/g) ?? []).length === 1
    && /setSkillBindings\(\{/.test(bridge));
  ok('`quick` 长度不是 8 ⇒ 整表按未知（`setSkillBindings(null)`）并上报，**不补齐**',
    /quick\.length !== QUICK_SLOT_COUNT/.test(bridge) && /setSkillBindings\(null\)/.test(bridge)
    && /reportFallback\('skill\.bind\.length'/.test(bridge));
  ok('旧的本地改绑定函数已删干净（`equipFist(` / `setQuickBinding(` / `pressQuickBinding(` 全仓 0 处）',
    !/equipFist\(|setQuickBinding\(|pressQuickBinding\(/.test(storeCode)
    && !/equipFist\(|setQuickBinding\(|pressQuickBinding\(/.test(panelCode));
  ok('面板**不做乐观更新**：只调 `equipFistSkill` / `bindQuickKey`（bridge 的发包函数）',
    /equipFistSkill\(target, [a-zA-Z]+\)/.test(panelCode) && /bindQuickKey\(/.test(panelCode)
    && !/commit\(|setSkillBindings\(/.test(panelCode));
  ok('`equipFistSkill` / `bindQuickKey` 都走 `sendSkillBinding`（唯一发包实现）',
    /export function equipFistSkill[\s\S]{0,200}?sendSkillBinding\(/.test(bridge)
    && /export function bindQuickKey[\s\S]{0,200}?sendSkillBinding\(/.test(bridge)
    && (stripComments(bridge).match(/send\(setSkillBinding\(/g) ?? []).length === 1);
}

/* ─────────── ③ 真模块判定 ─────────── */
console.log('③ 跑真模块 `game/skillBinding.ts`');
{
  installDomStub();
  const { fistIntentOf, quickFistOf, quickSkillIdOf, quickKeyOfSkill, fistSlotOfSkill, UNBOUND } =
    await import('../src/game/skillBinding.js');
  const TBL = JSON.parse(readFileSync(resolve(root, 'src/game/data/skill-tables.generated.json'), 'utf8')) as {
    skills: Array<{ classDir: string; job: number; skillId: number; iconFile: string; useCode: string }>;
  };
  const pikeman = (useCode: string) =>
    TBL.skills.find((r) => r.classDir === 'pikeman' && r.useCode === useCode)!;
  const right = pikeman('RIGHT');
  const left = pikeman('LEFT');       // 实测生成物里 LEFT 有 0 条 ⇒ 下面会显式跳过
  const all = pikeman('ALL');
  const fighterSkill = TBL.skills.find((r) => r.classDir === 'fighter')!;
  const zero = (): readonly number[] => new Array(8).fill(UNBOUND);
  const none = { fistLeft: UNBOUND, fistRight: UNBOUND, quick: zero() };

  ok('样本齐：pikeman 有 RIGHT/ALL 技能、fighter 有技能（数据变了这条会红）',
    right != null && all != null && fighterSkill != null);
  ok('表没到（null）⇒ `unknown`（**不是** normal，也不是空表）',
    fistIntentOf(null, 4, 'left').kind === 'unknown');
  ok('未绑（0）⇒ `normal` = 普通攻击（**源码规格**：`lpAttackSkill = 0`，playmain.cpp:2316）',
    fistIntentOf(none, 4, 'left').kind === 'normal');
  const ownJob = fistIntentOf({ ...none, fistLeft: right.skillId }, 4, 'left');
  ok('本职业技能 ⇒ `skill`，且带上身份行（图标/职业的唯一来源）',
    ownJob.kind === 'skill' && ownJob.skillId === right.skillId && ownJob.row.iconFile === right.iconFile);
  const foreign = fistIntentOf({ ...none, fistLeft: fighterSkill.skillId }, 4, 'left');
  ok('**异职业绑定 ⇒ `invalid`**（不许当 normal —— 那正是"当没绑再退普攻"的兜底）',
    foreign.kind === 'invalid' && foreign.skillId === fighterSkill.skillId);
  ok('未知 id ⇒ `invalid`（同上，不解析成任何东西）',
    fistIntentOf({ ...none, fistLeft: 0x7F7F7F }, 4, 'left').kind === 'invalid');
  ok('职业未知（未下发）⇒ `invalid`（不猜一个职业去解析）',
    fistIntentOf({ ...none, fistLeft: right.skillId }, null, 'left').kind === 'invalid');

  ok('F 键取值：未绑 0 ⇒ 0（显式"该键没绑"），表没到 ⇒ null（未知）',
    quickSkillIdOf(none, 0) === 0 && quickSkillIdOf(null, 0) === null);
  ok('按下 F 键时：技能此刻在某只拳上 ⇒ 装回那只（源码 `MousePosi` 的记录）',
    quickFistOf(right.skillId, { ...none, fistRight: right.skillId }, 4) === 'right'
    && quickFistOf(right.skillId, { ...none, fistLeft: right.skillId }, 4) === 'left');
  ok('否则按 `useCode`：RIGHT ⇒ 右拳（与"按着右键录进去"同结果）',
    quickFistOf(right.skillId, none, 4) === 'right');
  // 2026-09-24 改（用户裁定）：`ALL` 且还没装在任何拳上 ⇒ **默认右拳**。
  // 旧行为是 `null`（"协议没带 MousePosi 就不猜"）⇒ 实际效果是"按 F 没反应"（用户实测报的 bug）；
  // 用户的口径："默认是右拳，但要看技能本身绑了左键还是右键"（上面两条已覆盖"已绑则用该拳"）。
  ok('`ALL`（左右都能绑）且不在任何拳上 ⇒ **右拳**（用户裁定：默认右拳）',
    quickFistOf(all.skillId, none, 4) === 'right');
  ok('异职业的 F 键绑定 ⇒ null（不解析）', quickFistOf(fighterSkill.skillId, none, 4) === null);
  ok('未绑（0）⇒ null（该 F 键没有可装的东西）', quickFistOf(UNBOUND, none, 4) === null);
  ok('角标查表：`quickKeyOfSkill` 返回 1..8、`fistSlotOfSkill` 返回左右（身份 = skillId）',
    quickKeyOfSkill({ ...none, quick: [UNBOUND, right.skillId, ...new Array(6).fill(UNBOUND)] }, right.skillId) === 2
    && fistSlotOfSkill({ ...none, fistRight: right.skillId }, right.skillId) === 'right'
    && quickKeyOfSkill(null, right.skillId) === null);
  ok('`0`（未绑）**不算**"某个技能绑在 F 键上"（否则普攻格会把第一个空 F 键画成 F4 角标）',
    quickKeyOfSkill(none, UNBOUND) === null
    && quickKeyOfSkill({ ...none, quick: [UNBOUND, right.skillId, ...new Array(6).fill(UNBOUND)] }, UNBOUND) === null);
  ok(`LEFT 类技能样本：${left ? '有，按左拳' : '生成物里 0 条 ⇒ 沿用"左拳靠 ALL"的口径'}`,
    !left || quickFistOf(left.skillId, none, 4) === 'left');
  ok("判定处**不返回替代值**：模块里没有任何 `?? 'fighter'` / `|| 'fighter'`（缺职业就是「不解析」）",
    !/\?\?\s*'fighter'|\|\|\s*'fighter'/.test(bindingCode));
}

/* ─────────── ④ HUD：取不到就不画 ─────────── */
console.log('④ HUD 拳位图标：取不到就留空，不画默认图标');
{
  ok('HUD 读的是**意图**（`fistIntentOf`），不再按 `{classDir,iconFile}` 比绑定对象',
    /fistIntentOf\(snap\.skillBindings/.test(hudCode));
  ok('旧的"取不到就画 `fist`"没了（`textures[\'fistL\'] ? \'fistL\' : \'fist\'` 0 处）',
    !/textures\['fistL'\] \? 'fistL' : 'fist'/.test(hudCode)
    && !/textures\['fistR'\] \? 'fistR' : 'fist'/.test(hudCode));
  // 2026-09-24 改：两个拳位的绘制收进 `drawFistSlot`（原版 `cSKILL::Draw` 的 HUD 那半段：
  // 图标按可用性选彩色/灰版 + CD 弧），断言从"两行内联"改成"两处调用 + 函数内的 normal 分支"。
  ok('只有 `normal`（**未绑**）才画默认拳头，且是显式分支（原版普攻格就是这个图标）',
    /drawFistSlot\('left', fistSlots\.left, 349, 541\);/.test(hudCode)
    && /drawFistSlot\('right', fistSlots\.right, 403, 541\);/.test(hudCode)
    && /if \(view\.kind === 'normal'\) drawTex\('fist'/.test(hudCode));
  ok('绑了但图标取不到 ⇒ 删纹理 + 上报（`hud.fistIcon`），该格这一帧不画',
    /delete textures\[key\];\n      reportFallback\('hud\.fistIcon'/.test(hud));
  ok('`unknown`（绑定表没到）与 `invalid`（异职业/未知 id）走的是"删纹理"那条（不画）',
    /if \(view\.kind !== 'skill'\) \{\n      delete textures\[key\];\n      delete textures\[keyGray\];\n      return;\n    \}/.test(hud));
  ok('HUD 不再 import 绑定对象类型（`FistBinding` 全仓 0 处）', !/FistBinding/.test(hudCode));
}

/* ─────────── ⑤ 文案：`skill.bind.*` 成对 + 覆盖服务端原因码 ─────────── */
console.log('⑤ `skill.bind.*` 文案成对齐全');
{
  const zh = JSON.parse(await read('../src/locales/zh.json')) as { skill: { bind: Record<string, string> } };
  const en = JSON.parse(await read('../src/locales/en.json')) as { skill: { bind: Record<string, string> } };
  const zhT = zh.skill.bind, enT = en.skill.bind;
  const zhKeys = Object.keys(zhT), enKeys = Object.keys(enT);
  ok('zh/en 的 `skill.bind.*` key 完全一致（无单边 key）',
    zhKeys.length === enKeys.length && zhKeys.every((k) => enT[k] !== undefined));
  ok('文案都不为空、且不是 key 本身',
    zhKeys.every((k) => zhT[k]!.trim() !== '' && zhT[k] !== `skill.bind.${k}`)
    && enKeys.every((k) => enT[k]!.trim() !== '' && enT[k] !== `skill.bind.${k}`));
  ok('面板/HUD 用到的提示 key 也在（`skills.bindNoList` / `skills.noClass`）',
    /skills\.bindNoList/.test(panel) && /skills\.noClass/.test(panel));

  const SERVER = process.env.PT_SERVER_ROOT ?? resolve('..', 'jpstale-server');
  const RULES = resolve(SERVER,
    'modules/common-service/src/main/java/org/jpstale/common/service/skill/SkillBindRules.java');
  if (existsSync(RULES)) {
    const java = readFileSync(RULES, 'utf8');
    const keys = [...java.matchAll(/^ {8}[A-Z_]+\("([a-zA-Z]+)"\),\r?$/gm)].map((m) => m[1]!);
    ok(`从 SkillBindRules.Reason 扫到 ${keys.length} 个原因码（OK 是 null，不在其中）`,
      keys.length === 7 && !keys.includes('OK'));
    const missing = keys.filter((k) => zhT[k] === undefined || enT[k] === undefined);
    const extra = zhKeys.filter((k) => !keys.includes(k));
    ok(`服务端每个原因码在 zh/en 都有文案（缺：${missing.join(', ') || '无'}）`, missing.length === 0);
    ok(`客户端没有服务端不认识的多余 key（多：${extra.join(', ') || '无'}）`, extra.length === 0);
  } else {
    console.log(`  · 跳过交叉核对：找不到 ${RULES}（设 PT_SERVER_ROOT 指向服务端仓库）`);
  }
}

/* ─────────── ⑥ 协议：同号同形 + 只发三个数 ─────────── */
console.log('⑥ 协议两端同号同形，客户端不拼 props 键');
{
  const cliProto = await read('../proto/base/message.proto');
  ok('客户端 proto：`C2S_SetSkillBinding set_skill_binding = 224` / `S2C_SkillBindings skill_bindings = 213`',
    /C2S_SetSkillBinding set_skill_binding = 224;/.test(cliProto)
    && /S2C_SkillBindings skill_bindings = 213;/.test(cliProto));
  ok('`C2S_SetSkillBinding` 的字段就是 (kind, index, skill_id) 三个 int32（没有第 4 个字段混进来）',
    /message C2S_SetSkillBinding \{\n  int32 kind = 1;[\s\S]{0,400}?int32 index = 2;[\s\S]{0,400}?int32 skill_id = 3;[\s\S]{0,400}?\n\}/.test(cliProto));
  ok('客户端发消息只带这三个（`setSkillBinding: { kind, index, skillId }`）',
    /setSkillBinding: \{ kind, index, skillId \}/.test(stripComments(protocol)));
  ok('客户端源码里**不存在**任何 props 键字面量（`bind.fist.` / `bind.quick.` 0 处 —— 键只在服务端 `PlayerKey`）',
    !/'bind\.fist\.|'bind\.quick\.|"bind\.fist\.|"bind\.quick\./.test(
      storeCode + bindingCode + panelCode + stripComments(bridge) + stripComments(protocol)));

  const SERVER = process.env.PT_SERVER_ROOT ?? resolve('..', 'jpstale-server');
  const SRV_PROTO = resolve(SERVER, 'modules/protocol/src/main/proto/base/message.proto');
  const SRV_KEYS = resolve(SERVER,
    'modules/common-service/src/main/java/org/jpstale/common/service/props/PlayerKey.java');
  if (existsSync(SRV_PROTO) && existsSync(SRV_KEYS)) {
    const srv = readFileSync(SRV_PROTO, 'utf8');
    ok('服务端 proto 同号同形（224 / 213 与同样的 message）',
      /C2S_SetSkillBinding set_skill_binding = 224;/.test(srv)
      && /S2C_SkillBindings skill_bindings = 213;/.test(srv)
      && /repeated int32 quick = 3;/.test(srv));
    const keys = readFileSync(SRV_KEYS, 'utf8');
    ok('props 键的模板只在 `PlayerKey` 一处（`bind.fist.%s` / `bind.quick.%d`）',
      /BIND_FIST\("bind\.fist\.%s"/.test(keys) && /BIND_QUICK\("bind\.quick\.%d"/.test(keys));
    ok('绑定表在"与技能表同一批时机"下发（`sendSkillTables` 配对两个 send）',
      /public void sendSkillTables\(PlayerSession session, Player p\) \{[\s\S]{0,200}?sendSkillList\(session, p\);[\s\S]{0,200}?sendSkillBindings\(session, p\);/.test(
        readFileSync(resolve(SERVER, 'apps/game-server/src/main/java/org/jpstale/server/game/service/SkillPointService.java'), 'utf8')));
  } else {
    console.log('  · 跳过服务端交叉核对：找不到 proto / PlayerKey（设 PT_SERVER_ROOT 指向服务端仓库）');
  }
}

console.log(fails === 0 ? '\nPASS' : `\nFAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
