#!/usr/bin/env bash
# ============================================================
#  启动-Linux.sh  ——  本脚本用于【 Linux 】系统一键启动
#  （Windows 请用同目录的 启动-Windows.bat）
#  需要: g++ / python3 / node
# ============================================================
cd "$(dirname "$0")"

echo "=========================================="
echo "  RV32I Single-Cycle Web Simulator"
echo "  [Linux] one-click launcher"
echo "  (need: g++ / python3 / node)"
echo "=========================================="
echo

# ---- Step 1: build C++ core if missing ----
if [ ! -f "backend/cpp/build/rv32i_sim" ]; then
  echo "[1/3] Building C++ core ..."
  mkdir -p "backend/cpp/build"
  ( cd "backend/cpp" && g++ -std=c++17 -O2 -I src src/main.cpp src/rv_core.cpp src/rv_disasm.cpp -o build/rv32i_sim )
  if [ ! -f "backend/cpp/build/rv32i_sim" ]; then
    echo "BUILD FAILED. Please install g++ and retry."
    exit 1
  fi
else
  echo "[1/3] C++ core already built."
fi

# ---- Step 2: npm install if missing ----
if [ ! -d "frontend/node_modules/vite" ]; then
  echo "[2/3] Installing frontend deps (first time may be slow)..."
  ( cd "frontend" && npm install )
  if [ ! -d "frontend/node_modules/vite" ]; then
    echo "NPM INSTALL FAILED. Please install Node.js and retry."
    exit 1
  fi
else
  echo "[2/3] Frontend deps already installed."
fi

# ---- Step 3: launch servers in background ----
echo "[3/3] Launching servers..."
( cd "backend/python" && python3 server.py ) &
MID_PID=$!
( cd "frontend" && npm run dev ) &
FE_PID=$!

echo
echo "  middleware PID = $MID_PID"
echo "  frontend  PID = $FE_PID"
echo "  Open browser:  http://localhost:5173"
echo "  (press Ctrl+C to stop both)"
echo
wait
