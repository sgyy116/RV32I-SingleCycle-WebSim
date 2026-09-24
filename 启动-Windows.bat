@echo off
cd /d "%~dp0"
echo ==========================================
echo   RV32I Single-Cycle Web Simulator
echo   [WINDOWS] one-click launcher
echo   (Linux users: use 启动-Linux.sh instead)
echo   (need: g++ / Python3 / Node.js)
echo ==========================================
echo.
REM ---- Step 1: build C++ core if missing ----
if exist "backend\cpp\build\rv32i_sim.exe" goto :havecore
echo  [1/3] Building C++ core ...
mkdir "backend\cpp\build" 2>nul
pushd "backend\cpp"
g++ -std=c++17 -O2 -I src src/main.cpp src/rv_core.cpp src/rv_disasm.cpp -o build\rv32i_sim.exe
popd
if exist "backend\cpp\build\rv32i_sim.exe" goto :havecore
echo  BUILD FAILED. Please install g++ and retry.
pause
exit /b 1
:havecore
echo         done.
REM ---- Step 2: npm install if missing ----
if exist "frontend\node_modules\vite" goto :havenpm
echo  [2/3] Installing frontend deps (first time may be slow)...
pushd "frontend"
call npm install
popd
if exist "frontend\node_modules\vite" goto :havenpm
echo  NPM INSTALL FAILED. Please install Node.js and retry.
pause
exit /b 1
:havenpm
echo         done.
REM ---- Step 3: launch servers in two windows ----
echo  [3/3] Launching servers...
pushd "backend\python"
start "RV32I-backend" cmd /k "python server.py"
popd
pushd "frontend"
start "RV32I-frontend" cmd /k "npm run dev"
popd
echo.
echo  Two windows opened. Open in browser:  http://localhost:5173
echo.
pause
