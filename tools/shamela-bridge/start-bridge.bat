@echo off
title Al-Ulama Local Shamela Bridge Server
echo ========================================================
echo   Al-Ulama Easy Editor - Local Shamela 4 Bridge Launcher
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not found on this computer.
    echo.
    echo The bridge needs Node.js to run. Download and install it from:
    echo     https://nodejs.org/
    echo Then run this file again.
    echo.
    pause
    exit /b 1
)

echo Starting local HTTP bridge on http://127.0.0.1:8000 ...
echo Please keep this window open while using local search in Al-Ulama Editor.
echo.

node "%~dp0server.mjs"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Bridge server encountered an issue. See the message above.
    pause
)
