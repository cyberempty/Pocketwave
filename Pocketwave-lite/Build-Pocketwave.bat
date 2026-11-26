@echo off
setlocal EnableExtensions
chcp 65001 >nul
for %%I in ("%~dp0.") do set "ROOT=%%~fI"
for %%I in ("%~dp0..\components") do set "COMP=%%~fI"
cd /d "%ROOT%"
title Pocketwave - Build System

set "PORT=%ROOT%\Pocketwave-portable"
set "RT=%ROOT%\runtime"

rem Already built: just start the program
if exist "%PORT%\Pocketwave.exe" goto :run

rem ---- Node.js: from ..\components when it is there (offline build), otherwise a portable one is downloaded ----
set "NODE_DIR=%COMP%\node-win32-x64"
if exist "%NODE_DIR%\node.exe" if exist "%COMP%\electron-checksums.json" if exist "%COMP%\npm-cache\_cacache" goto :build

set "NODE_DIR=%RT%\node"
if exist "%NODE_DIR%\node.exe" goto :build
echo.
echo   POCKETWAVE BUILD SYSTEM
echo   Downloading a portable Node.js (the components folder was not found)...
mkdir "%RT%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\download-node.ps1" -InstallDir "%NODE_DIR%" -Work "%RT%"
if errorlevel 1 goto :fail

:build
"%NODE_DIR%\node.exe" "%ROOT%\scripts\build-system.js"
if errorlevel 1 goto :fail
rmdir /s /q "%RT%" >nul 2>&1

:run
start "" "%PORT%\Pocketwave.exe" %*
exit /b 0

:fail
echo.
pause
exit /b 1
