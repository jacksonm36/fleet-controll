@echo off

"C:\Windows\System32\wsl.exe" bash -lc "sed -i 's/\r$//' /mnt/d/manager/scripts/bootstrap-wsl.sh 2>/dev/null; chmod +x /mnt/d/manager/scripts/bootstrap-wsl.sh; bash /mnt/d/manager/scripts/bootstrap-wsl.sh > /mnt/d/manager/wsl-bootstrap.log 2>&1"

exit /b %ERRORLEVEL%

