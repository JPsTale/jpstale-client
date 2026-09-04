import { defineConfig, Plugin, loadEnv } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, sep, relative } from 'node:path';

const loadBackend = (mode: string) => {
  const e = loadEnv(mode, process.cwd(), '');
  const apiBase: string = e.VITE_API_BASE || 'http://192.168.31.10:8080/pt';
  if (apiBase.startsWith('/')) return 'http://192.168.31.10:8080';
  return apiBase.replace(/\/pt\/?$/, '');
};

// /res/** 资产服务：dev 阶段把本地游戏资产根映射为 URL 路径，按需流式读取。
// 不做公共目录拷贝，故 dev 不扫描、build 不跟进（build 后 /res 由部署服务器提供）。
// 资产根从 .env 的 VITE_ASSET_ROOT 读取。
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
          'char-demo': resolve(import.meta.dirname, 'char-demo.html'),
          'map-demo': resolve(import.meta.dirname, 'map-demo.html'),
        },
      },
    },
  };
});
