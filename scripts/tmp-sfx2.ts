import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const t = readFileSync('.env', 'utf8');
const assetRoot = /VITE_ASSET_ROOT\s*=\s*(.+)$/m.exec(t)![1].trim();
const j = JSON.parse(readFileSync('src/game/data/skill-fx.json', 'utf8')) as any;
for (const r of j.rows) {
  for (const s of [...r.cast.sfx, ...r.event.sfx]) {
    if (s.includes('brandish') || !existsSync(resolve(assetRoot, s))) {
      console.log(JSON.stringify({ icon: r.icon, job: r.job, path: s }));
    }
  }
}
