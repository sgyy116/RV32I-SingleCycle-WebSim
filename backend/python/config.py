# ============================================================================
# config.py —— 端口、路径、工具链等全局配置
# ============================================================================

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()   # rv32i-single-cycle
BACKEND_DIR = Path(__file__).parent.parent.resolve()            # backend
CPP_BUILD_DIR = BACKEND_DIR / "cpp" / "build"
COMPILE_OUTPUT_DIR = BACKEND_DIR / "compile_output"

# 端口
WEBSOCKET_PORT = int(os.environ.get("WS_PORT", 8080))
COMPILE_PORT = int(os.environ.get("COMPILE_PORT", 8081))

# 模拟器可执行文件路径（按平台选择；build 里可能残留学长的 Linux 版 rv32i_sim）
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

# 编译输出目录（临时 ELF）
COMPILE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
