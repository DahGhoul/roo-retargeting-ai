@echo off
setlocal EnableExtensions
title Roo Retargeting AI - roo Soluciones Digitales (Puerto 4000)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js no esta instalado en esta PC.
    echo Descargalo desde https://nodejs.org/ e intenta de nuevo.
    pause
    exit /b 1
)

if not exist "node_modules\express" (
    echo [INFO] Instalando dependencias de Roo Retargeting AI...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [ERROR] Fallo la instalacion de dependencias npm.
        pause
        exit /b 1
    )
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>nul
)

echo ============================================================================
echo   ROO RETARGETING AI - roo Soluciones Digitales (Tecnologia con Proposito)
echo   Control Tower : http://localhost:4000
echo   Tienda Demo   : http://localhost:4000/demo-shop.html
echo   SDK Universal : http://localhost:4000/sdk/roo-agent.js
echo   Modo Local    : 100%% Autonomo (Zero-DDL JSON Atomico)
echo ============================================================================

start "" /B cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:4000"
node server.js
pause
