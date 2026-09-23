import {readFileSync} from 'node:fs';
const j=JSON.parse(readFileSync('src/game/data/source/skill-mapping.json','utf8'));
const rows=j.mapping.filter(r=>r.class && /Fighter/i.test(r.class));
for(const r of rows) console.log(r.index, (r.class||'').padEnd(12), (r.code||'').padEnd(22), 'eu_code='+(r.eu_code||'-'), 'eu_icon='+(r.eu_icon??'-'), 'eu_lv='+(r.eu_level??'-'));
