@echo off
setlocal enabledelayedexpansion
title Noteversity - Parul University Academic Platform

echo ==========================================
echo        NOTEVERSITY - PARUL UNIVERSITY PORTAL
echo ==========================================
echo.

REM 1. Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found on your system!
    echo Please install Node.js from https://nodejs.org/ and try again.
    echo.
    pause
    exit /b 1
)

REM 2. Navigate to backend directory
cd /d "%~dp0noteversity-backend"

REM 3. Ensure .env exists
if not exist ".env" (
    if exist ".env.example" (
        echo [INFO] Creating .env from .env.example
        copy /y ".env.example" ".env" >nul
    )
)

REM 4. Ensure uploads folder exists
if not exist "uploads\" (
    mkdir "uploads" >nul 2>nul
)

REM 5. Check if node_modules or key packages are missing
set "NEEDS_INSTALL=0"
if not exist "node_modules\" set "NEEDS_INSTALL=1"
if not exist "node_modules\@google\generative-ai\" set "NEEDS_INSTALL=1"
if not exist "node_modules\pdf-parse\" set "NEEDS_INSTALL=1"
if not exist "node_modules\express\" set "NEEDS_INSTALL=1"
if not exist "node_modules\mongoose\" set "NEEDS_INSTALL=1"

if "!NEEDS_INSTALL!"=="1" (
    echo [INFO] Required dependencies not found or incomplete.
    echo Installing needed packages, please wait...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Failed to install npm dependencies.
        echo Please verify your internet connection and try running npm install manually.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [INFO] Dependencies installed successfully!
    echo.
) else (
    echo [OK] All dependencies are verified and ready.
)

REM 6. Automatically free port 5000 if occupied by an old process
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do (
    echo [INFO] Port 5000 is occupied by PID %%p. Freeing port...
    taskkill /f /pid %%p >nul 2>nul
)

REM 7. Open browser after brief delay
echo.
echo Opening http://localhost:5000 in your browser...
start "" cmd /c "ping 127.0.0.1 -n 3 >nul && start http://localhost:5000"

REM 8. Start the server directly in this window
echo Starting Noteversity Server...
echo ==========================================
echo Keep this window open while using Noteversity.
echo Press Ctrl + C to stop the server anytime.
echo ==========================================
echo.
call npm start

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server stopped with error code %errorlevel%.
    pause
)
