import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync('src/game/data/anim-in/skill-index-map.generated.json', 'utf8')) as any;
for (const k of ['knight','mecha','pikeman','fighter','assassin','shaman','martial']) {
  console.log('== ' + k);
  for (const r of j.classes[k]) console.log(`   ${r.iconFile.padEnd(30)} ${String(r.code).padStart(4)} ${r.src.padEnd(10)} ${r.evidence ?? ''}`);
}
