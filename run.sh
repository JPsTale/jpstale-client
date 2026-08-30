#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"

# 首次运行或 node_modules 缺失时安装依赖
if [ ! -d node_modules ]; then
  echo "[run] installing dependencies..."
  npm install
fi

echo "[run] starting vite dev server (http://localhost:5173)..."
npm run dev
