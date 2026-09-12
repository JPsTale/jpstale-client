/**
 * 列出 11 职业客户端 `char/tmABCD` 里有、而我方 `client/char/tmabcd` 里没有的文件。
 * 用于补齐格斗家（第 11 职业）等缺失的模型/纹理资产。
 *
 * 只读，不复制。复制由 `--copy` 显式触发。
 * 用法：npx tsx scripts/diff-tmabcd.ts [--copy]
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = 'E:/BaiduNetdiskDownload/精灵/精灵11职业单机版一键端/精灵11职业单机版一键端/Game客户端/char/tmABCD';
const DST = 'E:/JPsTale/client/char/tmabcd';
const COPY = process.argv.includes('--copy');

const walk = (root: string, out: string[] = [], base = root): string[] => {
  let ents: string[] = [];
  try { ents = readdirSync(root); } catch { return out; }
  for (const e of ents) {
    const p = join(root, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out, base); else out.push(relative(base, p));
  }
  return out;
};

const src = walk(SRC);
const dstSet = new Set(walk(DST).map((f) => f.toLowerCase().replace(/\\/g, '/')));
const missing = src.filter((f) => !dstSet.has(f.toLowerCase().replace(/\\/g, '/')));

console.log(`11职业 tmABCD ${src.length} 个文件；我方 ${dstSet.size} 个；缺失 ${missing.length} 个\n`);

/** 按"去掉数字后的前缀"归类，便于看出缺的是哪一族 */
const fam = (f: string) => {
  const base = f.replace(/\\/g, '/').split('/').pop()!.toLowerCase();
  return base.replace(/[0-9]+/g, '#').replace(/\.[^.]+$/, '');
};
const byFam = new Map<string, string[]>();
for (const f of missing) byFam.set(fam(f), [...(byFam.get(fam(f)) ?? []), f]);

console.log('=== 缺失文件按族归类 ===');
for (const [k, v] of [...byFam.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(v.length).padStart(4)}  ${k.padEnd(18)} 例: ${v.slice(0, 3).map((x) => x.split(/[\\/]/).pop()).join(', ')}`);
}

if (COPY) {
  let n = 0;
  for (const f of missing) {
    const s = join(SRC, f);
    // 我方是小写折叠副本，故目标路径统一小写
    const d = join(DST, f.toLowerCase());
    mkdirSync(join(d, '..'), { recursive: true });
    if (existsSync(d)) continue;
    copyFileSync(s, d);
    n++;
  }
  console.log(`\n已复制 ${n} 个文件到 ${DST}`);
} else {
  console.log('\n（加 --copy 执行复制）');
}
