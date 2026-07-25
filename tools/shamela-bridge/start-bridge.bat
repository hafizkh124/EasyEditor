@echo off
title Al-Ulama Local Shamela Bridge Server
echo ========================================================
echo   Al-Ulama Easy Editor - Local Shamela 4 Bridge Launcher
echo ========================================================
echo.
echo Starting local HTTP bridge on http://127.0.0.1:8000 ...
echo Please keep this window open while using local search in Al-Ulama Editor.
echo.

node "%~dp0server.mjs"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Bridge server encountered an issue or Node.js is missing.
    echo Please make sure Node.js (v20+) is installed on your computer.
    pause
)
