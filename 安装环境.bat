@echo off
cd /d "%~dp0"
title 安装环境
set "NODEDIR=%~dp0runtime\node"
set "NODEZIP=%~dp0runtime\node.zip"
set "NODEVER=v24.22.1"

if exist "%NODEDIR%\node.exe" goto deps

echo 正在下载 Node.js %NODEVER% ...
if not exist "%~dp0runtime" mkdir "%~dp0runtime"
curl.exe -fL --retry 3 --retry-delay 2 -o "%NODEZIP%" "https://nodejs.org/dist/%NODEVER%/node-%NODEVER%-win-x64.zip"
if errorlevel 1 (
  echo 下载 Node.js 失败。请检查网络后重新双击「安装环境」。
  pause
  goto :eof
)

echo 正在解压 Node.js ...
tar -xf "%NODEZIP%" -C "%~dp0runtime"
if errorlevel 1 (
  echo 解压 Node.js 失败。
  pause
  goto :eof
)
if exist "%NODEDIR%" rmdir /s /q "%NODEDIR%"
ren "%~dp0runtime\node-%NODEVER%-win-x64" node
del /f /q "%NODEZIP%"
if not exist "%NODEDIR%\node.exe" (
  echo 没有找到 node.exe，安装未完成。
  pause
  goto :eof
)

:deps
set "PATH=%NODEDIR%;%PATH%"
echo 正在安装游戏依赖...
call npm install
if errorlevel 1 (
  echo 依赖安装失败。
  pause
  goto :eof
)

echo.
echo 环境已准备好。接下来双击「开始游戏」。
pause
goto :eof
