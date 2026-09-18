/**
 * 把规格说明书渲染成可阅读的 HTML 预览（`npm run docs`）—— 生成物落在仓库外，不进版本库。
 * 为什么需要：Markdown 直接打开会被浏览器当下载；而它是"实现对照标准"，要经常翻。
 * 源：docs/PT粒子系统-规格说明书.md（工作区根）→ 输出：<工作区>/tmp/spec.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
const root = path.resolve(process.cwd(), '..');            // E:/JPsTale
const src = path.join(root, 'docs', 'PT粒子系统-规格说明书.md');
const outDir = path.join(root, 'tmp');
const out = path.join(outDir, 'spec.html');
if (!fs.existsSync(src)) { console.error('找不到 ' + src); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
const body = marked.parse(fs.readFileSync(src, 'utf8'), { gfm: true });
const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>PT 粒子系统 规格说明书</title>
<style>
:root{color-scheme:light dark}
body{max-width:1080px;margin:0 auto;padding:24px 32px;font:15px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
h1{border-bottom:2px solid #888;padding-bottom:.3em;margin-top:1.6em}
h2{border-bottom:1px solid #bbb;padding-bottom:.25em;margin-top:1.4em}
code{background:rgba(127,127,127,.18);padding:.12em .35em;border-radius:3px;font-family:ui-monospace,Consolas,monospace;font-size:.92em}
pre{background:rgba(127,127,127,.12);padding:12px 14px;border-radius:6px;overflow:auto;border:1px solid rgba(127,127,127,.25)}
pre code{background:none;padding:0;font-size:12.5px;line-height:1.45}
table{border-collapse:collapse;margin:1em 0;font-size:14px;display:block;overflow:auto}
th,td{border:1px solid rgba(127,127,127,.4);padding:5px 9px;text-align:left;vertical-align:top}
th{background:rgba(127,127,127,.15)}
blockquote{border-left:4px solid #888;margin:1em 0;padding:.2em 1em;color:#666}
</style></head><body>
${body}</body></html>`;
fs.writeFileSync(out, html, 'utf8');
console.log(`写出 ${out}（${(html.length / 1024).toFixed(0)}KB）`);
console.log('预览地址（dev server 在跑时）：http://localhost:5175/@fs/' + out.replaceAll(String.fromCharCode(92), '/'));
