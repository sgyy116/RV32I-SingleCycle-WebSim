# ============================================================================
# config.py —— 端口、路径、工具链等全局配置
# ============================================================================

import os
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()   # rv32i-single-cycle
BACKEND_DIR = Path(__file__).parent.parent.resolve()            # backend
CPP_BUILD_DIR = BACKEND_DIR / "cpp" / "build"

# 前端预构建静态文件（交付包内置；由 compile_server 一并托管，见其 build_app）
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

# 编译输出（临时 ELF/bin）放系统临时目录，不落在源码树里——
# 交付包被反复使用也不会因此产生任何新文件。
COMPILE_OUTPUT_DIR = Path(tempfile.gettempdir()) / "rv32i-compile"

# 端口
WEBSOCKET_PORT = int(os.environ.get("WS_PORT", 8080))
COMPILE_PORT = int(os.environ.get("COMPILE_PORT", 8081))
BIND_HOST = os.environ.get("RV32I_BIND_HOST", "0.0.0.0")
SERVER_MODE = os.environ.get("RV32I_SERVER_MODE", "0") == "1"

# 初始保护阈值，不代表经过压测确认的承载能力；两个 WebSocket 入口共用。
MAX_SESSIONS = max(1, int(os.environ.get("RV32I_MAX_SESSIONS", "20")))
MAX_WAITING = max(0, int(os.environ.get("RV32I_MAX_WAITING", "100")))
SESSION_IDLE_SECONDS = max(1, int(os.environ.get("RV32I_SESSION_IDLE_SECONDS", "1800")))

# 模拟器可执行文件路径（按平台选择；build 里可能残留旧版的 Linux 可执行文件）
SIM_PATH = os.environ.get("RV32I_SIM_PATH")
if SIM_PATH is None:
    exe_name = "rv32i_sim.exe" if os.name == "nt" else "rv32i_sim"
    SIM_PATH = str(CPP_BUILD_DIR / exe_name)

# RISC-V 交叉工具链（可选；缺失时回退到 Python 微型汇编器）
RISCV_GCC = os.environ.get("RISCV_GCC", "riscv-none-elf-gcc")
RISCV_AS = os.environ.get("RISCV_AS", "riscv-none-elf-as")
RISCV_LD = os.environ.get("RISCV_LD", "riscv-none-elf-ld")

# 汇编/编译架构
ARCH = "rv32i"
ABI = "ilp32"

# 注：输出目录刻意不在这里创建。写在本模块顶层会让「import config」本身
# 就产生文件系统副作用；改由 compile_source 在真正要写文件时按需 mkdir。
