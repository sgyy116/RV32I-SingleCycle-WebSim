#!/usr/bin/env bash
# ============================================================
#  启动-Linux.sh  ——  本脚本用于【 Linux 】系统一键启动
#  （Windows 请用同目录的 启动-Windows.bat）
#  需要: g++ / python3（前端已是预构建静态文件，不需要 node）
# ============================================================
cd "$(dirname "$0")"

echo "=========================================="
echo "  RV32I Single-Cycle Web Simulator"
echo "  [Linux] one-click launcher"
echo "  (need: g++ / python3)"
echo "=========================================="
echo

# ---- Step 1: build C++ core if missing ----
if [ ! -f "backend/cpp/build/rv32i_sim" ]; then
  echo "[1/2] Building C++ core ..."
  mkdir -p "backend/cpp/build"
  ( cd "backend/cpp" && g++ -std=c++17 -O2 -I src src/main.cpp src/rv_core.cpp src/rv_disasm.cpp -o build/rv32i_sim )
  if [ ! -f "backend/cpp/build/rv32i_sim" ]; then
    echo "BUILD FAILED. Please install g++ and retry."
    exit 1
  fi
else
  echo "[1/2] C++ core already built."
fi

# ---- Step 2: launch the middleware (it also serves the web UI) ----
# 前端是预构建好的静态文件，由中间层在 8081 端口一并托管，所以这里
# 不需要 Node.js，也不需要再起一个前端服务进程。python 用 -B 启动，
# 避免在包里写 __pycache__。
if [ ! -f "frontend/dist/index.html" ]; then
  echo "frontend/dist 不存在（前端未构建）。"
  echo "  开发者请先执行: cd frontend && npm install && npm run build"
  exit 1
fi

echo "[2/2] Launching server ..."
( cd "backend/python" && exec python3 -B server.py ) &
MID_PID=$!

echo
echo "  middleware PID = $MID_PID"
echo "  Open browser:  http://localhost:8081"
echo "  (press Ctrl+C to stop)"
echo
trap 'echo ""; echo "正在停止..."; kill $MID_PID 2>/dev/null || true' INT TERM
wait
