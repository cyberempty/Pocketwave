@echo off
setlocal EnableExtensions
chcp 65001 >nul
for %%I in ("%~dp0.") do set "ROOT=%%~fI"
cd /d "%ROOT%"
title Pocketwave

set "PORT=%ROOT%\Pocketwave-portable"
set "RT=%ROOT%\runtime"
set "NODE_DIR=%RT%\node"

rem Already built: just start the program
if exist "%PORT%\Pocketwave.exe" goto :run

cls
echo.
echo   POCKETWAVE
echo   --------------------------------------------------------
echo   First start: building the program. This happens only once,
echo   needs an Internet connection and takes a few minutes.
echo   Nothing is installed on your computer: everything stays
echo   in this folder and the temporary files are removed at the end.
echo.

rem Everything the build needs stays inside this folder
set "npm_config_cache=%RT%\npm-cache"
set "electron_config_cache=%RT%\electron-cache"
set "PATH=%NODE_DIR%;%PATH%"
set "ELECTRON_SKIP_BINARY_DOWNLOAD=1"
set "npm_config_update_notifier=false"
set "npm_config_fund=false"
set "npm_config_audit=false"

echo   [  0%%] Downloading Node.js (portable)
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\download-node.ps1" -InstallDir "%NODE_DIR%" -Work "%RT%"
if errorlevel 1 goto :fail

echo.
echo   [ 30%%] Installing the project dependencies
call "%NODE_DIR%\npm.cmd" ci --no-progress
if errorlevel 1 goto :fail

echo.
echo   [ 55%%] Building Pocketwave (downloads the Electron runtime, about 110 MB)
call "%NODE_DIR%\node.exe" "%ROOT%\scripts\build.js"
if errorlevel 1 goto :fail

echo.
echo   [ 90%%] Creating Pocketwave-portable
if exist "%PORT%" rmdir /s /q "%PORT%"
move /y "%ROOT%\dist\Pocketwave-win32-x64" "%PORT%" >nul
if errorlevel 1 goto :fail

echo   [ 97%%] Cleaning up
rmdir /s /q "%RT%" >nul 2>&1
rmdir /s /q "%ROOT%\node_modules" >nul 2>&1
rmdir /s /q "%ROOT%\dist" >nul 2>&1

echo   [100%%] Done. Starting Pocketwave...
echo.

:run
start "" "%PORT%\Pocketwave.exe" %*
exit /b 0

:fail
echo.
echo   --------------------------------------------------------
echo   The build could not be completed. Please copy the message
echo   above and report it.
echo   --------------------------------------------------------
pause
exit /b 1
