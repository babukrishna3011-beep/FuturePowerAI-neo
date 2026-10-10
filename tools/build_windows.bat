@echo off
setlocal
cd /d "%~dp0.."
call npm install
if errorlevel 1 exit /b 1
call npm run check
if errorlevel 1 exit /b 1
call npm run build:local-ai
if errorlevel 1 exit /b 1
call npm run dist:portable
if errorlevel 1 exit /b 1
echo.
echo Build finished. Check the dist folder.
pause
