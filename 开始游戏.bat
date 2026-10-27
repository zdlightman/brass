@echo off
cd /d "%~dp0"
title Brass Pittsburgh
set "NODEDIR=%~dp0runtime\node"

if exist "%NODEDIR%\node.exe" (
  set "PATH=%NODEDIR%;%PATH%"
  goto havenode
)
where node >nul 2>&1
if errorlevel 1 (
  echo ??? Node.js????????????
  pause
  goto :eof
)

:havenode
if not exist "%~dp0node_modules\vite\package.json" (
  echo ????????????????????
  pause
  goto :eof
)

call :portup
if not errorlevel 1 goto openbrowser

echo ????????...
start "Brass Pittsburgh" /D "%~dp0" cmd /k "set ""PATH=%NODEDIR%;%PATH%"" && ""%NODEDIR%\node.exe"" ""%~dp0node_modules\vite\bin\vite.js"" --host 127.0.0.1 --port 5173"

set n=0
:waitloop
call :portup
if not errorlevel 1 goto openbrowser
set /a n+=1
if %n% geq 60 (
  echo ????? 60 ?????????? Brass Pittsburgh ????
  pause
  goto :eof
)
ping -n 2 127.0.0.1 >nul
goto waitloop

:openbrowser
start "" "http://127.0.0.1:5173/"
echo ????????? http://127.0.0.1:5173/
echo ??????????? Brass Pittsburgh ??????
ping -n 6 127.0.0.1 >nul
goto :eof

:portup
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 5173); $c.Close(); exit 0 } catch { exit 1 }"
if errorlevel 1 exit /b 1
exit /b 0
