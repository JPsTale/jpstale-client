/**
 * 音效数据提取 —— 从 ex-machina 的 effectsnd.cpp/.h 生成客户端音效表，
 * 并扫描资产树生成"角色音效目录清单"（等价于原版 InitSoundEffect 的 FindFirstFile 预扫描）。
 *
 * 参考源：E:/repo/ex-machina/src/game/Legacy/Engine/Sound/effectsnd.{cpp,h}
 *   注意 ex-machina 是 JPT 源码的重构版，其纹理/渲染已现代化（如 .dds），
 *   但音效表属数据语义，与原版一致；路径大小写混排即原版原貌。
 *
 * 用法：npx tsx scripts/extract-sfx.ts
 *   可用 PT_ASSET_ROOT / PT_EXMACHINA_SOUND 覆盖默认路径。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC_DIR = process.env.PT_EXMACHINA_SOUND
  ?? 'E:/repo/ex-machina/src/game/Legacy/Engine/Sound';
const CPP = resolve(SRC_DIR, 'effectsnd.cpp');
const HDR = resolve(SRC_DIR, 'effectsnd.h');
const ASSET_ROOT = resolve(process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client');
const OUT_DIR = resolve('src/audio/data');

/* ─────────── C++ 解析 ─────────── */

/** 取出 name[] = { ... } 的完整花括号内容（跳过字符串与行注释） */
function extractArray(src: string, name: string): string {
  const re = new RegExp(`${name}\\s*\\[\\s*\\w*\\s*\\]\\s*=\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error(`找不到数组 ${name}`);
  let i = m.index + m[0].length - 1;
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

/** {"path", CODE} 形式的成对条目 */
function pairs(body: string): Array<{ text: string; code: string }> {
  const out: Array<{ text: string; code: string }> = [];
  const re = /\{\s*"((?:[^"\\]|\\.)*)"\s*,\s*([^},]+?)\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push({ text: m[1], code: m[2].trim() });
  return out;
}

/** 纯字符串数组 */
function strings(body: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

/** 归一化 wav 路径：反斜杠→斜杠、折叠重复分隔符、去首尾斜杠、小写
 *  （源文件里是 C++ 转义写法 "wav\\Effects\\..."，按字面读入后每个 \\ 会变成两个 /） */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
}

/** 去掉目录部分的尾斜杠，保留目录形态（供 charFolders 使用） */
function normDir(p: string): string {
  return normPath(p);
}

const cpp = readFileSync(CPP, 'utf8');
const hdr = readFileSync(HDR, 'utf8');

// #define 常量表（snCHAR_SOUND_* / SKILL_SOUND_*）
const defines = new Map<string, number>();
for (const m of hdr.matchAll(/^#define\s+(\w+)\s+(0x[0-9A-Fa-f]+|\d+)\s*$/gm)) {
  defines.set(m[1], Number(m[2]));
}

/** 把符号名解析为数值；解析不到则原样返回符号名（供运行时按名匹配） */
function codeOf(raw: string): number | string {
  if (/^\d+$/.test(raw)) return Number(raw);
  return defines.get(raw) ?? raw;
}

/* ─────────── 各表 ─────────── */

const motion = pairs(extractArray(cpp, 'snFindEffectsMotion')).map((e) => ({
  prefix: e.text,
  state: e.code, // CHRMOTION_STATE_*（原版在 smType.h/character.h 定义，此处保留符号）
}));

const weapon = pairs(extractArray(cpp, 'snFindEffectsWeapon')).map((e) => ({
  prefix: e.text,
  code: Number(e.code),
}));

const generic = strings(extractArray(cpp, 'esSoundWav'))
  .map(normPath)
  .filter(Boolean); // 末尾的 nullptr 不是字符串，天然不会进来

const charFolders = pairs(extractArray(cpp, 'snFindEffects')).map((e) => {
  const code = codeOf(e.code);
  return {
    dir: normDir(e.text),
    code,
    symbol: typeof code === 'number' ? e.code : '',
  };
});

const skillSounds = pairs(extractArray(cpp, 'SkillSoundWav')).map((e) => {
  const code = codeOf(e.code);
  return {
    file: normPath(e.text),
    code,
    symbol: typeof code === 'number' ? e.code : '',
  };
});

/* ─────────── 资产扫描：角色音效目录清单 ─────────── */

/** 按 snFindEffectsMotion 前缀把文件名归类（等价原版 FindMotionState + CompareHeadString） */
function motionOfFile(file: string): string | null {
  for (const m of motion) {
    if (file.toLowerCase().startsWith(m.prefix.toLowerCase())) return m.state;
  }
  return null;
}

const CANDIDATE_ROOTS = [
  'wav/effects/monster',
  'wav/effects/npc',
  'wav/effects/player',
];

const folders: Record<string, Record<string, string[]>> = {};
const unclassified: string[] = [];

function scan(dirAbs: string, dirRel: string): void {
  let entries: string[];
  try { entries = readdirSync(dirAbs); } catch { return; }
  const wavs = entries.filter((f) => f.toLowerCase().endsWith('.wav'));
  if (wavs.length) {
    const bucket: Record<string, string[]> = {};
    for (const f of wavs) {
      const st = motionOfFile(f);
      if (!st) { unclassified.push(`${dirRel}/${f}`); continue; }
      (bucket[st] ??= []).push(f.toLowerCase());
    }
    for (const k of Object.keys(bucket)) bucket[k].sort();
    folders[dirRel] = bucket;
  }
  for (const sub of entries) {
    const abs = join(dirAbs, sub);
    try { if (!statSync(abs).isDirectory()) continue; } catch { continue; }
    scan(abs, `${dirRel}/${sub.toLowerCase()}`);
  }
}

for (const root of CANDIDATE_ROOTS) {
  scan(join(ASSET_ROOT, root), root);
}

/* 武器音效：wav/effects/weapon/ 是扁平目录，按 snFindEffectsWeapon 前缀归到武器码 1-18 */
const WEAPON_DIR = 'wav/effects/weapon';
const weaponSounds: Record<string, string[]> = {};
const weaponUnclassified: string[] = [];
{
  let entries: string[] = [];
  try { entries = readdirSync(join(ASSET_ROOT, WEAPON_DIR)); } catch { /* 缺目录则跳过 */ }
  for (const f of entries.filter((x) => x.toLowerCase().endsWith('.wav'))) {
    const hit = weapon.find((w) => f.toLowerCase().startsWith(w.prefix.toLowerCase()));
    if (!hit) { weaponUnclassified.push(f); continue; }
    (weaponSounds[String(hit.code)] ??= []).push(`${WEAPON_DIR}/${f.toLowerCase()}`);
  }
  for (const k of Object.keys(weaponSounds)) weaponSounds[k].sort();
}

/* ─────────── 输出 ─────────── */

mkdirSync(OUT_DIR, { recursive: true });

const tables = { motion, weapon, generic, charFolders, skillSounds, weaponSounds };
writeFileSync(join(OUT_DIR, 'sfx-tables.json'), JSON.stringify(tables, null, 2) + '\n');
writeFileSync(join(OUT_DIR, 'sfx-folders.json'), JSON.stringify(folders, null, 2) + '\n');

const folderCount = Object.keys(folders).length;
const fileCount = Object.values(folders).reduce(
  (n, b) => n + Object.values(b).reduce((k, v) => k + v.length, 0), 0);
const weaponFileCount = Object.values(weaponSounds).reduce((n, v) => n + v.length, 0);

console.log(`[extract-sfx] 表：motion=${motion.length} weapon=${weapon.length} generic=${generic.length} ` +
  `charFolders=${charFolders.length} skillSounds=${skillSounds.length}`);
console.log(`[extract-sfx] 目录清单：${folderCount} 个目录 / ${fileCount} 个 wav`);
console.log(`[extract-sfx] 武器音效：${weaponFileCount} 个 / ${Object.keys(weaponSounds).length} 个武器码`);
if (unclassified.length) {
  console.log(`[extract-sfx] 未归类 ${unclassified.length} 个（原版同样存在，运行时忽略）：` +
    unclassified.slice(0, 8).join(', ') + (unclassified.length > 8 ? ' …' : ''));
}
if (weaponUnclassified.length) {
  console.log(`[extract-sfx] 武器未归类 ${weaponUnclassified.length} 个：${weaponUnclassified.join(', ')}`);
}
console.log(`[extract-sfx] 写出 ${OUT_DIR}`);
