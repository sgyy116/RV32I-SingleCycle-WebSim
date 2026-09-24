# ============================================================================
# compile_server.py —— HTTP 编译服务（端口 8081，基于 aiohttp）
#
# 端点:
#   POST /api/compile  输入 {source: 汇编源码文本}
#   优先使用 RISC-V 交叉编译器；缺失时回退到 Python 微型汇编器（asm.py）
#   输出: {"success": true, "elf_path": "...", "disassembly": [...], "errors": []}
#
# 与 WebSocket 服务器（server.py）共用同一事件循环；compile_source 为同步
# 函数（内含 subprocess），在 handler 内通过 asyncio.to_thread 放入线程池。
# ============================================================================

import asyncio
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

from aiohttp import web

import config
import asm

# 链接脚本：.text 起始 0x80000000
LINKER_SCRIPT = r"""
OUTPUT_ARCH(riscv)
ENTRY(_start)
SECTIONS
{
  . = 0x80000000;
  .text : { *(.text) }
  .rodata : { *(.rodata) }
  .data : { *(.data) }
  .bss : { *(.bss) }
}
"""


def _tool_available(name: str) -> bool:
    """检查命令是否存在于 PATH"""
    for d in os.environ.get("PATH", "").split(os.pathsep):
        p = os.path.join(d, name)
        if os.path.exists(p) and os.access(p, os.X_OK):
            return True
    return False


def _compile_with_gcc(source: str, out_dir: Path) -> Dict[str, Any]:
    """使用 riscv-none-elf-gcc 编译"""
    src_path = out_dir / "prog.s"
    elf_path = out_dir / "prog.elf"
    ld_path = out_dir / "link.ld"
    src_path.write_text(source, encoding="utf-8")
    ld_path.write_text(LINKER_SCRIPT, encoding="utf-8")

    cmd = [
        config.RISCV_GCC,
        f"-march={config.ARCH}", f"-mabi={config.ABI}",
        "-nostdlib", "-nostartfiles", "-static",
        "-T", str(ld_path),
        "-o", str(elf_path),
        str(src_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        return {"success": False, "errors": [proc.stderr or proc.stdout]}

    # 反汇编（objdump 可用时）
    disassembly: List[Dict[str, str]] = []
    if _tool_available("riscv-none-elf-objdump"):
        od = subprocess.run(
            ["riscv-none-elf-objdump", "-d", str(elf_path)],
            capture_output=True, text=True, timeout=30,
        )
        for line in od.stdout.splitlines():
            m = re.match(r"^\s*([0-9a-fA-F]+):\s*([0-9a-fA-F]{8})\s+(.+)$", line)
            if m:
                disassembly.append({
                    "pc": "0x" + m.group(1),
                    "bytes": "0x" + m.group(2),
                    "text": m.group(3).split("\t")[0],
                })

    return {"success": True, "elf_path": str(elf_path), "disassembly": disassembly,
            "errors": [], "toolchain": "gcc"}


def _compile_with_fallback(source: str, out_dir: Path) -> Dict[str, Any]:
    """回退：Python 微型汇编器 → 裸二进制"""
    try:
        words = asm.assemble(source.splitlines())
    except Exception as e:  # noqa: BLE001
        return {"success": False, "errors": [str(e)]}

    bin_path = out_dir / "prog.bin"
    with open(bin_path, "wb") as f:
        for w in words:
            f.write(w.to_bytes(4, "little"))
    return {"success": True, "elf_path": str(bin_path), "disassembly": [],
            "errors": [], "toolchain": "fallback", "instructions": len(words)}


def compile_source(source: str, session_dir: Optional[str] = None) -> Dict[str, Any]:
    """编译汇编源码。返回 {success, elf_path, disassembly, errors, toolchain}"""
    out_dir = Path(session_dir) if session_dir else config.COMPILE_OUTPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    if _tool_available(config.RISCV_GCC):
        result = _compile_with_gcc(source, out_dir)
        if result["success"]:
            return result
        # gcc 失败时静默回退到微型汇编器
    return _compile_with_fallback(source, out_dir)


# ---------------------------------------------------------------------------
# aiohttp 服务（与 WebSocket 服务器共用同一事件循环）
# ---------------------------------------------------------------------------
CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


async def handle_compile(request: web.Request) -> web.Response:
    """POST /api/compile —— 编译汇编源码"""
    try:
        body = await request.json()
        source = body.get("source", "")
    except Exception:  # noqa: BLE001
        return web.json_response(
            {"success": False, "errors": ["无效的请求体"]}, status=400
        )

    # compile_source 为同步函数（内含 subprocess），放入线程池避免阻塞事件循环
    result = await asyncio.to_thread(compile_source, source)
    return web.json_response(result)


@web.middleware
async def cors_middleware(request: web.Request, handler):
    if request.method == "OPTIONS":
        return web.Response(status=200, headers=CORS_HEADERS)
    response = await handler(request)
    response.headers.update(CORS_HEADERS)
    return response


def build_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware])
    app.router.add_post("/api/compile", handle_compile)
    return app


async def start_http_server(port: int):
    """启动 aiohttp 编译服务（并入调用方事件循环）。返回 AppRunner，供 cleanup。"""
    runner = web.AppRunner(build_app())
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    return runner


if __name__ == "__main__":
    import asyncio

    async def _run():
        runner = await start_http_server(config.COMPILE_PORT)
        print(f"编译服务监听 http://localhost:{config.COMPILE_PORT}")
        try:
            await asyncio.Future()
        finally:
            await runner.cleanup()

    asyncio.run(_run())
