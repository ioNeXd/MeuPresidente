@echo off
setlocal enabledelayedexpansion
title Screen Sharing - WebRTC P2P
color 0A

echo ============================================
echo    Screen Sharing - WebRTC P2P
echo ============================================
echo.

:: --- Verificar/instalar Node.js ---
where node >nul 2>nul
if errorlevel 1 (
    echo [!] Node.js nao encontrado.
    echo [*] Instalando Node.js via winget...
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements >nul 2>nul
    if errorlevel 1 (
        echo [X] Falha ao instalar Node.js via winget.
        echo     Baixe manualmente: https://nodejs.org
        pause
        exit /b 1
    )
    echo [OK] Node.js instalado.
    :: Atualizar PATH para a sessao atual
    set "PATH=%LOCALAPPDATA%\Programs\node;%PATH%"
) else (
    echo [OK] Node.js encontrado.
)

:: --- Verificar/instalar cloudflared ---
where cloudflared >nul 2>nul
if errorlevel 1 (
    echo.
    echo [*] cloudflared nao encontrado. Instalando via winget...
    winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements >nul 2>nul
    if errorlevel 1 (
        echo [!] cloudflared nao instalado. Internet publica indisponivel.
        echo     Sera possivel acessar apenas pela rede local.
    ) else (
        echo [OK] cloudflared instalado.
        set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
    )
) else (
    echo [OK] cloudflared encontrado.
)

:: --- Instalar dependencias ---
if not exist node_modules (
    echo.
    echo [*] Instalando dependencias...
    call npm install --omit=dev
    if errorlevel 1 (
        echo [X] Falha ao instalar dependencias.
        pause
        exit /b 1
    )
    echo [OK] Dependencias instaladas.
)

:: --- Detectar IPs da rede ---
echo.
echo ============================================
echo    URLs de acesso
echo ============================================
echo.

:: IP local via ipconfig
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    for /f "tokens=*" %%b in ("%%a") do set "IP=%%b"
)

set "IP=!IP: =!"
echo   Localhost:   http://localhost:3000
if defined IP (
    echo   Rede local:  http://!IP!:3000
)
echo.

:: --- Iniciar cloudflared (se disponivel) ---
set "TUNNEL_URL="
where cloudflared >nul 2>nul
if not errorlevel 1 (
    echo [*] Iniciando tunel HTTPS gratuito...
    start /b cmd /c "cloudflared tunnel --url http://localhost:3000 >%TEMP%\cloudflared.log 2>&1"
    :: Aguardar o link aparecer no log
    set "TRIES=0"
    :wait_tunnel
    timeout /t 1 /nobreak >nul
    set /a TRIES+=1
    for /f "tokens=*" %%l in ('findstr /c:"https://" %TEMP%\cloudflared.log 2^>nul') do (
        set "TUNNEL_URL=%%l"
    )
    if not defined TUNNEL_URL if !TRIES! lss 15 goto wait_tunnel
    if defined TUNNEL_URL (
        for /f "tokens=*" %%u in ("!TUNNEL_URL!") do (
            echo   Internet:    %%u
        )
    ) else (
        echo [!] Tunel demorou para iniciar. Verifique manualmente.
    )
) else (
    echo [!] cloudflared nao disponivel.
    echo     Para acesso pela internet, instale:
    echo     winget install Cloudflare.cloudflared
)

echo.
echo ============================================
echo    Servidor iniciando...
echo ============================================
echo.
echo   Pressione Ctrl+C para encerrar.
echo.

:: --- Iniciar servidor ---
node server.js
pause
