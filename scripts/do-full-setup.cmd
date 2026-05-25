@echo off

setlocal

set LOG=%~dp0..\wsl-setup.log

echo === %date% %time% fleet setup === > "%LOG%"



where node >nul 2>nul

if errorlevel 1 (

  echo ERROR: node not on PATH for Windows. Install Node or use full path. >> "%LOG%"

  type "%LOG%"

  exit /b 1

)



echo === gen .env (Windows) === >> "%LOG%"

pushd "%~dp0.."

node scripts\gen-env.mjs >> "%LOG%" 2>&1

if errorlevel 1 popd & exit /b 1

popd



echo === CRLF fix for shell scripts === >> "%LOG%"
C:\Windows\System32\wsl.exe bash -lc "sed -i 's/\r$//' /mnt/d/manager/scripts/wsl-install-prereqs.sh /mnt/d/manager/scripts/bootstrap-wsl.sh || true" >> "%LOG%" 2>&1

echo === WSL root: postgres + curl === >> "%LOG%"

C:\Windows\System32\wsl.exe -u root bash /mnt/d/manager/scripts/wsl-install-prereqs.sh >> "%LOG%" 2>&1

if errorlevel 1 (

  echo ROOT_PREREQ_FAILED >> "%LOG%"

  type "%LOG%"

  exit /b 1

)



echo === WSL user: bootstrap === >> "%LOG%"

C:\Windows\System32\wsl.exe bash -lc "export SKIP_BOOTSTRAP_ENV=1; bash /mnt/d/manager/scripts/bootstrap-wsl.sh" >> "%LOG%" 2>&1

if errorlevel 1 (

  echo BOOTSTRAP_FAILED >> "%LOG%"

  type "%LOG%"

  exit /b 1

)



echo ALL_OK >> "%LOG%"

type "%LOG%"

exit /b 0

