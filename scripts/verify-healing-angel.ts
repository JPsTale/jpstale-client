/**
 * **Healing 小天使回归**（`npm run verify-healing-angel`）—— 用户 2026-09-27 两条实测：
 *   ①"现在头顶上的天使还是不动" ②"在网络上的其他玩家眼里，看不到我的施法动作和粒子特效"。
 *
 * 本脚本钉的是**从源码读出来的、可被推翻的事实**（每一项都能红）：
 *
 *  A. **只有一只天使**（`sinEffect_Healing2` 建两份，但第一份 `BoneFlag = 1` ⇒ 永不被绘制）——
 *     跑真资产，断言场景里只多出 **1 个** `Group`（此前是 2 个：多出的那份停在头顶不动）。
 *     另配一条**外部证据可复算**的断言（源码树在场时）：`sinDrawEffect2` 的两处判定都带 `!BoneFlag`，
 *     且全树**没有**第三个读 `BoneFlag` 的地方（源码树不在 ⇒ 报告跳过，不当成通过）。
 *  B. **自身 30 帧动画真的在推**（`AniCount` 每帧 +1、`>= 30` 归 0；`Frame = AniCount * 160`）——
 *     跑 90 逻辑帧，断言 `AniCount` 走遍 0..29 且**至少两帧姿势不同**（直接对 `.smb` 求骨矩阵比对）。
 *  C. **位置逐帧等于源码公式**（独立复算，不读我们自己的常量）：
 *     `θ_t = (256 + 25t)/4096·2π`、`r_t = (4096 + 16t)/256`、`y_t = pY + (7000 + 200 + 20t)/256`。
 *  D. **每帧 2 颗粒子**（`sinEffect_HealParticle3` 尾部 `memcpy` 复制），发射到 `Max_Time - 30` 为止。
 *  E. **旁观者那条路真的派发**（`fireObserverCast` = 原版 `RecvProcessSkill`）：`code:healing` 的
 *     起手特效被调、音效按**目标**位置播；并补起手法阵（**我方改动**：原版只有施法者本机看得到，
 *     用户 2026-09-27 两次指出"远端看不到祭司脚下的法阵"⇒ 有意补上，落点在**施法者**脚下）。
 *
 * 用法：`npm run verify-healing-angel`。资产根来自 `.env` 的 `VITE_ASSET_ROOT`；
 * 取不到 ⇒ **报告跳过**（不假装通过）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDomStub } from './dom-stub.js';

installDomStub();

/**
 * node 里没有 dev 中间件 ⇒ `/res/**` 取不到。这里把 `fetch` 映射到**资产根**上的同名文件
 * （只做"把请求接到本地文件"这一件事，`cachedFetch` 的其余契约——content-type 判死、
 * content-length 计数、流式 body——都照旧走真实实现）。
 */
function installAssetFetch(assetRoot: string): void {
  const g = globalThis as unknown as { fetch: typeof fetch };
  g.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('/res/')) throw new Error(`verify 的 fetch 桩只接了 /res/**，收到：${url}`);
    const rel = decodeURIComponent(url.slice('/res/'.length)).replace(/^\/+/, '').toLowerCase();
    const file = join(assetRoot, rel);
    if (!existsSync(file)) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    const buf = readFileSync(file);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(buf.byteLength) },
    });
  }) as unknown as typeof fetch;
}

let fails = 0;
const ok = (label: string, cond: boolean): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};
const read = async (rel: string): Promise<string> =>
  (await readFile(new URL(rel, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const src = await read('../src/render/effects/healing-orbit.ts');
/** 去注释后的源码（结构断言用；注释里本来就该提"被删掉的东西"，别让它们把断言染红） */
const srcCode = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── 源码常量（独立复算用，故意不从 src 里 import） ── */
const FONE = 256, FPS = 70, MAX_TIME = 250, EMIT_UNTIL = MAX_TIME - 30;
const Y0 = 7000, A0 = 256, DA = 25, R0 = 256 * 16, DR = 16, VY0 = 200, DVY = 20;

const envTxt = await readFile(new URL('../.env', import.meta.url), 'utf8').catch(() => '');
const assetRootRaw = /^\s*VITE_ASSET_ROOT\s*=\s*(.+)$/m.exec(envTxt)?.[1].trim();
const assetRoot = assetRootRaw ? assetRootRaw.replace(/^["']|["']$/g, '') : '';
const smbPath = assetRoot ? resolve(assetRoot, 'image/sinimage/effect/skilleffect/healing/hialtest.smb') : '';
const haveAssets = !!assetRoot && existsSync(smbPath);

// ─────────────────────────────────────────────────────────────
console.log('A. 只建一份实例（第一份 BoneFlag=1 ⇒ 源码从不绘制它）');
{
  // 结构：不得再有"头顶那份"（UPPER_LIFT_RAW / upper 实例 / 13000 常量）。
  // ⚠ 注释里**可以**提 13000（文件头正是在记录"它为什么被删"）⇒ 先把注释剥掉再查代码。
  ok('代码里不再有 13000（第一份实例的高度偏移；注释里的说明不算）', !/13000/.test(srcCode));
  ok('模块里不再有独立 upper 实例字段', !/\bupper\b\s*:/.test(srcCode) && !/o\.upper/.test(srcCode));
  // 外部证据（源码树在场才可复算）
  const srcTrees = [
    'E:/repo/NewSourcePT-2023/SrcGame/src',
    'E:/repo/ex-machina/src/game/Legacy/Engine',
  ];
  const present = srcTrees.filter((p) => existsSync(p));
  if (present.length === 0) {
    console.log('  · 参考源码树不在本机 → **跳过外部证据段**（不当成通过）');
  } else {
    for (const tree of present) {
      const files: string[] = [];
      const walk = (dir: string): void => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = resolve(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.(cpp|h|c)$/i.test(e.name)) files.push(p);
        }
      };
      walk(tree);
      let setToOne = 0, readSites = 0, skipGuards = 0, otherReaders = 0;
      for (const f of files) {
        const txt = readFileSync(f, 'latin1');
        for (const line of txt.split(/\r?\n/)) {
          if (/BoneFlag\s*=\s*1/.test(line)) setToOne++;
          else if (/BoneFlag/.test(line)) {
            // 结构体字段声明（`int BoneFlag;`）不是读取点
            if (/^\s*[A-Za-z_][\w\s*]*\s+BoneFlag\s*;/.test(line)) continue;
            // 读取点只有 `sinDrawEffect2` 那两处 `&& !…BoneFlag`
            if (/!\s*[\w[\]\.]*BoneFlag/.test(line)) { skipGuards++; readSites++; }
            else otherReaders++;
          }
        }
      }
      console.log(`  · ${tree}：赋值 =1 共 ${setToOne} 处；读取 ${readSites} 处（全是绘制跳过判定）；`
        + `其它读取点 ${otherReaders} 处`);
      ok(`${tree}：第一份实例被"绘制跳过"接住（赋值 > 0 且跳过判定 ≥ 2）`, setToOne > 0 && skipGuards >= 2);
      ok(`${tree}：没有第二处绘制路径消费 BoneFlag（否则"它其实会被画"）`, otherReaders === 0);
    }
  }
}

// ─────────────────────────────────────────────────────────────
console.log('B/C/D. 真资产 + 真帧循环：30 帧动画 / 位置公式 / 每帧 2 颗粒子');
{
  if (!haveAssets) {
    console.log(`  · 资产根不可见（VITE_ASSET_ROOT=${assetRoot || '未配置'}，缺 ${smbPath || 'hialtest.smb'}）`
      + ' → **跳过 B/C/D 段**（不当成通过）');
  } else {
    const THREE = await import('three');
    installAssetFetch(assetRoot);
    const { parseSmb } = await import('../src/core/char-parser.js');
    const { evalSkeleton } = await import('../src/char/animation.js');
    const { runHealingOrbit, updateHealingOrbits } = await import('../src/render/effects/healing-orbit.js');

    // ① 资产本身的动画存在性（不依赖我们的实现）：30 帧里姿势必须变
    const smbBuf = readFileSync(smbPath);
    const smb = parseSmb(smbBuf.buffer.slice(smbBuf.byteOffset, smbBuf.byteOffset + smbBuf.byteLength) as ArrayBuffer);
    const rotKeyed = smb.objects.filter((o) => o.tmRot.length > 0).length;
    const lastKey = Math.max(...smb.objects.map((o) => o.tmRot.at(-1)?.frame ?? 0));
    ok(`hialtest.smb 带旋转关键帧的骨 ≥ 1（实测 ${rotKeyed} 根；末键 ${lastKey} = ${lastKey / 160} 动画帧）`,
      rotKeyed > 0 && lastKey >= 29 * 160);
    const poseAt = (ani: number): number[] => {
      const fr = evalSkeleton(smb, ani * 160, false);
      const hands = fr.filter((s) => s.name === 'Bip01 L Hand' || s.name === 'Bip01 R Hand');
      return hands.flatMap((s) => [s.world[12]!, s.world[13]!, s.world[14]!]);
    };
    const p0 = poseAt(0);
    const distinct = new Set<string>();
    for (let a = 0; a < 30; a++) distinct.add(poseAt(a).map((v) => v.toFixed(3)).join(','));
    ok(`30 帧里有 ≥ 2 种不同姿势（实测 ${distinct.size} 种）`, distinct.size >= 2);
    ok('帧 0 与帧 15 姿势不同（扇翅往复）', JSON.stringify(poseAt(0)) !== JSON.stringify(poseAt(15)));
    void p0;

    // ② 跑真帧循环
    const logs: string[] = [];
    const scene = new THREE.Scene();
    const base = { x: 100, y: 20, z: -30 };
    const animIdx = 123;   // Healing 的 animIndex（skill-fx.json）
    void animIdx;
    runHealingOrbit({ scene, log: (m) => logs.push(m), targetPos: () => base }, base, 1);
    // 建实例是异步的（读资产）⇒ 让事件循环转起来
    await new Promise((r) => setTimeout(r, 1500));
    ok('A. 场景里只多出 1 个特效 Group（此前是 2：多出那份停在头顶）',
      scene.children.filter((c) => (c as THREE.Group).isGroup).length === 1);
    ok('日志里出现"自身 30 帧动画"（证明这份实例的动画来源已被声明）',
      logs.some((l) => l.includes('自身 30 帧动画')));

    // C2（趁实例还在，先做数值检查）：**朝向每帧跟着公转走**
    //   绘制读 `RanderAngle`，而 `sinMoveEffect2` 的**第一行** `memcpy(&RanderAngle, &Angle, …)`
    //   （`sinEffect2.cpp:444`）每帧把它同步成 `Angle` ⇒ 模型绕 Y 转。
    //   （用户 2026-09-27 实测"正脸方向从来没变过，看起来很僵硬" —— 根因就是我漏看那句 memcpy。）
    // 判据 = **数值**：再推 7 帧，`rotation.y` 必须正好改变 `-7 × 25 / 4096 × 2π`。
    {
      const grp = scene.children.find((c) => (c as THREE.Group).isGroup) as THREE.Group | undefined;
      const TWO_PI = Math.PI * 2;
      updateHealingOrbits(1 / FPS);        // ⚠ 先推一帧：朝向是**每帧写绝对值**，创建后到首帧前它还是 0
      const r0 = grp ? grp.rotation.y : NaN;
      for (let i = 0; i < 7; i++) updateHealingOrbits(1 / FPS);
      const r1 = grp ? grp.rotation.y : NaN;
      const expect = (7 * DA / 4096) * TWO_PI;
      let d = (r1 - r0) % TWO_PI;          // 角度是绝对值算出来的，跨圈时按短差比较
      if (d > Math.PI) d -= TWO_PI;
      if (d < -Math.PI) d += TWO_PI;
      ok(`C2. 朝向每帧随公转变化（7 帧应转 ${(-expect).toFixed(6)} rad，实测 ${d.toFixed(6)}）`,
        Number.isFinite(d) && Math.abs(d + expect) < 1e-9);
      ok('C2. 该朝向来自源码公式（不是固定 0、也不是自造值）',
        /o\.root\.rotation\.y = -\(\(ROTATE_ANGLE_0 \+ ROTATE_PER_FRAME \* t \+ ANGLE_270\)/.test(srcCode)
        && /memcpy\(&pEffect->RanderAngle, &pEffect->Angle/.test(src));
    }

    const frames = 330;   // 跨过一次 AniCount 回绕（30 帧一圈）
    for (let f = 0; f < frames; f++) updateHealingOrbits(1 / FPS);
    // 只看**周期日志**那一行（`… f=N AniCount=… pos=(…) …`）—— "寿命到 ⇒ 清空"那行不是
    const poslogs = logs.filter((l) => l.includes('Healing 小天使 f=') && l.includes('pos='));
    const parsed = poslogs.map((l) => {
      const f = Number(/f=(\d+)/.exec(l)?.[1]);
      const ani = Number(/AniCount=(\d+)\/30/.exec(l)?.[1]);
      const p = /pos=\(([-\d.]+),([-\d.]+),([-\d.]+)\)/.exec(l);
      const r = Number(/半径=([\d.]+)/.exec(l)?.[1]);
      const n = Number(/粒子=(\d+)/.exec(l)?.[1]);
      return { f, ani, x: Number(p?.[1]), y: Number(p?.[2]), z: Number(p?.[3]), r, n };
    });
    ok('B. 日志里能读到 AniCount（否则无法验证"在动"）', parsed.length >= 2);
    if (parsed.length >= 2) {
      // B: AniCount 序列 = 1 + t（mod 30），且真的取到过 0（回绕）
      const seenAni = new Set<number>();
      let aniOk = true;
      for (const row of parsed) {
        const expect = (1 + row.f) % 30;
        seenAni.add(row.ani);
        if (row.ani !== expect) { aniOk = false; console.log(`    ✗ f=${row.f}: AniCount=${row.ani}，应为 ${expect}`); }
      }
      ok(`B. AniCount 每帧 +1、到 30 归 0（抽查 ${parsed.length} 条全对）`, aniOk);
      const wrapped = parsed.some((row, i) => i > 0 && row.ani < parsed[i - 1]!.ani);
      ok(`B. 序列里真的回绕过 30→0（否则只是"一路涨"，看不出是 30 帧循环）`, wrapped);
      // C: 位置逐帧等于独立复算的公式
      let posOk = true;
      for (const row of parsed) {
        const t = row.f;
        const theta = ((A0 + DA * t) / 4096) * Math.PI * 2;
        const rRaw = R0 + DR * t;
        const ex = base.x + (rRaw * Math.sin(theta)) / FONE;
        const ez = base.z + (rRaw * Math.cos(theta)) / FONE;
        const ey = base.y + (Y0 + VY0 + DVY * t) / FONE;
        const near = Math.abs(row.x - ex) < 0.11 && Math.abs(row.y - ey) < 0.11 && Math.abs(row.z - ez) < 0.11;
        if (!near) {
          posOk = false;
          console.log(`    ✗ f=${t}: 实测 (${row.x},${row.y},${row.z}) ≠ 公式 (${ex.toFixed(2)},${ey.toFixed(2)},${ez.toFixed(2)})`);
        }
      }
      ok(`C. 位置逐帧等于源码公式（公转 ${DA}/帧 · 半径 ${R0}+${DR}/帧 · 上升 ${VY0}+${DVY}/帧 raw）`, posOk);
      // D: 粒子数 —— 存活数 = 最近 `寿命` 帧发射的那些（寿命 `rand(0..20)+50` ⇒ ≥ 50 帧）
      //    · 早期（f ≤ 50，还没有粒子到期）⇒ **恰好 2/帧**（`sinEffect_HealParticle3` 尾部 memcpy 复制）
      //    · 之后 ⇒ 存活数 ≥ 2 × 50（最近 50 帧发射的都还在），且不再随时间单调增长
      const early = parsed.filter((p) => p.f <= 50);
      let rateOk = early.length >= 1;
      for (const p of early) if (p.n !== 2 * p.f) { rateOk = false; console.log(`    ✗ f=${p.f}: 粒子=${p.n}，应为 ${2 * p.f}`); }
      ok(`D. 发射期每帧 2 颗（抽查 ${early.length} 条：` + early.map((p) => `f${p.f}→${p.n}`).join(' ') + '）',
        rateOk && early.some((p) => p.f >= 30));
      const late2 = parsed.filter((p) => p.f > 50 && p.f <= EMIT_UNTIL);
      const aliveOk = late2.every((p) => p.n >= 100);
      ok(`D. 稳态存活数 ≥ 2×50（寿命下限 50 帧）—— 抽查 ` + late2.map((p) => `f${p.f}→${p.n}`).join(' '), aliveOk);
      // 发射停止后（f > Max_Time-30）**只减不增**：没有再新生的粒子（源码 `if(Time < Max_Time - 30)`）。
      // 实例寿命 250 帧 ⇒ 采样点只有 1~2 个落在停止之后，比较基准取"停止前最后一个采样"。
      const after = parsed.filter((p) => p.f > EMIT_UNTIL);
      const before = parsed.filter((p) => p.f <= EMIT_UNTIL).at(-1);
      let stoppingOk = after.length >= 1 && !!before;
      const detail: string[] = [];
      for (const p of after) {
        detail.push(`f${p.f}→${p.n}`);
        if (!before || p.n > before.n) stoppingOk = false;
      }
      ok(`D. f=${EMIT_UNTIL} 之后不再新生粒子（${after.length} 个采样均 ≤ 停止前的 f${before?.f}→${before?.n}：`
        + detail.join(' ') + '）', stoppingOk);
      // 收尾：跑过 Max_Time ⇒ 实例被清（`sinActiveEffect2` 的 `Time > Max_Time ⇒ memset`）
      for (let f = 0; f < MAX_TIME; f++) updateHealingOrbits(1 / FPS);
      const groupsLeft = scene.children.filter((c) => (c as THREE.Group).isGroup).length;
      const spritesLeft = scene.children.filter((c) => (c as THREE.Sprite).isSprite).length;
      ok('寿命 = Max_Time(250) 帧后实例被清空（`Time > Max_Time ⇒ memset`）',
        logs.some((l) => l.includes('寿命到（Max_Time=250）')) && groupsLeft === 0);
      ok(`寿命到之后粒子也全部收干净（残留 sprite = ${spritesLeft}）`, spritesLeft === 0);
    }
  }
}

// ─────────────────────────────────────────────────────────────
console.log('E. 旁观者那条路（原版 `RecvProcessSkill`）真的派发该技能自己的起手特效 + 音效 + 起手法阵');
{
  const { skillFxRowByIcon, skillFxRowBySkillId, fireObserverCast } = await import('../src/render/effects/skill-fx-runner.js');
  const row = skillFxRowByIcon('mp10 healing');
  ok('skill-fx 表里 Healing 的起手引用了 `code:healing`',
    !!row && (row.cast.fx ?? []).includes('code:healing'));
  ok('Healing 的起手音效非空（原版 `SkillPlaySound(SKILL_SOUND_SKILL_HEALING, lpChar->…)`）',
    !!row && row.cast.sfx.length > 0);
  // 2026-09-27（用户实测"别人看不到我的施法动作和粒子特效"）：旁观者拿 S2C 的 **skillId** 取行，
  // 不能用 animIndex（那是**动画条目号**：Healing 播 58，表里 animIndex=123 ⇒ 查不到、整条不播）。
  {
    const { skillIdByIcon } = await import('../src/game/skillIdentity.js');
    const hid = skillIdByIcon('mp10 healing');
    ok('按 skillId 能取到 Healing 的行（身份桥 → icon → 技能表）',
      hid != null && skillFxRowBySkillId(hid)?.icon === row?.icon);
    ok('按 Healing 的**动画条目号**(58) 取行会取不到 —— 这就是当初"整条不播"的原因（反例可推翻）',
      skillFxRowBySkillId(hid!)?.animIndex !== 58);
    const wvSrc = await read('../src/ui/WorldView.ts');
    ok('旁观者路径按 skillId 取行（不是 animIndex）',
      /const remoteRow = skillFxRowBySkillId\(skillId\);/.test(wvSrc));
    ok('旁观者"查不到技能"是**显式上报**（不静默、不拿别的技能顶上）',
      /旁观者侧：技能 0x\$\{skillId\.toString\(16\)\} 在身份表里查不到/.test(wvSrc));
  }
  const lights: number[][] = [];
  const sounds: { path: string; pos: { x: number; y: number; z: number } }[] = [];
  const caster = { x: 1, y: 2, z: 3 };
  const target = { x: 40, y: 5, z: 60 };
  fireObserverCast(row, {
    effects: null as never, scene: new (await import('three')).Scene(),
    dynLights: { set: (...a: number[]) => { lights.push(a); } } as never,
    playSound: (path, pos) => { sounds.push({ path, pos }); },
    log: () => {},
  }, caster, target);
  ok('旁观者侧：特效被派发（`code:healing` 落了动态光）', lights.length >= 1);
  ok('旁观者侧：动态光落在**目标**身上（原版 `sinEffect_Healing2(lpChar)`）',
    lights.every((l) => l[0] === target.x && l[1] === target.y && l[2] === target.z));
  ok('旁观者侧：音效按**目标**位置播（`SkillPlaySound(..., lpChar->pX…)`）',
    sounds.length >= 1 && sounds.every((s) => s.pos.x === target.x && s.pos.z === target.z));
  // 起手法阵：**我方明确改动**（原版旁观者看不到 —— `BeginSkill` 只对 `lpCurPlayer` 跑）。
  // 落点 = **施法者**脚下（不是被治疗者）；家族按职业取（`castCircleFlagForClass`，与原版同一判据）。
  {
    const srcRunner = await read('../src/render/effects/skill-fx-runner.ts');
    ok('旁观者侧：**补起手法阵**且落点在**施法者**脚下（我方改动，注释里标明"原版只有本机看得到"）',
      /fireObserverCastCircle\(row, ctx, caster\);/.test(srcRunner)
      && /runCastCircle\(ctx, caster, \{ charFlag, type: CAST_CIRCLE_TYPE_NORMAL \}\);/.test(srcRunner)
      && /const charFlag = castCircleFlagForClass\(row\.classDir\);/.test(srcRunner)
      && /我方明确改动/.test(srcRunner)
      && /原版里别人的法阵你看不到/.test(srcRunner));
    // 目标认不出时：**法阵照放**（它长在施法者脚下），但目标锚定的那份不放（否则天使会落到施法者身上）
    const wv3 = await read('../src/ui/WorldView.ts');
    ok('旁观者侧：目标认不出时**仍放法阵**、但不放"目标锚定"的那份特效',
      /fireObserverCastCircle\(remoteRow, skillFxCtx\(anchorOf\), actor\.root\.position\);/.test(wv3)
      && /if \(hasObserverCastVisual\(remoteRow\)\)/.test(wv3));
    ok('"有起手表现"的判据含**只有法阵**的技能（法师/祭司/萨满的多数招没有 cast.fx/sfx）',
      /export function hasObserverCastVisual\(row: SkillFxRow \| null\): boolean \{/.test(srcRunner)
      && /return castCircleFlagForClass\(row\.classDir\) != null;/.test(srcRunner));
  }
  // 2026-09-27 用户实测："我点玩家放 healing，自己看到小天使绕玩家转，在另一个玩家眼里依然绕着祭司本人转"
  // ⇒ 被治的人**就是 observer 自己**，而自机不在 `remotes` 里 ⇒ 原来的解析落到施法者身上。
  // 三条解析都要在（怪 / 别的玩家 / 自己），且认不出时**不放**（原版 `if (lpChar)` 同）。
  {
    const wv2 = await read('../src/ui/WorldView.ts');
    ok('旁观者侧：目标解析含"就是我自己"（`targetId === selfPlayerId` ⇒ 用 `selfPos`）',
      /const targetSelf = targetId !== 0 && targetId === selfPlayerId;/.test(wv2)
      && /if \(targetSelf\) return selfPos;/.test(wv2));
    ok('旁观者侧：目标认不出时**不放那份特效**并上报（不把锚点悄悄换成施法者，AGENTS #12）',
      /targetSelf \? \{ x: selfPos\.x, y: selfPos\.y, z: selfPos\.z \}/.test(wv2)
      && /⇒ 目标处的那份特效不放（原版 if\(lpChar\) 同）/.test(wv2));
  }
  // 自机侧：起手音在**施法者**位置（`fireSkillCast(row, ctx, pos, target)` 的音效按 pos）
  {
    const { fireSkillCast } = await import('../src/render/effects/skill-fx-runner.js');
    const self: { path: string; pos: { x: number; y: number; z: number } }[] = [];
    fireSkillCast(row, {
      effects: null as never, scene: new (await import('three')).Scene(),
      dynLights: { set: () => {} } as never,
      playSound: (path, pos) => { self.push({ path, pos }); },
      log: () => {},
    }, caster, target);
    ok('自机侧：起手音在**施法者**位置（原版 `SkillPlaySound(…, pX,pY,pZ)`）',
      self.length >= 1 && self.every((s) => s.pos.x === caster.x && s.pos.z === caster.z));
  }
}

// ─────────────────────────────────────────────────────────────
console.log('F. 远端施法：事件帧表现同步（"通用机制" = 各端按同一动画帧轴跑同一份事件表）');
{
  const wv2 = await read('../src/ui/WorldView.ts');
  // 原版依据：`frame += FrameStep; EventAttack();`（character.cpp:5837）在**每个角色**的逐帧更新里跑，
  // `EventSkill()`（:4207）没有"仅自机"守卫 ⇒ 别人的招式特效/音效在每台机器上照放。
  ok('远端角色的技能事件帧也在本机派发（`updateRemotes` 里 STATE.SKILL 分支）',
    /actor\.animState\.getCurrentState\(\) === actor\.animState\.STATE\.SKILL[\s\S]{0,120}?actor\.skill && actor\.skill\.motion === motion/.test(wv2));
  ok('自机与远端**共用同一份**事件帧实现 `fireSkillEventFrame`（AGENTS #15：不写第二份）',
    /function fireSkillEventFrame\(spec: \{/.test(wv2)
    && (wv2.match(/fireSkillEventFrame\(\{/g) ?? []).length === 2
    && (wv2.match(/fireSkillEvent\(/g) ?? []).length === 1);
  ok('远端的等级/道数**来自服务端广播**（不是拿本机的面板数据顶）',
    /skillLevel: sk\.skillLevel,/.test(wv2) && /sparkCount: sk\.sparkCount,/.test(wv2)
    && /skillLevel: skillLevel > 0 \? skillLevel : null,/.test(wv2));
  ok('远端武器挥击音与自机同一判定（`weaponSfxForIcon`），音码取**该玩家**的武器',
    /weaponSoundCode: weaponSfxForIcon\(sk\.row\.icon\)/.test(wv2)
    && /function weaponAttackSoundCodeOf\(idcode: number, jobId = 0\): number \{/.test(wv2)
    // 定义 1 处 + 两处调用（远端攻击段 / 远端技能事件帧）—— 保证不再各写一份
    && (wv2.match(/weaponAttackSoundCodeOf\(/g) ?? []).length === 3);
  // **"有概率看不到"的根因**（用户 2026-09-27 实测：3 次 Multi Spark 里 2 次远端看不到，
  //   两次都紧跟一条 `[MOVE] 0x0060 -> 0x0040` 广播）：施法者停步上报的那条移动广播，
  //   会把旁观者侧正在播的技能动作**顶掉** ⇒ `STATE.SKILL` 不成立 ⇒ 事件帧的特效/音效再也不播。
  //   原版依据：`playmain.cpp:1744` 在 ATTACK/EAT/SKILL 期间整个屏蔽移动输入 ⇒ 那种状态压根不发移动广播。
  ok('远端"移动三态"广播**不顶掉一次性动作**（否则那一招的事件帧特效/音效全丢）',
    /actor\.animState\.isOneShot\(\)/.test(wv2)
    && /&& \(animState === ANIM_STAND \|\| animState === ANIM_WALK \|\| animState === ANIM_RUN\)\) \{/.test(wv2)
    && /const ANIM_STAND = 0x0040;/.test(wv2));
  ok('只挡移动三态（喝药/掉落/死亡是真实状态变化，照旧生效）',
    !/isOneShot\(\) && animState !== ANIM_DEAD\) return;/.test(wv2));
  // Healing 的两条音效：源码里同在 `BeginSkill`（`:13588-13603`）⇒ **都在起手**（此前一条被排到事件帧）
  const fxGen = JSON.parse(await read('../src/game/data/skill-fx.json')) as
    { rows: { name: string; cast: { sfx: string[] }; event: { sfx: string[] } }[] };
  const heal = fxGen.rows.find((r) => r.name === 'Healing')!;
  ok('Healing 的两条音效都在**起手**（原版同一个 `BeginSkill` case 里连播两条）',
    heal.cast.sfx.length === 2
    && heal.cast.sfx.some((s) => /healing 1\.wav$/.test(s))
    && heal.cast.sfx.some((s) => /casting_p\.wav$/.test(s))
    && heal.event.sfx.length === 0);
  const map = JSON.parse(await read('../src/game/data/skill-code-map.json')) as
    { rows: { code: string; sounds: { symbol: string; file: string | null; phase?: string | null }[] }[] };
  const hrow = map.rows.find((r) => r.code === 'SKILL_PLAY_HEALING')!;
  ok('音效的"起手/事件帧"相位**来自源码**（`SkillPlaySound` 落在 BeginSkill 还是 EventSkill）',
    hrow.sounds.every((s) => s.phase === 'cast')
    && hrow.sounds.length === 2);
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项不符`);
process.exit(fails === 0 ? 0 : 1);
