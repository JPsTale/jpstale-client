import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync('src/game/data/skill-fx.json', 'utf8')) as any;
for (const r of j.rows) {
  if (r.job !== 4) continue;
  console.log(`${r.icon} anim=${r.animIndex} code=${r.code} cast=${JSON.stringify(r.cast.sfx)} ev=${JSON.stringify(r.event.sfx)} fx=${JSON.stringify(r.fx)} evfx=${JSON.stringify(r.event.fx)}`);
}
