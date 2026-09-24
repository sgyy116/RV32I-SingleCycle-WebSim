# ============================================================================
# ws_adapter.py —— websockets 库连接适配器
#
# 把 websockets 的 ServerConnection 包装成 ws_handler 期望的
# send_text / recv_text / close 接口（与原 minimal_ws 一致），隔离第三方 API，
# 使上层业务代码（ws_handler / cpp_bridge）无需改动即可复用。
# ============================================================================

from websockets.exceptions import ConnectionClosed


class WebSocketAdapter:
    """包装 websockets.ServerConnection，提供 send_text/recv_text/close"""

    def __init__(self, conn):
        self.conn = conn

    async def send_text(self, text: str) -> None:
        await self.conn.send(text)

    async def recv_text(self):
        """返回下一条文本消息；连接关闭返回 None"""
        try:
            msg = await self.conn.recv()
        except ConnectionClosed:
            return None
        if isinstance(msg, bytes):
            return msg.decode("utf-8", errors="replace")
        return msg

    async def close(self) -> None:
        try:
            await self.conn.close()
        except Exception:  # noqa: BLE001
            pass
