@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js не найден. Установите с https://nodejs.org & pause & exit /b 1)
if not exist node_modules\sharp (
  echo Первый запуск: скачиваю конвертер картинок...
  call npm install --no-fund --no-audit || (pause & exit /b 1)
)
node tools/build-images.mjs %*
pause
