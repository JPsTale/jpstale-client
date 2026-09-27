# 只读分诊 v2：namekey IS NULL 的行 —— 模拟"扩展阶梯"能救回多少，其余按原因归类。
# 扩展阶梯（只对"现行规则给出 NULL"的行生效，绝不改动已有键）：
#   E1 全候选(11job∪3060)按统一 norm(空白+下划线)匹配 *Name，唯一命中且有中文名 ⇒ 键
#   E2 命中不唯一 ⇒ 命中集合里 zhoon(①源)词干唯一 ⇒ 键
#   E3 仍不唯一 ⇒ 命中集合里 3060 词干唯一 ⇒ 键
#   E4 仍无 ⇒ 全候选里中文名唯一（3060 补进 zh 集合后的规则②加强版）⇒ 键
# 跑法： python -X utf8 tmp/analyze_null_namekeys.py
import re, subprocess, sys
from pathlib import Path

M11 = Path(r'E:/BaiduNetdiskDownload/精灵/精灵11职业单机版一键端/精灵11职业单机版一键端/Server服务端/GameServer/Monster')
M30 = Path(r'E:/BaiduNetdiskDownload/3060/GameServer/Monster')
CJK = re.compile(r'[\u4e00-\u9fff]')
norm = lambda s: re.sub(r'[\s_]+', '', s.lower())

def dec(p): return p.read_bytes().decode('gbk', errors='replace')

inf11 = {}
for p in M11.iterdir():
    if p.suffix.lower() != '.inf': continue
    t = dec(p)
    m = re.search(r'\*\s*葛剧颇老\s*"([^"]*)"', t)
    n = re.search(r'\*\s*Name\s*"([^"]*)"', t)
    if m:
        inf11[p.stem.lower()] = (m.group(1).strip().lower(), n.group(1).strip() if n else None)

# zhoon：按生成器的裁定（注释指向的 inf 的模型 ≠ 本文件名词干的模型 ⇒ 按文件名归）落到 target 词干
zhoon_by_target = {}
zhoon_raw_keys = set()
for p in (M11 / 'name').iterdir():
    if p.suffix.lower() != '.zhoon': continue
    t = dec(p)
    nm = re.search(r'\*\s*B_NAME\s*"([^"]*)"', t)
    if not nm: continue
    nm = nm.group(1).strip()
    if not CJK.search(nm): continue
    zhoon_raw_keys.add(p.stem.lower())
    cmt = re.search(r'^//\s*(\S+\.inf)', t, re.M)
    cstem = re.sub(r'\.inf$', '', cmt.group(1).strip().lower()) if cmt else None
    stem = p.stem.lower()
    own = inf11.get(stem)
    target = stem
    if cstem and cstem in inf11:
        if own and inf11[cstem][0] != own[0]:
            target = stem
        else:
            target = cstem
    if target in inf11:
        zhoon_by_target.setdefault(target, nm)

inf30 = {}
for p in M30.iterdir():
    if p.suffix.lower() != '.inf': continue
    t = dec(p)
    m = re.search(r'\*\s*外型文件\s*"([^"]*)"', t)
    c = re.search(r'\*\s*名字\s*"([^"]*)"', t)
    if m:
        cn = c.group(1).strip() if c else None
        inf30[p.stem.lower()] = (m.group(1).strip().lower(), cn if cn and CJK.search(cn) else None)

SQL = ("select id, name, coalesce(namekey,'NULL'), lower(modelfile) from gamedb.monsterlist "
       "where modelfile is not null and modelfile <> '0' order by id")
r = subprocess.run(['ssh', 'root@192.168.31.10',
                    'podman exec -i priston-pg psql -U sa -d pristontale -At -F"|" -c "' + SQL + '"'],
                   capture_output=True, text=True)
if r.returncode != 0:
    sys.exit('ssh/psql 失败: ' + r.stderr)
rows = []
for line in r.stdout.splitlines():
    f = line.split('|')
    if len(f) == 4 and f[0].isdigit():
        rows.append((int(f[0]), f[1].strip(), None if f[2] == 'NULL' else f[2], f[3]))

def cands_for(model):
    out = {}
    for stem, (m, en) in inf11.items():
        if m == model: out[stem] = ('11', en)
    for stem, (m, cn) in inf30.items():
        if m == model: out.setdefault(stem, ('30', None))
    return out

def zh_name(stem):
    if stem in zhoon_by_target: return zhoon_by_target[stem]
    return inf30.get(stem, (None, None))[1]

def extended(name, model):
    """返回 (key, zh, 途径) 或 (None, None, 原因)。只用于现行规则下为 NULL 的行。"""
    cands = cands_for(model)
    if not cands: return None, None, '两源都无此模型 inf'
    hit = [s for s, (src, en) in cands.items() if en and norm(en) == norm(name)]
    if len(hit) == 1 and zh_name(hit[0]):
        return hit[0], zh_name(hit[0]), 'E1 统一norm唯一命中'
    if hit:
        h2 = [s for s in hit if s in zhoon_by_target or s in zhoon_raw_keys]
        if len(h2) == 1 and zh_name(h2[0]):
            return h2[0], zh_name(h2[0]), f'E2 zhoon优先({len(hit)}命中)'
        h3 = [s for s in hit if s in inf30 and inf30[s][1]]
        if len(h3) == 1 and zh_name(h3[0]):
            return h3[0], zh_name(h3[0]), f'E3 3060优先({len(hit)}命中)'
    zc = [s for s in cands if zh_name(s)]
    if len(zc) == 1:
        return zc[0], zh_name(zc[0]), f'E4 全候选唯一zh({len(cands)}候选,{len(hit)}命中)'
    return None, None, f'{len(cands)}候选/命中{len(hit)}/zh候选{len(zc)}: ' + ','.join(sorted(cands))

null_rows = [r_ for r_ in rows if r_[2] is None]
print(f'可匹配行 {len(rows)}，namekey=NULL {len(null_rows)}\n')

rescuable, stays = [], {}
for (id_, name, key, model) in null_rows:
    k, zh, how = extended(name, model)
    if k: rescuable.append((id_, name, k, zh, how))
    else:
        tag = how.split(':')[0].split('(')[0].split('/')[0]
        stays.setdefault(tag, []).append((id_, name, model, how))

print(f'== 扩展阶梯可救回：{len(rescuable)} ==')
for id_, name, k, zh, how in rescuable:
    print(f'  id={id_:4} {name:26} -> {k:24} zh={zh}  [{how}]')

stays_total = sum(len(v) for v in stays.values())
print(f'\n== 仍无解 {stays_total} 行 ==')
for tag, items in sorted(stays.items(), key=lambda x: -len(x[1])):
    print(f'\n[{tag}] {len(items)} 行')
    for id_, name, model, how in items[:15]:
        print(f'  id={id_:4} {name:26} {how[:110]}')
    if len(items) > 15: print(f'  ... 共 {len(items)} 行')
