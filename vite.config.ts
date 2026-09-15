import { defineConfig, Plugin, loadEnv } from 'vite';
import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, sep, relative, dirname } from 'node:path';

const loadBackend = (mode: string) => {
  const e = loadEnv(mode, process.cwd(), '');
  const apiBase: string = e.VITE_API_BASE || 'http://192.168.31.10:8080/pt';
  if (apiBase.startsWith('/')) return 'http://192.168.31.10:8080';
  return apiBase.replace(/\/pt\/?$/, '');
};

// /res/** 资产服务：dev 阶段把本地游戏资产根映射为 URL 路径，按需流式读取。
// 不做公共目录拷贝，故 dev 不扫描、build 不跟进（build 后 /res 由部署服务器提供）。
// 资产根从 .env 的 VITE_ASSET_ROOT 读取。
//
// 同一个插件顺带挂 **烘焙落盘端点** `/__bake`（`npm run bake-maps` 的作业页用）：
// 平面图是离线生成的大文件，落资产根（与原版的 field/map、image/guidemap 同类），不进 git；
// 浏览器侧没有本地文件权限，所以由 dev server 代写。仅在 dev（configureServer）存在。
function devAssets(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '');
  const assetRoot = resolve(env.VITE_ASSET_ROOT);
  const MIME: Record<string, string> = {
    '.smd': 'application/octet-stream',
    '.smb': 'application/octet-stream',
    '.inx': 'application/octet-stream',
    '.bmp': 'image/bmp',
    '.tga': 'application/octet-stream',
    '.dds': 'application/octet-stream',
    '.db': 'application/octet-stream',
    '.hdr': 'application/octet-stream',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.wav': 'audio/wav',
    '.txt': 'text/plain',
    '.json': 'application/json',
  };
  return {
    name: 'jpstale-dev-assets',
    configureServer(server) {
      if (!existsSync(assetRoot)) {
        server.config.logger.warn(`[devAssets] VITE_ASSET_ROOT not found: ${assetRoot}`);
        return;
      }
      // ── 烘焙落盘端点（dev-only）──
      // POST /__bake?path=<相对资产根的路径>[&append=1]   body = 二进制
      // 只允许写 .png / .webp / .json / .log，且路径必须落在资产根内（与 /res 同一套 relative 校验）。
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || '').split('?')[0];
        if (pathname !== '/__bake') return next();
        if (req.method !== 'POST') {
          res.writeHead(405).end('POST only');
          return;
        }
        const url = new URL(req.url || '', 'http://localhost');
        const relPath = url.searchParams.get('path') || '';
        const append = url.searchParams.get('append') === '1';
        if (!/\.(png|webp|json|log)$/i.test(relPath)) {
          res.writeHead(400).end('only .png / .webp / .json / .log');
          return;
        }
        const abs = resolve(assetRoot, relPath);
        if (relative(assetRoot, abs).startsWith('..')) {
          res.writeHead(403).end('outside asset root');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            mkdirSync(dirname(abs), { recursive: true });
            const buf = Buffer.concat(chunks);
            if (append) appendFileSync(abs, buf);
            else writeFileSync(abs, buf);
            server.config.logger.info(`[bake] ${append ? 'append' : 'write'} ${relPath} (${buf.length} B)`);
            res.writeHead(200).end('ok');
          } catch (err) {
            server.config.logger.error(`[bake] 写入失败 ${relPath}: ${String(err)}`);
            res.writeHead(500).end(String(err));
          }
        });
      });
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const pathname = (req.url || '').split('?')[0];
        if (!pathname.startsWith('/res')) return next();
        // /res/<rel> -> <assetRoot>/<rel>，用 relative 校验不逃出根
        const rel = pathname.replace(/^\/res\/?/, '');
        const relPath = rel.split('/').map(decodeURIComponent).join('/');
        if (relative(assetRoot, resolve(assetRoot, relPath)).startsWith('..')) return next();
        const file = resolve(assetRoot, relPath);
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        const cache = 'public, max-age=604800, immutable';
        const size = statSync(file).size;
        // 支持 HTTP Range（大 wav/纹理：<audio> 流式播放与拖动需要）
        const range = req.headers.range;
        if (range) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
          if (m) {
            const reqStart = m[1] === '' ? -1 : Number(m[1]);
            const reqEnd = m[2] === '' ? -1 : Number(m[2]);
            let start = reqStart < 0 ? Math.max(0, size - reqEnd) : reqStart;
            let end = reqEnd < 0 ? size - 1 : reqEnd;
            if (Number.isInteger(start) && Number.isInteger(end) && start <= end && start < size) {
              end = Math.min(end, size - 1);
              res.writeHead(206, {
                'Content-Type': mime,
                'Content-Range': `bytes ${start}-${end}/${size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': end - start + 1,
                'Cache-Control': cache,
              });
              if (req.method !== 'HEAD') createReadStream(file, { start, end }).pipe(res);
              else res.end();
              return;
            }
            res.writeHead(416, { 'Content-Range': `bytes */${size}` });
            return res.end();
          }
        }
        res.writeHead(200, {
          'Content-Type': mime,
          'Accept-Ranges': 'bytes',
          'Cache-Control': cache,
          // ⚠ **必须给 Content-Length**：只 `pipe` 的话 Node 会走 chunked，浏览器/客户端就不知道
          // 文件多大 —— 后果是加载页拿不到"总量"（只能显示已下载量），用户 2026-09-14 实测报的就是
          // "没有显示要下载的总量"。大小本来就算好了（上面 Range 分支就在用 `size`）。
          'Content-Length': size,
        });
        if (req.method === 'HEAD') return res.end();
        createReadStream(file).pipe(res);
      });
      server.config.logger.info(`[devAssets] serving /res -> ${assetRoot}`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const origin = loadBackend(mode);
  return {
    base: '/',
    plugins: [devAssets(mode)],
    server: {
      host: true,
      port: 5173,
      // 烘焙作业页由脚本写进项目根（vite 才服务得到），跑完即删。
      // **必须排除出文件监听**：否则写它就会触发 HMR full-reload，页面重载 → 同一次烘焙跑两遍
      // （实测日志里出现两遍结束行、63 张图写出 80 行记录）。
      watch: { ignored: ['**/.bake-job.html'] },
      proxy: {
        // dev 期相对 /pt/* 请求转发到 pt-web-server（context-path /pt）
        '/pt': {
          target: origin,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, 'index.html'),
          'map-demo': resolve(import.meta.dirname, 'map-demo.html'),
          'asset-inspector': resolve(import.meta.dirname, 'asset-inspector.html'),
          planemap: resolve(import.meta.dirname, 'planemap.html'),
          worldmap: resolve(import.meta.dirname, 'worldmap.html'),
        },
      },
    },
  };
});
