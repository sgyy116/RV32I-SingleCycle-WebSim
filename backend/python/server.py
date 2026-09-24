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
import tempfile
import uuid

import websockets

import config
from compile_server import start_http_server
from ws_adapter import WebSocketAdapter
from ws_handler import ConnectionHandler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("server")

# 每个连接一个临时目录（编译产物隔离）
SESSIONS: dict = {}


async def handle_connection(conn):
    """单个 WebSocket 客户端会话（websockets 连接处理器）"""
    session_id = str(uuid.uuid4())[:8]
    session_dir = tempfile.mkdtemp(prefix=f"rv32i-{session_id}-")
    ws = WebSocketAdapter(conn)
    log.info("客户端连接 (session=%s)", session_id)

    handler = ConnectionHandler(ws, session_dir)
    SESSIONS[session_id] = handler
    try:
        await handler.send({"type": "ready", "version": "1.0"})
        while True:
            raw = await ws.recv_text()
            if raw is None:
                break
            await handler.handle_message(raw)
    except Exception as e:  # noqa: BLE001
        log.warning("连接异常 %s: %s", session_id, e)
    finally:
        await handler.close()
        SESSIONS.pop(session_id, None)
        log.info("会话结束: %s", session_id)


async def main():
    # 同一事件循环启动 aiohttp 编译服务
    runner = await start_http_server(config.COMPILE_PORT)
    log.info("HTTP 编译服务已启动: http://localhost:%d", config.COMPILE_PORT)

    # 启动 WebSocket 服务器
    async with websockets.serve(
        handle_connection,
        "0.0.0.0",
        config.WEBSOCKET_PORT,
        max_size=4 * 1024 * 1024,
    ) as ws_server:
        log.info("WebSocket 服务器已启动: ws://localhost:%d", config.WEBSOCKET_PORT)
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

