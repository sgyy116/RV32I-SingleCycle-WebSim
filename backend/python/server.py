# ============================================================================
# server.py —— asyncio WebSocket 服务器主入口（端口 8080）
#
# 依赖: websockets（WebSocket 服务）+ aiohttp（HTTP 编译服务）
# 架构:
#   WebSocket 客户端 (前端)
#        │  JSON 消息
#        ▼
#   server.py  ── 每客户端一个 ConnectionHandler + 独立 C++ 子进程
#        │
#        ▼
#   rv32i_sim (C++ 单周期模拟核心)
#
# 同一事件循环内同时启动 HTTP 编译服务（端口 8081，aiohttp）。
# ============================================================================

import asyncio
import json
import logging
import shutil
import sys
import tempfile
import uuid

# 不写 __pycache__：交付包被反复启动、关闭之后，目录里不会多出任何文件。
# 启动器已经用 python -B，这里再兜一层——测试脚本会直接 spawn 本文件，
# 不经过启动器。必须写在下面那些本地模块 import 之前才起作用。
sys.dont_write_bytecode = True

import websockets

import config
from compile_server import start_http_server
from ws_adapter import WebSocketAdapter
from ws_handler import ConnectionHandler
from admission import get_admission

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("server")

# 每个连接一个临时目录（编译产物隔离）
SESSIONS: dict = {}


async def handle_connection(conn):
    """单个 WebSocket 客户端会话（websockets 连接处理器）"""
    await handle_session(WebSocketAdapter(conn))


async def handle_session(ws):
    """两个 WebSocket 入口共享会话隔离、消息处理和退出清理。"""
    session_id = uuid.uuid4().hex
    gate = get_admission()
    ticket = gate.join(session_id, ws)
    if ticket is None:
        await ws.send_text(json.dumps({'type': 'queue_full', 'message': '等待人数已达上限，请稍后重新加入'}))
        await ws.close()
        return
    handler = None
    session_dir = None
    try:
        if not ticket.done():
            await gate.notify()
            receiver = asyncio.create_task(ws.recv_text())
            try:
                while not ticket.done():
                    done, _ = await asyncio.wait((ticket, receiver), return_when=asyncio.FIRST_COMPLETED)
                    if receiver in done:
                        raw = receiver.result()
                        if raw is None:
                            return
                        try:
                            message = json.loads(raw)
                        except (ValueError, TypeError):
                            message = None
                        if isinstance(message, dict) and message.get('type') == 'cancel_queue':
                            await ws.close()
                            return
                        # 等待期间的命令不执行、不缓存；准入后需由用户重新提交。
                        if not ticket.done():
                            await gate.notify(force_identity=session_id)
                        receiver = asyncio.create_task(ws.recv_text())
            finally:
                receiver.cancel()
                await asyncio.gather(receiver, return_exceptions=True)
        session_dir = tempfile.mkdtemp(prefix=f"rv32i-{session_id}-")
        handler = ConnectionHandler(ws, session_dir, session_id)
        SESSIONS[session_id] = handler
        log.info("客户端进入实验 (session=%s)", session_id)
        await handler.send_ready()
        while True:
            try:
                raw = await asyncio.wait_for(ws.recv_text(), config.SESSION_IDLE_SECONDS)
            except asyncio.TimeoutError:
                await handler.send({'type': 'session_expired', 'message': '实验长时间未操作，已释放名额，请重新加入'})
                await ws.close()
                break
            if raw is None:
                break
            await handler.handle_message(raw)
    except Exception as e:  # noqa: BLE001
        log.warning("连接异常 %s: %s", session_id, e)
    finally:
        try:
            if handler is not None:
                await handler.close()
        finally:
            SESSIONS.pop(session_id, None)
            if session_dir is not None:
                shutil.rmtree(session_dir, ignore_errors=True)
            await gate.release(session_id)
            log.info("会话结束: %s", session_id)


async def main():
    # 同一事件循环启动 aiohttp 编译服务
    runner = await start_http_server(config.COMPILE_PORT, handle_session)
    log.info("HTTP 服务已启动: http://%s:%d", config.BIND_HOST, config.COMPILE_PORT)

    # 启动 WebSocket 服务器
    async with websockets.serve(
        handle_connection,
        config.BIND_HOST,
        config.WEBSOCKET_PORT,
        max_size=4 * 1024 * 1024,
    ) as ws_server:
        log.info("WebSocket 服务器已启动: ws://%s:%d", config.BIND_HOST, config.WEBSOCKET_PORT)
        log.info("等待前端连接...")
        try:
            await asyncio.Future()  # 永久运行
        except (KeyboardInterrupt, asyncio.CancelledError):
            pass
        finally:
            await runner.cleanup()
            log.info("服务器已停止")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("服务器已停止")
