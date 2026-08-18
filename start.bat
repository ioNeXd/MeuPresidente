@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo  Screen Sharing - Servidor local
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado.
  echo Instale o Node.js LTS em https://nodejs.org e rode este script de novo.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias na primeira vez, pode demorar um pouco...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao instalar dependencias. Verifique a conexao e tente de novo.
    pause
    exit /b 1
  )
)

echo.
echo  Abra no SEU computador, para compartilhar a tela:
echo    http://localhost:3000
echo.
echo  Amigos na MESMA rede Wi-Fi abrem um destes:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
  set "ip=%%a"
  set "ip=!ip: =!"
  if not "!ip!"=="" echo    http://!ip!:3000
)
echo.
echo  Para compartilhar pela INTERNET em qualquer rede, use um tunel HTTPS:
echo    cloudflared tunnel --url http://localhost:3000
echo.
echo  IMPORTANTE: use sempre http://localhost:3000 para compartilhar a tela,
echo  pois o navegador bloqueia a captura fora de localhost/HTTPS.
echo.
echo  Pressione Ctrl+C para parar o servidor.
echo ============================================
echo.

node server.js
if errorlevel 1 (
  echo.
  echo [ERRO] O servidor encerrou com erro. Veja a mensagem acima.
  pause
)
