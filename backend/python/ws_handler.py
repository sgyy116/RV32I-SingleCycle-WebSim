# ============================================================================
# ws_handler.py —— 单连接 WebSocket 消息路由分发
#
# 每个 WebSocket 客户端对应一个独立 C++ 模拟器子进程（进程级隔离）。
# 负责解析前端命令、调用 CppSimulatorBridge、回传结果。
# ============================================================================

import asyncio
import json
import logging
import uuid
from typing import Any, Dict, Optional

from cpp_bridge import CppSimulatorBridge
import compile_server

log = logging.getLogger("ws")

# 前端的 hello 消息用于连接初始化
HELLO_KEYS = {"type": "hello", "source": "..."}


class ConnectionHandler:
    """管理单个 WebSocket 连接的会话状态与命令路由"""

    def __init__(self, websocket, session_dir: str, session_id: Optional[str] = None):
        self.ws = websocket
        self.bridge: Optional[CppSimulatorBridge] = None
        self.running_task: Optional[asyncio.Task] = None
        self.pause_requested = False
        self.elf_path: Optional[str] = None
        self.session_dir = session_dir
        self.session_id = session_id or uuid.uuid4().hex
        self.breakpoints = set()

    async def send_ready(self) -> None:
        await self.send({"type": "ready", "version": "1.0", "session_id": self.session_id})

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
        # 取消会话时等待编译线程退出，再允许删除它使用的会话目录。
        compilation = asyncio.create_task(asyncio.to_thread(
            compile_server.compile_source, source, self.session_dir
        ))
        try:
            result = await asyncio.shield(compilation)
        except asyncio.CancelledError:
            try:
                await compilation
            finally:
                raise
        if not result["success"]:
            await self.send_error(
                "编译失败:\n" + "\n".join(result.get("errors", []))
            )
            return False

        self.elf_path = result["elf_path"]
        # 复用已有桥接（重新加载）或新建
        if self.bridge is None:
            self.bridge = CppSimulatorBridge()
        else:
            await self.bridge.shutdown()
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

        self.breakpoints.clear()

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
            await self._handle_message(raw)
        except (ValueError, TypeError, KeyError, RuntimeError, OSError, asyncio.TimeoutError) as e:
            await self.send_error(f"操作失败: {e}")

    async def _handle_message(self, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            await self.send_error("无效的 JSON 消息")
            return

        if not isinstance(msg, dict):
            await self.send_error("消息必须是 JSON 对象")
            return

        mtype = msg.get("type", msg.get("cmd"))

        # 编译 + 加载
        if mtype == "load":
            source = msg.get("source", "")
            if not isinstance(source, str) or not source.strip():
                await self.send_error("汇编源码必须是非空字符串")
                return
            await self._stop_running()
            await self.compile_and_load(source)

        elif mtype == "load_elf":
            # 网络客户端在任何模式下都不能以文件路径绕过会话归属。
            await self.send_error("不允许按服务器文件路径加载，请使用 load 提交源码")

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
            await self._stop_running()
            await self.send({"type": "paused_ack"})
            await self.send({"type": "paused"})

        elif mtype == "reset":
            await self._stop_running()
            if not self.bridge:
                await self.send_error("尚未加载程序")
                return
            await self.bridge.reset()
            await self.send({"type": "reset_done"})

        elif mtype == "set_breakpoint":
            await self._stop_running()
            addr = msg.get("addr")
            number = int(addr, 0)
            if self.bridge:
                await self.bridge.set_breakpoint(addr)
                self.breakpoints.add(number)
            await self.send({"type": "breakpoint_set", "addr": addr})

        elif mtype == "clear_breakpoint":
            await self._stop_running()
            addr = msg.get("addr")
            number = int(addr, 0)
            if self.bridge:
                await self.bridge.clear_breakpoint(addr)
                self.breakpoints.discard(number)
            await self.send({"type": "breakpoint_cleared", "addr": addr})

        elif mtype == "get_memory":
            count = self._query_count(msg, 16, 4096)
            await self._stop_running()
            if not self.bridge:
                await self.send_error("尚未加载程序")
                return
            resp = await self.bridge.get_memory(
                msg.get("addr", "0x80000000"), count
            )
            await self.send(resp)

        elif mtype == "get_disassembly":
            count = self._query_count(msg, 128, 1024)
            await self._stop_running()
            if not self.bridge:
                await self.send_error("尚未加载程序")
                return
            resp = await self.bridge.send({
                "cmd": "disassemble",
                "start": msg.get("addr", "0x80000000"),
                "count": count,
            })
            await self.send(resp)

        elif mtype == "hello":
            await self.send_ready()

        else:
            await self.send_error(f"未知消息类型: {mtype}")

    # ------------------------------------------------------------------ 连续运行
    @staticmethod
    def _query_count(msg, default, maximum):
        count = msg.get("count", default)
        if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= maximum:
            raise ValueError(f"count 必须是 1 至 {maximum} 的整数")
        return count

    async def _run_loop(self) -> None:
        """逐条请求完整响应，暂停后管道里不会遗留批量运行状态。"""
        try:
            for _ in range(100000):
                if self.pause_requested:
                    break
                msg = await self.bridge.step()
                await self.send(msg)
                if msg.get("state", {}).get("halted"):
                    await self.send({
                        "type": "halted",
                        "cycle": msg.get("cycle", 0),
                        "exit_code": self._last_exit_code(msg),
                    })
                    return
                next_pc = msg.get("state", {}).get("next_pc")
                if next_pc and int(next_pc, 0) in self.breakpoints:
                    await self.send({"type": "breakpoint_hit", "addr": next_pc,
                                     "cycle": msg.get("cycle", 0)})
                    return
                await asyncio.sleep(0)
            if not self.pause_requested:
                await self.send({"type": "paused", "reason": "cycle_limit"})
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
            task = self.running_task
            self.pause_requested = True
            try:
                # 正常命令切换不取消正在读取的响应，等待当前周期完整结束。
                await asyncio.wait_for(asyncio.shield(task), timeout=12)
            except asyncio.TimeoutError:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            finally:
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
