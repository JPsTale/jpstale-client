@echo off
setlocal
cd /d "%~dp0"

REM 首次运行或 node_modules 缺失时安装依赖
if not exist node_modules (
    echo [run] installing dependencies...
    call npm install
    if errorlevel 1 ( echo [run] npm install failed & exit /b 1 )
)

echo [run] starting vite dev server (http://localhost:5173)...
call npm run dev
