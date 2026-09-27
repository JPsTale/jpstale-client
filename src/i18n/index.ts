// 平铺键表（2026-09-26 用户定的格式 + 命名）：文件里键就是**完整的点分 key**（如 `"gui.login.title": "登录"`），
// `t()` 直接查表、不再按 `.` 逐层下钻。数组值（`itemtip.jobTier.<n>` 的职业阶名单）只能给 `tList`。
import zhCn from '../locales/zh_cn.json';
import enUs from '../locales/en_us.json';

type LocTable = Record<string, string | string[]>;
const locales: Record<string, LocTable> = { zh: zhCn, en: enUs };
// 语言：localStorage 里手选的优先，否则跟浏览器语言（`zh*` → zh，其余 en）
let locale = localStorage.getItem('locale')
  ?? (navigator.language.startsWith('zh') ? 'zh' : 'en');

export function t(key: string, params?: Record<string, string | number>): string {
  const val: unknown = (locales[locale] ?? locales['zh'])[key];
  let msg = typeof val === 'string' ? val : key;
  if (params) {
    for (const [k, v] of Object.entries(params)) msg = msg.replace(`{${k}}`, String(v));
  }
  return msg;
}

/** 取一个**字符串数组**节点（如 `itemtip.jobTier.1` 的 5 阶职业名）；键不存在或不是数组 ⇒ 空数组。 */
export function tList(key: string): string[] {
  const val: unknown = (locales[locale] ?? locales['zh'])[key];
  return Array.isArray(val) ? (val as string[]) : [];
}

/** 翻译不到（t 回退为 key 自身）时回退到 fallback 原文，避免显示 "error.xxx" 样式的 key。 */
export function tOr(key: string, fallback: string, params?: Record<string, string | number>): string {
  const msg = t(key, params);
  return msg === key && fallback !== undefined ? fallback : msg;
}

export function setLocale(loc: string): void {
  locale = loc;
  localStorage.setItem('locale', loc);
}

export function getLocale(): string { return locale; }
