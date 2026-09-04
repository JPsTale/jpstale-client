import { defineConfig, Plugin, loadEnv } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, sep, relative } from 'node:path';

const loadBackend = (mode: string) => {
  const e = loadEnv(mode, process.cwd(), '');
  // 从 VITE_API_BASE 剥离 context-path 得 web-server origin，例如
  // http://192.168.31.10:8080/pt -> http://192.168.31.10:8080
  const apiBase: string = e.VITE_API_BASE || 'http://192.168.31.10:8080/pt';
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
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
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
