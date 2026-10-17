@echo off
rem Lanzador del modo demo de Deli-Gastro (http://localhost:5178)
setlocal
title Deli-Gastro - Modo demo
set "PORT=5178"
set "ROOT=%~dp0.."
cd /d "%ROOT%" || (echo No se pudo entrar a la carpeta del proyecto. & pause & exit /b 1)

where node >nul 2>&1 || (echo Node.js no esta instalado o no esta en el PATH. & pause & exit /b 1)

if not exist "node_modules" (
  echo Instalando dependencias, esto solo pasa la primera vez...
  call npm install || (echo Fallo npm install. & pause & exit /b 1)
)

rem Si el servidor ya esta corriendo, solo abre el navegador
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if %errorlevel%==0 (
  start "" "http://localhost:%PORT%/login"
  exit /b 0
)

rem Abre el navegador cuando el servidor responde (maximo ~5 min: la primera compilacion tarda)
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 300;$i++){try{Invoke-WebRequest -UseBasicParsing http://localhost:%PORT% -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:%PORT%/login'; break}catch{Start-Sleep 1}}"

call npm run demo:rapido
echo.
echo El servidor se detuvo.
pause
