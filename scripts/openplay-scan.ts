/**
 * **右键"无目标施放"技能名单的扫描器** —— 从原版 `OpenPlaySkill()` 里把那串 `case SKILL_*` 抠出来。
 *
 * ⚠ 唯一实现：生成器 `extract-openplay-skills.ts` 与校验脚本 `verify-mouse-cast.ts` **都调这里**，
 * 所以"重跑生成器 → 名单一致"这条断言是真的在**重算**，而不是比对两份手抄。
 *
 * 判据（不靠行号窗口 —— 行号窗口会漏，见下）：
 *   ① 定位 `int OpenPlaySkill(sSKILL *lpSkill)` 的函数头行；
 *   ② 在该函数体里找 `switch (lpSkill->Skill_Info.CODE)`，按**花括号配对**求出该 switch 的 `}`；
 *   ③ 取区间内**花括号深度恰好 = 1**（即直接贴在 switch 花括号内，非嵌套 switch）的 `case SKILL_*`。
 *
 * ⚠ **为什么不用 `sed -n '29,1200p'` 那种行号窗口**：那会把 switch 尾部（`SKILL_R_KNIGHT` 起 8 条）
 * 切掉 → 得到 57 条；而按上面判据抠出来是 **65 条**（= `docs/技能施法-原版流程.md` 附录 A 的 65）。
 * 同文件 `GetSkillDistRange()`（技能射程表）也有 `case SKILL_*` —— 那是**另一个函数里的另一个 switch**，
 * 本扫描器按"函数内那个 switch 的闭合位置"排除（`scanSwitchCases` 可被调用方用来把它也扫出来做**反向断言**）。
 */

export interface OpenPlayCase {
  /** 宏名（`sinbaram/sinSkill.h` 里的技能码） */
  macro: string;
  /** 1-based 源码行号（`case` 那一行） */
  line: number;
}

export interface OpenPlayScan {
  /** 函数头所在行（1-based） */
  funcLine: number;
  /** 该函数闭合 `}` 所在行（1-based）—— 用来证明"名单取的是这个函数的 switch，且函数体里没有漏掉的 `case`" */
  funcEndLine: number;
  /** `switch (lpSkill->Skill_Info.CODE)` 所在行（1-based） */
  switchLine: number;
  /** 该 switch 的闭合 `}` 所在行（1-based） */
  switchEndLine: number;
  cases: OpenPlayCase[];
  /** 区间内**深度 ≠ 1** 的 `case SKILL_*`（嵌套 switch 自己的分支）—— 出现在这里说明判据要复核 */
  nestedCases: OpenPlayCase[];
}
/** 把 `/* *\/` 与 `//` 注释、`"…"`/`'…'` 字面量替换成等长空格 —— 长度不变，行号与深度都不受影响 */
function maskTrivia(text: string): string {
  const out = text.split('');
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] !== '\n') out[i] = ' '; i++; }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      out[i] = ' '; i++;
      while (i < n && text[i] !== q) {
        if (text[i] === '\\') { out[i] = ' '; i++; if (i < n) { out[i] = ' '; i++; } continue; }
        if (text[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) { out[i] = ' '; i++; }
      continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * 通用：扫某个函数里**那一个** switch 的全部 `case SKILL_*`。
 * @param funcPattern 函数头匹配（`^` 锚定行首）
 * @param funcName 报错信息里用的函数名
 * @param switchPattern 该函数里目标 switch 的匹配（`^` 不锚定 —— 它缩进在函数体内）
 * @throws 找不到函数头 / 找不到 switch / 花括号不配对 / 名单为空 —— 一律抛错，不静默返回空集
 */
export function scanSwitchCases(text: string, funcPattern: RegExp, funcName: string, switchPattern: RegExp): OpenPlayScan {
  const lines = maskTrivia(text).split('\n');

  const funcLine = lines.findIndex((l) => funcPattern.test(l));
  if (funcLine < 0) throw new Error(`未找到 \`${funcName}\` 函数头`);
  const switchLine = lines.findIndex((l, i) => i >= funcLine && switchPattern.test(l));
  if (switchLine < 0) throw new Error(`${funcName} 内未找到目标 switch`);

  // 花括号配对求 switch 的闭合行（同时逐行记"行首深度"，用于判 `case` 是否贴在 switch 花括号里）
  let depth = 0;
  let started = false;
  let switchEndLine = -1;
  const depthAtLineStart = new Map<number, number>();
  for (let i = switchLine; i < lines.length; i++) {
    depthAtLineStart.set(i, depth);
    for (const ch of lines[i]!) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') { depth--; }
    }
    if (started && depth === 0) { switchEndLine = i; break; }
  }
  if (switchEndLine < 0) throw new Error(`${funcName} 的 switch 花括号未配对（没找到闭合的 \`}\`）`);

  // 函数自身的闭合行（证明 switch 确实在这个函数里，且函数体内再无别的 `case`）
  let fDepth = 0;
  let fStarted = false;
  let funcEndLine = -1;
  for (let i = funcLine; i < lines.length; i++) {
    for (const ch of lines[i]!) {
      if (ch === '{') { fDepth++; fStarted = true; }
      else if (ch === '}') { fDepth--; }
    }
    if (fStarted && fDepth === 0) { funcEndLine = i; break; }
  }
  if (funcEndLine < 0) throw new Error(`${funcName} 的函数花括号未配对`);
  if (switchEndLine > funcEndLine) throw new Error(`${funcName}: switch 闭合行 ${switchEndLine + 1} 晚于函数闭合行 ${funcEndLine + 1}`);

  const cases: OpenPlayCase[] = [];
  const nestedCases: OpenPlayCase[] = [];
  for (let i = switchLine + 1; i < switchEndLine; i++) {
    const m = /^\s*case\s+(SKILL_[A-Za-z0-9_]+)\s*:/.exec(lines[i]!);
    if (!m) continue;
    const item = { macro: m[1]!, line: i + 1 };
    // 行首深度 1 = 直接贴在 switch 的花括号里（case 标签所在层）；更深 = 嵌套 switch 自己的分支
    if (depthAtLineStart.get(i) === 1) cases.push(item);
    else nestedCases.push(item);
  }

  if (cases.length === 0) throw new Error(`${funcName} 的 switch 内一个 \`case SKILL_*\` 都没抠到 —— 判据失效，别当天名单为空`);

  // 完整性：switch 闭合之后、函数闭合之前**不该再有** `case SKILL_*` ——
  // 有的话说明"这个函数里还有第二个 switch"，那就不能只取第一个（宁可报错，不许少列）
  const after: OpenPlayCase[] = [];
  for (let i = switchEndLine + 1; i <= funcEndLine; i++) {
    const m = /^\s*case\s+(SKILL_[A-Za-z0-9_]+)\s*:/.exec(lines[i]!);
    if (m) after.push({ macro: m[1]!, line: i + 1 });
  }
  if (after.length) {
    throw new Error(`${funcName}: switch 之后、函数闭合之前还有 ${after.length} 个 \`case SKILL_*\`（${after.map((c) => `${c.macro}@${c.line}`).join(', ')}）—— 该函数不止一个 switch，判据要改`);
  }

  return {
    funcLine: funcLine + 1, funcEndLine: funcEndLine + 1,
    switchLine: switchLine + 1, switchEndLine: switchEndLine + 1,
    cases, nestedCases,
  };
}

/**
 * `OpenPlaySkill()` 的无目标施放名单 —— 右键"点空地也能放"的那批技能。
 * @throws 见 `scanSwitchCases`
 */
export function scanOpenPlayCases(text: string): OpenPlayScan {
  return scanSwitchCases(text, /^\s*int\s+OpenPlaySkill\s*\(/, 'OpenPlaySkill',
    /switch\s*\(\s*lpSkill->Skill_Info\.CODE\s*\)/);
}

/**
 * `GetSkillDistRange()` 的**技能射程表** —— 它不是施放名单，只是用来做**反向断言**
 * （证明扫描器没有把另一个 switch 的分支混进来）。
 */
export function scanSkillDistRangeCases(text: string): OpenPlayScan {
  return scanSwitchCases(text, /^\s*int\s+GetSkillDistRange\s*\(/, 'GetSkillDistRange',
    /switch\s*\(\s*lpSkill->CODE\s*\)/);
}
