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

rem The book reader uses node:sqlite (DatabaseSync), unflagged from Node 22.13.
node -e "const [maj,min]=process.versions.node.split('.').map(Number);process.exit(maj>22||(maj===22&&min>=13)?0:1)"
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is too old for this bridge ^(need 22.13 or newer^).
    echo.
    echo Your version:
    node -v
    echo.
    echo Please install a newer Node.js from:
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
