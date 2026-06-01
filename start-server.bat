@echo off
title Chill Rental - Local Server
cd /d "%~dp0"

echo ================================================
echo   CHILL RENTAL - Local Development Server
echo ================================================
echo.
echo Folder: %CD%
echo.

REM Cek Python
where python >nul 2>nul
if not errorlevel 1 goto :run_python

REM Cek py launcher (Python di Windows umumnya)
where py >nul 2>nul
if not errorlevel 1 goto :run_py

REM Cek Node
where node >nul 2>nul
if not errorlevel 1 goto :run_node

echo ERROR: Python, py, atau Node tidak ditemukan di PATH.
echo.
echo Cek manual:
echo   - Python: ketik "python --version" di cmd
echo   - Node:   ketik "node --version" di cmd
echo.
pause
exit /b 1

:run_python
echo Found: Python
python --version
echo.
echo Starting HTTP server di http://localhost:3000
echo Buka browser ke: http://localhost:3000/smoke-test.html
echo.
echo Tekan CTRL+C untuk stop
echo ================================================
python -m http.server 3000
pause
exit /b

:run_py
echo Found: py launcher
py --version
echo.
echo Starting HTTP server di http://localhost:3000
echo Buka browser ke: http://localhost:3000/smoke-test.html
echo.
echo Tekan CTRL+C untuk stop
echo ================================================
py -m http.server 3000
pause
exit /b

:run_node
echo Found: Node.js
node --version
echo.
echo Starting http-server via npx di http://localhost:3000
echo Buka browser ke: http://localhost:3000/smoke-test.html
echo.
echo Tekan CTRL+C untuk stop
echo ================================================
call npx --yes http-server -p 3000 -c-1
pause
exit /b
