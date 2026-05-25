@echo off
setlocal
REM Start Fleet API + web in WSL (Debian). Use from Windows Explorer or: scripts\run-dev-wsl.cmd

set ROOT=%~dp0..
set LOG=%ROOT%\wsl-dev.log

echo === %date% %time% fleet dev === > "%LOG%"

C:\Windows\System32\wsl.exe -d Debian bash -lc "sed -i 's/\r$//' /mnt/d/manager/scripts/free-ports-wsl.sh /mnt/d/manager/scripts/dev-wsl.sh 2>/dev/null; bash /mnt/d/manager/scripts/free-ports-wsl.sh" >> "%LOG%" 2>&1

C:\Windows\System32\wsl.exe -d Debian bash -c "cd /mnt/d/manager && nohup bash scripts/dev-wsl.sh >> /tmp/fleet-dev.log 2>&1 &"

echo Waiting for API and web...
set /a N=0
:wait
set /a N+=1
if %N% GTR 30 goto fail
C:\Windows\System32\wsl.exe -d Debian bash -c "curl -sf http://127.0.0.1:4000/health >/dev/null && curl -sf -o /dev/null http://127.0.0.1:3000/ >/dev/null" 2>nul
if not errorlevel 1 goto ok
timeout /t 2 /nobreak >nul
goto wait

:ok
echo.
echo Fleet dev is running.
echo   Web:  http://127.0.0.1:3000
echo   API:  http://127.0.0.1:4000
echo   Log:  WSL /tmp/fleet-dev.log  (also %LOG%)
exit /b 0

:fail
echo Dev failed to start. See %LOG% and WSL: tail -50 /tmp/fleet-dev.log
C:\Windows\System32\wsl.exe -d Debian bash -c "tail -50 /tmp/fleet-dev.log 2>/dev/null" >> "%LOG%" 2>&1
type "%LOG%"
exit /b 1
