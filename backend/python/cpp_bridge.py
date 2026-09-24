# ============================================================================
# cpp_bridge.py —— C++ 模拟器子进程创建与 JSON 逐行通信管理
#
# 与 C++ 侧协议（backend/cpp/src/main.cpp）保持一致：
#   请求: {"cmd":"step"} / {"cmd":"load_elf","path":...} / ...
#   响应: {"type":"cycle_state",...} / {"status":"ok",...} / ...
# ============================================================================

import asyncio
import json
import os
from typing import Any, AsyncIterator, Dict, Optional

import config


class CppSimulatorBridge:
    """管理单个 C++ 模拟器子进程（每 WebSocket 客户端一个实例）"""

    def __init__(self, exe_path: Optional[str] = None):
        self.exe_path = exe_path or config.SIM_PATH
        self.proc: Optional[asyncio.subprocess.Process] = None

    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def start(self, elf_path: str) -> Dict[str, Any]:
        """启动子进程并加载 ELF，返回 load_elf 响应"""
        if not os.path.exists(self.exe_path):
            raise FileNotFoundError(
                f"模拟器可执行文件不存在: {self.exe_path}，请先编译 C++ 后端"
            )
        self.proc = await asyncio.create_subprocess_exec(
            self.exe_path,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        return await self.send({"cmd": "load_elf", "path": elf_path})

    async def send(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        """发送 JSON 命令，等待一行 JSON 响应"""
        if not self.proc or not self.proc.stdin:
            raise RuntimeError("模拟器未启动")
        line = json.dumps(cmd, ensure_ascii=False) + "\n"
        self.proc.stdin.write(line.encode("utf-8"))
        await self.proc.stdin.drain()

        response_line = await self.proc.stdout.readline()
        if not response_line:
            stderr = await self._drain_stderr()
            raise RuntimeError(f"模拟器无响应: {stderr}")
        return json.loads(response_line.decode("utf-8"))

    async def step(self) -> Dict[str, Any]:
        """单步执行，返回完整 cycle_state"""
        return await self.send({"cmd": "step"})

    async def run(self, max_cycles: int = 100000) -> AsyncIterator[Dict[str, Any]]:
        """连续运行：逐周期产出 cycle_state，直到停机/断点/pause"""
        if not self.proc or not self.proc.stdin:
            raise RuntimeError("模拟器未启动")
        self.proc.stdin.write(
            json.dumps({"cmd": "run", "max_cycles": max_cycles}).encode() + b"\n"
        )
        await self.proc.stdin.drain()
        while True:
            line = await self.proc.stdout.readline()
            if not line:
                break
            try:
                msg = json.loads(line.decode("utf-8"))
            except json.JSONDecodeError:
                continue
            yield msg
            t = msg.get("type")
            if t in ("breakpoint_hit", "paused", "bye"):
                break
            if msg.get("state", {}).get("halted"):
                # 继续读取 run 结束后的清理信息
                yield msg
                break

    async def reset(self) -> Dict[str, Any]:
        return await self.send({"cmd": "reset"})

    async def set_breakpoint(self, addr: str) -> Dict[str, Any]:
        return await self.send({"cmd": "set_breakpoint", "addr": addr})

    async def clear_breakpoint(self, addr: str) -> Dict[str, Any]:
        return await self.send({"cmd": "clear_breakpoint", "addr": addr})

    async def get_memory(self, addr: str, count: int = 16) -> Dict[str, Any]:
        return await self.send({"cmd": "get_memory", "addr": addr, "count": count})

    async def shutdown(self) -> None:
        if self.proc and self.proc.returncode is None:
            try:
                self.proc.stdin.write(json.dumps({"cmd": "shutdown"}) + "\n")
                await self.proc.stdin.drain()
            except Exception:
                pass
            try:
                await asyncio.wait_for(self.proc.wait(), timeout=2)
            except Exception:
                try:
                    self.proc.kill()
                except Exception:
                    pass
        self.proc = None

    async def _drain_stderr(self) -> str:
        if self.proc and self.proc.stderr:
            try:
                data = await asyncio.wait_for(self.proc.stderr.read(), timeout=0.5)
                return data.decode("utf-8", errors="replace")[:500]
            except Exception:
                return ""
        return ""
