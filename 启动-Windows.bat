@echo off
cd /d "%~dp0"
echo ==========================================
echo   RV32I Single-Cycle Web Simulator
echo   [WINDOWS] one-click launcher
echo   (Linux users: use 启动-Linux.sh instead)
echo   (need: g++ / Python3)
echo ==========================================
echo.
REM ---- Step 1: build C++ core if missing ----
if exist "backend\cpp\build\rv32i_sim.exe" goto :havecore
echo  [1/2] Building C++ core ...
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
REM ---- Step 2: launch the middleware (it also serves the web UI) ----
REM The frontend is prebuilt into frontend\dist and served by the same
REM middleware on port 8081, so no Node.js and no second window is needed.
REM python runs with -B so that no __pycache__ is written into the folder.
if not exist "frontend\dist\index.html" goto :nodist
echo  [2/2] Launching server ...
pushd "backend\python"
echo.
echo  Open in browser:  http://localhost:8081
echo  (press Ctrl+C to stop)
echo.
python -B server.py
popd
exit /b 0

:nodist
echo  frontend\dist not found (frontend not built).
echo    Developer: cd frontend ^&^& npm install ^&^& npm run build
pause
exit /b 1
