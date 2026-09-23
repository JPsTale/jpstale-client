import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
const t = readFileSync('.env', 'utf8');
const assetRoot = /VITE_ASSET_ROOT\s*=\s*(.+)$/m.exec(t)![1].trim();
const j = JSON.parse(readFileSync('src/game/data/skill-fx.json', 'utf8')) as any;
const all = new Set<string>();
for (const r of j.rows) {
  for (const s of [...r.cast.sfx, ...r.event.sfx]) all.add(s);
}
console.log('unique sfx paths', all.size);
let miss = 0;
for (const s of [...all].sort()) {
  const p = resolve(assetRoot, s);
  if (!existsSync(p)) { console.log('MISSING ' + s); miss++; }
}
console.log('missing', miss);
