import {readFileSync} from 'node:fs';
const g=JSON.parse(readFileSync('src/game/data/anim-in/skill-index-map.generated.json','utf8'));
for(const cls of ['fighter','pikeman','priestess']){
  console.log('=== '+cls);
  for(const r of g.classes[cls]) console.log('  '+r.iconFile.padEnd(28), String(r.code).padStart(5), r.src.padEnd(11), r.evidence);
}
