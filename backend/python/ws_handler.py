# ============================================================================
# ws_handler.py —— 单连接 WebSocket 消息路由分发
#
# 每个 WebSocket 客户端对应一个独立 C++ 模拟器子进程（进程级隔离）。
# 负责解析前端命令、调用 CppSimulatorBridge、回传结果。
# ============================================================================

import asyncio
import json
import logging
import tempfile
from typing import Any, Dict, Optional

from cpp_bridge import CppSimulatorBridge
import compile_server

log = logging.getLogger("ws")

# 前端的 hello 消息用于连接初始化
HELLO_KEYS = {"type": "hello", "source": "..."}


class ConnectionHandler:
    """管理单个 WebSocket 连接的会话状态与命令路由"""

    def __init__(self, websocket, session_dir: str):
        self.ws = websocket
        self.bridge: Optional[CppSimulatorBridge] = None
        self.running_task: Optional[asyncio.Task] = None
        self.pause_requested = False
        self.elf_path: Optional[str] = None
        self.session_dir = session_dir

    # ------------------------------------------------------------------ 工具
    async def send(self, payload: Dict[str, Any]) -> None:
        await self.ws.send_text(json.dumps(payload, ensure_ascii=False))

    async def send_error(self, message: str) -> None:
        await self.send({"type": "error", "message": message})
        log.warning("error -> client: %s", message)

    # ------------------------------------------------------------------ 编译加载
    async def compile_and_load(self, source: str) -> bool:
        """编译汇编源码为 ELF 并加载到模拟器"""
        # compile_source 为同步函数（内含 subprocess），放入线程池避免阻塞事件循环
        result = await asyncio.to_thread(
            compile_server.compile_source, source, self.session_dir
        )
        if not result["success"]:
            await self.send_error(
                "编译失败:\n" + "\n".join(result.get("errors", []))
            )
            return False

        self.elf_path = result["elf_path"]
        # 复用已有桥接（重新加载）或新建
        if self.bridge is None:
            self.bridge = CppSimulatorBridge()
        try:
            resp = await self.bridge.start(self.elf_path)
        except FileNotFoundError as e:
            await self.send_error(str(e))
            return False
        except Exception as e:  # noqa: BLE001
            await self.send_error(f"加载失败: {e}")
            return False

        if resp.get("status") != "ok":
            await self.send_error(f"加载失败: {resp.get('message', '未知错误')}")
            return False

        await self.send({
            "type": "loaded",
            "entry": resp.get("entry"),
            "arch": resp.get("arch"),
            "disassembly": result.get("disassembly", []),
        })
        return True

    # ------------------------------------------------------------------ 命令路由
    async def handle_message(self, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            await self.send_error("无效的 JSON 消息")
            return

        mtype = msg.get("type", msg.get("cmd"))

        # 编译 + 加载
        if mtype == "load":
            source = msg.get("source", "")
            if not source.strip():
                await self.send_error("汇编源码为空")
                return
            await self._stop_running()
            await self.compile_and_load(source)

        elif mtype == "load_elf":
            # 直接加载已存在的 ELF 路径（测试/调试用）
            path = msg.get("path")
            if not path:
                await self.send_error("缺少 path")
                return
            if self.bridge is None:
                self.bridge = CppSimulatorBridge()
            try:
                resp = await self.bridge.start(path)
            except FileNotFoundError as e:
                await self.send_error(str(e))
                return
            except Exception as e:  # noqa: BLE001
                await self.send_error(f"加载失败: {e}")
                return
            if resp.get("status") != "ok":
                await self.send_error(f"加载失败: {resp.get('message', '未知错误')}")
                return
            await self.send({
                "type": "loaded",
                "entry": resp.get("entry"),
                "arch": resp.get("arch"),
            })

        elif mtype == "step":
            await self._stop_running()
            if not self.bridge:
                await self.send_error("尚未加载程序")
                return
            resp = await self.bridge.step()
            await self.send(resp)
            if resp.get("state", {}).get("halted"):
                await self.send({
                    "type": "halted",
                    "cycle": resp.get("cycle", 0),
                    "exit_code": self._last_exit_code(resp),
                })

        elif mtype == "run":
            await self._stop_running()
            if not self.bridge:
                await self.send_error("尚未加载程序")
                return
            self.pause_requested = False
            self.running_task = asyncio.create_task(self._run_loop())

        elif mtype == "pause":
            self.pause_requested = True
            await self.send({"type": "paused_ack"})

        elif mtype == "reset":
            await self._stop_running()
            if not self.bridge:
                await self.send_error("尚未加载程序")
                return
            await self.bridge.reset()
            await self.send({"type": "reset_done"})

        elif mtype == "set_breakpoint":
            addr = msg.get("addr")
            if self.bridge:
                await self.bridge.set_breakpoint(addr)
            await self.send({"type": "breakpoint_set", "addr": addr})

        elif mtype == "clear_breakpoint":
            addr = msg.get("addr")
            if self.bridge:
                await self.bridge.clear_breakpoint(addr)
            await self.send({"type": "breakpoint_cleared", "addr": addr})

        elif mtype == "get_memory":
            if not self.bridge:
                await self.send_error("尚未加载程序")
                return
            resp = await self.bridge.get_memory(
                msg.get("addr", "0x80000000"), int(msg.get("count", 16))
            )
            await self.send(resp)

        elif mtype == "get_disassembly":
            if not self.bridge:
                await self.send_error("尚未加载程序")
                return
            resp = await self.bridge.send({
                "cmd": "disassemble",
                "start": msg.get("addr", "0x80000000"),
                "count": int(msg.get("count", 128)),
            })
            await self.send(resp)

        elif mtype == "hello":
            await self.send({"type": "ready", "version": "1.0"})

        else:
            await self.send_error(f"未知消息类型: {mtype}")

    # ------------------------------------------------------------------ 连续运行
    async def _run_loop(self) -> None:
        """连续运行：转发 C++ 流式输出，支持 pause"""
        try:
            async for msg in self.bridge.run(max_cycles=100000):
                if self.pause_requested:
                    self.bridge.proc.stdin.write(
                        json.dumps({"cmd": "pause"}).encode() + b"\n"
                    )
                    try:
                        await self.bridge.proc.stdin.drain()
                    except Exception:  # noqa: BLE001
                        pass
                    await self.send({"type": "paused"})
                    break
                await self.send(msg)
                if msg.get("state", {}).get("halted"):
                    await self.send({
                        "type": "halted",
                        "cycle": msg.get("cycle", 0),
                        "exit_code": self._last_exit_code(msg),
                    })
                    break
        except asyncio.CancelledError:
            pass
        except Exception as e:  # noqa: BLE001
            await self.send_error(f"运行中断: {e}")
        finally:
            self.running_task = None

    def _last_exit_code(self, msg: Dict[str, Any]) -> int:
        state = msg.get("state", {})
        regs = state.get("regfile", [])
        return regs[10] if len(regs) > 10 else 0

    async def _stop_running(self) -> None:
        if self.running_task:
            self.running_task.cancel()
            try:
                await self.running_task
            except Exception:  # noqa: BLE001
                pass
            self.running_task = None

    # ------------------------------------------------------------------ 清理
    async def close(self) -> None:
        await self._stop_running()
        if self.bridge:
            try:
                await self.bridge.shutdown()
            except Exception:  # noqa: BLE001
                pass
            self.bridge = None
