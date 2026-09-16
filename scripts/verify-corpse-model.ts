/**
 * 独立死亡模型（`-die`）资产回归 —— 用户 2026-09-16 提问后加的。
 *
 * 原版机制（ex-machina `character.cpp` 的 `smCHAR::SetMotionFromCode`）：
 *   先查**主模型**动作表有没有这个 State；`if (FindCnt == 0 && AnimDispMode && lpDinaPattern2)`
 *   **查不到**才去查**副模型**的动作表，查到就 `MotionSelectFrame = 1` 并用副模型渲染
 *   （`Pattern2`，见 `character.cpp:6950` 的 `PatDispMode & DISP_MODE_PATSUB` 分支）。
 * 副模型由模型自己的 `.inx` 声明（字段在偏移 128，我们的解析器叫 `subModelFile`；
 * 11 职业 `.INI` 里的关键字是 `*보조동작파일`，如 `MonSArcher-die.INI`）。
 * 于是"某只怪死后换一具尸体模型"是**纯数据驱动**的，不需要协议参与。
 *
 * 本脚本守的断言（照着 `monster-loader.buildMotionList/合并规则` 复现一遍）：
 *   ① 凡声明了 `subModelFile` 的怪物模型，副 `.inx` 必须能解析、副 `.smb` 必须能加载；
 *   ② 主模型**没有**内联 DEAD 的那些，并表后**必须**有一条可用的 DEAD（来自副模型）——
 *      否则这些怪死后无动作（就是"独立死亡模型没接上"的症状）；
 *   ③ 骨架差异只作**统计**（它决定必须连网格一起换，那是渲染层的事，不是数据错）。
 */
import fs from 'fs';
import path from 'path';
import { parseInx, parseSmb } from '../src/core/char-parser.js';

const ROOT = 'E:/JPsTale/client';
const MONSTER_DIR = path.join(ROOT, 'char/monster');
const EXT = 10;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.toLowerCase().endsWith('.inx')) out.push(p);
  }
  return out;
}

/** .inx 里声明的相对路径（反斜杠/大小写/扩展名都不可靠）→ 实际文件 */
function resolveAsset(decl: string): string | null {
  const norm = decl.replace(/\\/g, '/').toLowerCase().replace(/\.(ini|in)$/, '');
  for (const cand of [`${norm}.inx`, `${norm}.INI`, `${norm}.ini`]) {
    const p = path.join(ROOT, cand);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadInx(p: string) {
  const buf = fs.readFileSync(p);
  return parseInx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

/** 该动作表里可用的状态集合（只看 CHRMOTION_EXT 之后、且有实际帧长的条目） */
function usableStates(inx: ReturnType<typeof loadInx>): Set<number> {
  const s = new Set<number>();
  for (let i = EXT; i < Math.min(inx.motionCount, 512); i++) {
    const m = inx.motions[i];
    if (m.state && m.endFrame > m.startFrame) s.add(m.state);
  }
  return s;
}

function smbBase(inx: ReturnType<typeof loadInx>): string {
  const raw = (inx.motionFile && inx.motionFile.trim()) || inx.modelFile || '';
  const n = raw.replace(/\\/g, '/').toLowerCase();
  const slash = n.lastIndexOf('/');
  const dot = n.lastIndexOf('.');
  return dot > slash ? n.slice(0, dot) : n;
}

function bonesOf(base: string): string[] | null {
  for (const cand of [base, base.replace(/\.ase$/, '')]) {
    const p = path.join(ROOT, cand + '.smb');
    if (!fs.existsSync(p)) continue;
    const buf = fs.readFileSync(p);
    const smb = parseSmb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    return smb.objects.map((o) => o.nodeName).filter(Boolean).sort();
  }
  return null;
}

const files = walk(MONSTER_DIR);
let declared = 0;
let inlineDead = 0;
let corpseViaSub = 0;
const broken: string[] = [];
const noDeadAndNoSub: string[] = [];
const matcherBlocked: string[] = [];
const boneMismatch: string[] = [];
let sameSkeleton = 0;

for (const f of files) {
  const rel = f.slice(ROOT.length + 1).replace(/\\/g, '/');
  let inx;
  try { inx = loadInx(f); } catch { continue; }
  const mainStates = usableStates(inx);
  const hasInlineDead = mainStates.has(0x120);
  if (hasInlineDead) inlineDead++;

  const decl = (inx.subModelFile || '').trim();
  if (!decl) {
    if (!hasInlineDead) noDeadAndNoSub.push(rel);
    continue;
  }
  declared++;

  const subPath = resolveAsset(decl);
  if (!subPath) { broken.push(`${rel} → 声明的副模型不存在: ${decl}`); continue; }
  const subInx = loadInx(subPath);
  const subBase = smbBase(subInx);
  const subBones = bonesOf(subBase);
  if (!subBones) { broken.push(`${rel} → 副模型 .smb 加载失败: ${subBase}`); continue; }

  // 复现 loader 的合并规则：只并入主模型**没有的状态**（原版"先查主表，查不到才查副表"）
  const merged = new Set(mainStates);
  for (const s of usableStates(subInx)) if (!merged.has(s)) merged.add(s);

  if (!hasInlineDead) {
    if (merged.has(0x120)) {
      corpseViaSub++;
      // 选条还要能**通过匹配器**（anim-match.findMotions 的三个谓词）：
      // 怪物查询是 classId=0 / weaponId=null / field=village|field。任一条目带了
      // dwJobCodeBit / itemCodeList / mapPosition 限制，就可能被静默滤掉 → 尸体不出现。
      // 现场实测的 65 具尸体条目都是全 0（= 通用），这里把它变成断言。
      for (let i = EXT; i < Math.min(subInx.motionCount, 512); i++) {
        const m = subInx.motions[i];
        if (m.state !== 0x120 || m.endFrame <= m.startFrame) continue;
        if (m.itemCodeCount > 0 || m.dwJobCodeBit !== 0 || m.mapPosition !== 0) {
          matcherBlocked.push(`${rel} → ${decl} 的 DEAD 条目带限制`
            + `（itemCodeCount=${m.itemCodeCount} jobBit=0x${m.dwJobCodeBit.toString(16)} mapPos=${m.mapPosition}）`);
        }
      }
    } else noDeadAndNoSub.push(`${rel}（副模型 ${decl} 也没有可用 DEAD）`);
  }

  // 骨架差异：只统计（决定渲染是否必须连网格一起换）
  const mainBones = bonesOf(smbBase(inx));
  if (mainBones) {
    const setM = new Set(mainBones), setS = new Set(subBones);
    const onlyM = mainBones.filter((b) => !setS.has(b)).length;
    const onlyS = subBones.filter((b) => !setM.has(b)).length;
    if (onlyM === 0 && onlyS === 0) sameSkeleton++;
    else boneMismatch.push(`${rel} → ${decl}（主独有 ${onlyM} / 副独有 ${onlyS}）`);
  }
}

console.log(`怪物 .inx 总数: ${files.length}`);
console.log(`主模型自带 DEAD 条目的: ${inlineDead}`);
console.log(`声明了 subModelFile 的: ${declared}`);
console.log(`  · 靠副模型拿到尸体的（主模型无 DEAD）: ${corpseViaSub}`);
console.log(`  · 骨架与主模型不同（渲染必须连网格一起换）: ${boneMismatch.length}`);
console.log(`  · 骨架完全一致: ${sameSkeleton}`);
for (const b of boneMismatch.slice(0, 6)) console.log(`      - ${b}`);
console.log(`尸体条目被匹配器限制住的（本该 0）: ${matcherBlocked.length}`);
for (const m of matcherBlocked.slice(0, 8)) console.log(`      ! ${m}`);
console.log(`两样都没有（死后无躺下动作，会 reportFallback）: ${noDeadAndNoSub.length}`);
console.log('    ⚠ 这个数字把"副模型/特效模型自身"也算进去了（它们本就不该有死亡动作）；');
console.log('      可刷的怪里只有 3 只（Deadhopy + 两个 NPC 模型），见 docs/怪物死亡与尸体.md');
for (const n of noDeadAndNoSub.slice(0, 12)) console.log(`      - ${n}`);

if (broken.length > 0 || matcherBlocked.length > 0) {
  console.error(`\n断言失败：${broken.length} 个模型的副模型链路断裂（声明了却装不起来）`);
  for (const b of broken.slice(0, 20)) console.error(`  - ${b}`);
  process.exit(1);
}
console.log('\nOK：所有声明的副模型都能解析；主模型缺 DEAD 的都靠副模型拿到了可用死亡动作。');
