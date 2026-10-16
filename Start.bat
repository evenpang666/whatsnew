@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap-node.ps1"
if errorlevel 1 (
  echo 环境补装或启动失败，请查看上方提示后重试。
  pause
  exit /b 1
)
