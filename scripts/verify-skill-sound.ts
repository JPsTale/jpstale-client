/**
 * **技能音效回归**（`npm run verify-skill-sound`）—— 用户 2026-09-23 报"技能动画现在不播放音效了"。
 *
 * 音效链路（**用真实资产/真实状态机/真实音效派发跑，不是读代码猜**）：
 *   ① 起手音 `fireSkillCast`（`skill-fx-runner.ts:326`）—— 在 `playSkillByIcon` 成功之后由
 *      `beginSelfSkill` 调（`WorldView.ts:2043`），**不受** `castCircleFlagForClass` 那道门影响（音在前）。
 *   ② 事件帧音 `fireSkillEvent`（同文件 `:355`）—— 由渲染循环的
 *      `if (curSt === STATE.SKILL && selfSkillRow)`（`WorldView.ts:5791`）驱动；
 *      **要听到技能音，这一击的状态必须是 SKILL**（`triggerSkill` 真的播了技能动作）。
 *      回退成普攻（`triggerAttack`）⇒ `selfSkillRow` 不设、事件帧分支根本不进 ⇒ **一声不出**。
 *
 * 本脚本钉三件事：
 *  A. **链路本身是好的**：野外（区域位 2）放 pikeman 的技能 ⇒ 状态机进 SKILL、事件帧跨过 ⇒ 有 wav；
 *     而"普攻"那一路（`skill_normal`）⇒ **0 条技能 wav**（这就是"技能音没了"的样子）。
 *  B. **村庄里技能本来就不出声**（不是本次回归）：m1..m8 的 `.in` 里 **SKILL 条目 100% 是 `필드`** ⇒
 *     村庄（区域位 1）下状态机选不出任何技能动作 —— 改前改后一样 ⇒ `isVillageMap` 那道门
 *     **不是**丢音的原因（它按源码 `playmain.cpp:2316-2317` 也确实是"村庄清掉 lpAttackSkill"）。
 *  C. **新入口必须真的能施法**（本次修的）：左键的瞄准 = **点击这一下自己的判定**、左键点怪不再
 *     吞掉"选中该怪去追打"、追打循环逐次出手用左拳技能（`playmain.cpp:2300-2313/:2474`）。
 *     丢掉任何一条 ⇒ 用户那一下点击既没有技能动作也没有技能音。
 *
 * 用法：`npm run verify-skill-sound`。资产根来自 `.env` 的 `VITE_ASSET_ROOT`；取不到 ⇒ **报告跳过**
 * （不假装通过；跳过时仍跑 B/C 两段：它们只读生成物与源码）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { installDomStub } from './dom-stub.js';

let fails = 0;
const ok = (label: string, cond: boolean): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 源文件是 CRLF：多行断言前先归一成 `\n` */
const read = async (rel: string): Promise<string> => (await readFile(new URL(rel, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

const wv = await read('../src/ui/WorldView.ts');

// ─────────────────────────────────────────────────────────────
console.log('A. 真实资产跑一遍：野外(区域位2) vs 村庄(区域位1) —— 动作状态 + 事件帧 + 播了哪些 wav');
{
  const envTxt = await readFile(new URL('../.env', import.meta.url), 'utf8').catch(() => '');
  const assetRoot = /^\s*VITE_ASSET_ROOT\s*=\s*(.+)$/m.exec(envTxt)?.[1].trim();
  const inxPath = assetRoot ? resolve(assetRoot, 'char/tmabcd/m4bip.inx') : '';
  if (!assetRoot || !existsSync(inxPath)) {
    console.log(`  · 资产根不可见（VITE_ASSET_ROOT=${assetRoot || '未配置'}）→ **跳过 A 段**（不当成通过）`);
  } else {
    const { parseInx, parseSmb } = await import('../src/core/char-parser.js');
    const { buildMotionList } = await import('../src/char/anim-player.js');
    const { createAnimStateMachine } = await import('../src/char/anim-state-machine.js');
    const { semanticEntriesForJob } = await import('../src/char/semantic-anim.js');
    const { advanceAnimFrame, crossEventFrames, motionEventIndexOf } = await import('../src/char/animation.js');
    const { skillFxRowByIcon, fireSkillCast, fireSkillEvent } = await import('../src/render/effects/skill-fx-runner.js');
    const { getWeaponTypeFromIdCode, getHandTypeFromIdCode } = await import('../src/char/weapon-type.js');
    const { SKILL_INDEX_BY_ICON } = await import('../src/game/data/skillIndexByIcon.js');

    const bytes = (p: string): ArrayBuffer => {
      const b = readFileSync(p);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const inx = parseInx(bytes(inxPath));
    const smbRel = (String(inx.motionFile).split('\\').join('/').replace(/\.[^.]+$/, '') + '.smb').toLowerCase();
    // ⚠ 与 `char-loader.resolveMotionBase` 同构（探针里手写一次；那是内部函数，未导出）
    const smb = parseSmb(bytes(resolve(assetRoot, smbRel)));
    const motions = buildMotionList(smb, inx);
    // pikeman 主手（真实物品表里的长枪）：WP102 'Spear' = 0x01050200
    const WEAPON = 0x01050200;

    /** 跑一次"放这一招"：返回 { state, triggerSkill, wavs, eventCalls } */
    const run = (fieldState: number, icon: string): {
      triggerSkill: boolean; state: number; wavs: string[]; events: number; fallbackAttack: boolean;
    } => {
      const sm = createAnimStateMachine({
        getMotions: () => motions,
        getClassId: () => 4,
        getWeaponIdCode: () => WEAPON,
        getWeaponType: () => getWeaponTypeFromIdCode(WEAPON),
        getHandType: () => { const h = getHandTypeFromIdCode(WEAPON); return h === '1H' || h === '2H' ? h : null; },
        getSemanticEntries: () => semanticEntriesForJob(4),
        getFieldState: () => fieldState,
        onMotionChange: () => {},
      });
      sm.triggerIdle();
      const idx = (SKILL_INDEX_BY_ICON as Record<string, number>)[icon];
      const triggerSkill = idx != null && sm.triggerSkill(idx);
      const wavs: string[] = [];
      let events = 0;
      const pos = { x: 0, y: 0, z: 0 };
      if (!triggerSkill) {
        const fallbackAttack = sm.triggerAttack(true);
        return { triggerSkill, state: sm.getCurrentState(), wavs, events, fallbackAttack };
      }
      const row = skillFxRowByIcon(icon);
      const ctx = { scene: null as never, playSound: (p: string) => { wavs.push(p); }, log: () => {} };
      if (!row) return { triggerSkill, state: sm.getCurrentState(), wavs, events, fallbackAttack: false };
      fireSkillCast(row, ctx, pos);
      const m = sm.getCurrentMotion()!;
      const frames = Array.from(m.eventFrame).filter((f) => f > 0);
      const use = frames.length ? frames : [0];      // 无事件帧 → 原版兜底在起点触发一次
      let fired = 0, frame = m.startFrame * 160;
      for (let i = 0; i < 900; i++) {
        const step = advanceAnimFrame(frame, m, 1 / 60, 1);
        frame = step.frame;
        const crossed = crossEventFrames(use, fired, step.raw - m.startFrame * 160);
        fired = crossed.fired;
        for (const f of crossed.hit) {
          events++;
          const before = wavs.length;
          fireSkillEvent(row, { ...ctx, motionEvent: motionEventIndexOf(m.eventFrame, f), casterYaw: 0 }, pos, null);
          void before;
        }
        if (events >= use.length) break;
      }
      return { triggerSkill, state: sm.getCurrentState(), wavs, events, fallbackAttack: false };
    };

    // 左拳能绑的 pikeman 技能 = useCode ALL ⇒ T1 j_crash / T1 expasion；再带一个 RIGHT 的 p_wind 作对照
    const CASES = ['tp17 j_crash.bmp', 'tp30 expasion.bmp', 'tp10 p_wind.bmp'];
    /** `.in` 里有没有"这一招的专属动作"（= `triggerSkill` 能不能播 —— 判据与状态机同一份数据） */
    const hasSkillMotion = (icon: string): boolean => {
      const idx = (SKILL_INDEX_BY_ICON as Record<string, number>)[icon];
      return idx != null && motions.some((m) => m.state === 0x0150
        && Array.from(m.skillCodeList || []).includes(idx));
    };
    let fieldSounded = 0;
    for (const icon of CASES) {
      const hasMotion = hasSkillMotion(icon);
      const field = run(2, icon);
      const village = run(1, icon);
      console.log(`  · ${icon.padEnd(22)} 专属动作=${hasMotion} 野外: 进SKILL=${field.triggerSkill}`
        + ` 状态=0x${field.state.toString(16)} 事件帧=${field.events} wav=${JSON.stringify(field.wavs)}`);
      console.log(`    ${''.padEnd(22)} ${''.padEnd(8)} 村庄: 进SKILL=${village.triggerSkill}`
        + ` 状态=0x${village.state.toString(16)} wav=${JSON.stringify(village.wavs)}`);
      // ① 链路：**能播就有音**（进 SKILL ⇒ 必有 wav；无专属动作 ⇒ 退普攻、0 wav）
      ok(`野外 ${icon}：${hasMotion ? '有专属动作 ⇒ 进 SKILL 且播出了 wav' : '**无专属动作**（数据缺口）⇒ 退普攻、0 wav'}`,
        hasMotion ? (field.triggerSkill && field.state === 0x0150 && field.wavs.length > 0)
          : (!field.triggerSkill && field.wavs.length === 0));
      // ② 村庄：状态机放不出技能动作（改前改后一样）
      ok(`村庄 ${icon}：放不出技能动作、wav 必为 0 —— 村庄里技能本来就不出声`,
        !village.triggerSkill && village.wavs.length === 0);
      if (hasMotion && field.wavs.length > 0) fieldSounded++;
    }
    ok(`至少有一招在野外**真的播出了技能音**（${fieldSounded} 招）—— 音效链路本身是好的`,
      fieldSounded > 0);
    console.log('  · 无专属动作的原因：`.in` 里没有该技能码的 SKILL 条目（本次回归**不碰**那条链；'
      + '这不是丢音的原因，改前也一样退普攻）');
    // 反面：普攻那一路（"技能音没了"的样子）
    const normal = run(2, 'skill_normal');
    ok('`skill_normal`（普攻）⇒ 无技能动作、**0 条技能 wav**（这就是"没音"的样子；回退普攻就落在这里）',
      !normal.triggerSkill && normal.wavs.length === 0 && normal.fallbackAttack);

    // 状态机判据本身：村庄下 SKILL 选区为空，是因为 `weaponId = village ? null : …`（原版同理）
    ok('村庄把武器清零后才选不出 SKILL（源码依据：`playmain.cpp:2316-2317` 村庄清 `lpAttackSkill`）',
      /village \? null : \(getWeaponIdCode/.test(await read('../src/char/anim-state-machine.ts')));
  }
}

// ─────────────────────────────────────────────────────────────
console.log('B. 村庄判据不是回归原因：m1..m8 的 SKILL 条目 100% 只在野外（生成物实测）');
{
  let total = 0, villageCapable = 0;
  for (let job = 1; job <= 8; job++) {
    const gen = JSON.parse(readFileSync(resolve(root, `src/game/data/anim-in/anim-m${job}.generated.json`), 'utf8')) as {
      entries: Array<{ inxState: string; locations: string[] }>;
    };
    const sk = gen.entries.filter((e) => e.inxState === 'SKILL');
    total += sk.length;
    villageCapable += sk.filter((e) => e.locations.includes('마을') || e.locations.includes('마을/필드')).length;
  }
  ok(`m1..m8 共 ${total} 条 SKILL 条目，含"村庄"的 ${villageCapable} 条 ⇒ 村庄里放不出技能动作（改前也如此）`,
    total > 0 && villageCapable === 0);
  ok('`isVillageMap` 是唯一村庄判据（`map-light.ts` 导出；与 `isSafeMap` 不是同一张表，别混用）',
    /export function isVillageMap\(mapId: number\): boolean/.test(await read('../src/maps/map-light.ts')));
}

// ─────────────────────────────────────────────────────────────
console.log('C. 修法结构（丢掉任一条 ⇒ 用户那一下点击既无技能动作、也无技能音）');
{
  /** 取一段函数体（从 `head` 起、到下一个顶格 `}` 结束） */
  const bodyOf = (src: string, head: string): string => {
    const i = src.indexOf(head);
    if (i < 0) return '';
    const end = src.indexOf('\n  }', i);
    return end < 0 ? src.slice(i) : src.slice(i, end);
  };
  const before = (s: string, a: string, b: string): boolean => {
    const i = s.indexOf(a), j = s.indexOf(b);
    return i >= 0 && j >= 0 && i < j;
  };
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const code = stripComments(wv);

  const castBody = bodyOf(code, 'function monsterUnderCursor(');
  ok('① 瞄准用**点击这一下自己的判定**（`nameplateTargetAt ?? pickTargetAt`，与 `onGroundTap` 同一套）',
    castBody !== '' && /const tag = nameplateTargetAt\(cx, cy\) \?\? pickTargetAt\(cx, cy\);/.test(castBody));
  ok('① 不再拿 15Hz 的 `hoverTarget` 当施法瞄准（滞后 ⇒ 点得到怪却静默不施法）',
    castBody !== '' && !/hoverTarget/.test(castBody));
  // 2026-09-24 改（用户实测"近战要跑到身边再打，不是原地施法"）：点怪**不再当场施法** ——
  // 只记"用哪只拳"并交给追打循环（原版 `SelMouseButton = 1/2; TraceAttackPlay()`，`Winmain.cpp:2994-2996`）。
  ok('② 左键点怪：不当场施法、记住拳位、不 return（选中该怪去追打）',
    /selfAttackSlot = slot;/.test(code) && !/playEquippedSkill\(slot, aim\)/.test(code)
    && !/if \(e\.button === 2\) return;/.test(code));
  ok('② 右键保持 return（源码那条 `break` 只跳"打人"分支）',
    /if \(e\.button === 2 && tryNoTargetCast\(\)\) \{ e\.preventDefault\(\); return; \}/.test(code));
  // 2026-09-24 改：拳位由"选中目标的那个键"决定（原版 `SelMouseButton → pLeftSkill/pRightSkill`）
  ok('③ 追打循环逐次出手取 **selfAttackSlot** 那只拳的技能（原版 `SelMouseButton → lpAttackSkill`）',
    /const it = isVillageMap\(currentMapId\) \? \{ kind: 'normal' as const \} : fistIntent\(selfAttackSlot\);/.test(code)
    // 技能不可用（MP 等）时 `skillBlock != null` ⇒ 这一击退普攻（左拳）/ 不出手（右拳）
    && /const sk = it\.kind === 'skill' && skillBlock == null/.test(code)
    && /\{ icon: it\.row\.iconFile, skillId: it\.skillId \} : null;/.test(code)
    && /sk \? playSkillByIcon\(sk\.icon, monsters\.get\(moveTarget\.id\)\?\.root \?\? null\)/.test(code));
  // 2026-09-24 改（D7 重做）：技能起手**不结算**，只上报"意图 + 我播的那条动作"
  // （服务端据此广播 S2C_SkillStart 给旁观者；伤害在事件帧由 C2S_SkillHit 触发）。
  ok('③ 追打里技能那一击上报"意图 + 本机所播动作条目"（AGENTS #14 透传；D7 两次上报）',
    /if \(sk\) opts\?\.onCastSkill\?\.\(sk\.skillId, targetId, m\?\.index \?\? 0, selfAnimClip\);/.test(code));
  ok('③ 技能**事件帧**上报 skill_hit（逐段结算；服务端收到才结算该段）',
    /opts\?\.onSkillHit\?\.\(castSkillId, selfSkillTargetId,/.test(code)
    && /const castSkillId = skillIdByIcon\(selfSkillRow\.icon\);/.test(code));
  // 2026-09-24 修（用户实测"Jumping Crash 没有伤害"）：技能目标必须来自**施法瞄准**（selfSkillAim），
  // 不能用 selfAttackTargetId —— 那个值只有**自动攻击循环**在跑到射程内起手时才赋，
  // 鼠标施法路径从不设它 ⇒ 单目标技能（Critical Hit / Jumping Crash）在服务端 requireTarget 被拒。
  // Pike Wind 因为是自身中心 AoE、不读 targetId，所以掩盖了这个 bug 一整轮。
  ok('③ 技能目标在起手时从瞄准定死（mouse 施法路径没有 selfAttackTargetId）',
    /selfSkillTargetId = monsterIdOfRoot\(aim\);/.test(code)
    && /function monsterIdOfRoot\(root: THREE\.Object3D \| null \| undefined\): number \{/.test(code));
  // 2026-09-24 改：绑定身份换成数字 skillId、判定搬进 `game/skillBinding.ts`（`fistIntent`）。
  // 这三条比旧写法**更严**：未绑/村庄 ⇒ 普通攻击（规格），而**表没到/异职业 ⇒ 不起手**（旧写法把这些也退普攻）。
  ok('③ 无绑定/村庄 ⇒ 普通攻击；unknown/invalid ⇒ 本轮不起手（三处施法入口共用同一个意图判定）',
    /const bindBroken = it\.kind === 'unknown' \|\| it\.kind === 'invalid';/.test(code)
    && /if \(!busy && !bindBroken && !rightSkillBlocked && animState/.test(code)
    // 技能不可用时的分流：**左拳退普攻、右拳什么都不做**（逐字 `SkillSub.cpp:1546-1553`）
    && /const skillBlock = it\.kind === 'skill' \? castBlockReason\(it\.skillId\) : null;/.test(code)
    && /const rightSkillBlocked = skillBlock != null && selfAttackSlot === 'right';/.test(code)
    && /export function checkCastResources\(skillId: number, point: number \| null, mp: number\): ResourceCheck/.test(await read('../src/game/skillCost.ts'))
    && /function fistIntent\(slot: 'left' \| 'right'\): FistIntent \{/.test(code)
    && (code.match(/function fistSkillOf\(/g) ?? []).length === 1
    && (code.match(/function fistIntent\(/g) ?? []).length === 1);
  // 2026-09-24：**事件帧的武器挥击音**（用户"武士技能没音效"的根因，见 docs/技能音效-矩阵实测.md）。
  // 原版 `EventAttack` 的通用分支在 `EventSkill()` 返回 FALSE 时调 `WeaponPlaySound(this)`
  // （`character.cpp:4207` + `:4244`）—— 我们此前只在 ATTACK 态播，SKILL 态一声不出。
  ok('③ 事件帧按原版补播**武器挥击音**（`weaponSfxForIcon`，唯一实现在 `game/skillMotionSrc.ts`）',
    /if \(weaponSfxForIcon\(selfSkillRow\.icon\)\) \{\s*\n\s*sfx\.playWeaponAttack\(selfWeaponSoundCode\(\), \{ priority: true \}\);/.test(code));
  ok('③ 这一声的判定读的是**生成物**（`skill-motion-src`，逐技能带 SkillSub/character.cpp 行号）',
    /weaponSfxForIcon/.test(await read('../src/game/skillMotionSrc.ts'))
    && /weaponSfx: eventSfx === 'weapon'/.test(await read('../scripts/extract-skill-motion-src.ts')));
  // 找不到专属动作时**不许拿普攻顶上**（原版 `SetMotionFromCode` 的 FindCnt==0 分支什么都不换）——
  // 只有"源里没有这一招"（motionSrc === null）才沿用老写法，且必须上报。
  ok('③ 无专属动作 ⇒ 按原版**不换动作**并上报（不再无条件退普攻）',
    /src\?\.motionSrc === 'skill' \|\| src\?\.motionSrc === 'mixed'/.test(code)
    && /按原版\*\*不换动作\*\*/.test(code));
  // 2026-09-24 改：技能不再"恒喂 1" —— 原版每个技能自带速率（`MotionLoopSpeed` / 那条按攻速的式子），
  // 数据 = `skill-motion-speed.generated.json`，唯一实现 = `game/skillRate.ts`。
  // 断言随之收紧：技能走 `skillRate(*, skillId, …)`、普攻仍走 `attackRate`，且每帧复位那支也认技能。
  ok('③ 技能按**原版自己的速率**播（`skillRate(skillId, attackSpeed)`，不再恒 1）、普攻才按攻速换算',
    /animState\.getCurrentState\(\) === STATE\.SKILL\s*\n\s*\? \(sk \? skillRate\(sk\.skillId/.test(code)
    && /: attackRate\(m, getGameSnapshot\(\)\.character\?\.attackSpeed/.test(code)
    && /else if \(curSt === animState\.STATE\.SKILL\)/.test(code)
    && /skillRateByIcon\(selfSkillRow\.icon/.test(code));
  // 远端照同一份数据改（不许第三份实现）：它也调用 `skillRateByIcon`
  ok('③ 远端的技能速率走**同一个函数**（`skillRateByIcon`，图标由 `animIndex` 反查）',
    (code.match(/skillRateByIcon\(/g) ?? []).length === 2);   // 自机 1 处 + 远端 1 处（导入那行不带括号）
  ok('施法入口（右键无目标/绑定拳）共用同一份判定，没有第二份"绑定+职业+身份"判定',
    ['function playEquippedSkill(', 'function tryNoTargetCast(']
      .every((h) => /fistSkillOf\(|fistIntent\(/.test(bodyOf(code, h))));

  // 改前基线（HEAD 的唯一入口）已按用户要求拆除 —— 由 verify-mouse-cast 钉住；这里再确认一次
  ok('改前的调试入口（`altKey/shiftKey + 左键` ⇒ 无条件施法）确已不在（它才是"点哪都有音"的来源）',
    !/altKey|shiftKey/.test(code));
}

console.log(fails === 0 ? '\nPASS' : `\nFAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
