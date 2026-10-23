"""单进程内两个 WebSocket 入口共用的有界先到先服务队列。"""
import asyncio
from collections import OrderedDict
import json

import config


class Admission:
    def __init__(self):
        self.active = set()
        self.waiting = OrderedDict()
        self.notification_lock = asyncio.Lock()
        self.last_sent = {}

    def join(self, identity, ws):
        future = asyncio.get_running_loop().create_future()
        if len(self.active) < config.MAX_SESSIONS and not self.waiting:
            self.active.add(identity)
            future.set_result(None)
        elif len(self.waiting) < config.MAX_WAITING:
            self.waiting[identity] = (future, ws)
        else:
            return None
        return future

    async def notify(self, force_identity=None):
        # 串行生成最新快照，避免位置更新晚于准入消息到达。
        async with self.notification_lock:
            async def send(identity, position, ws):
                payload = json.dumps({'type': 'queued', 'position': position,
                                      'active': len(self.active), 'capacity': config.MAX_SESSIONS})
                if identity != force_identity and self.last_sent.get(identity) == payload:
                    return
                try:
                    await asyncio.wait_for(ws.send_text(payload), 2)
                    if identity in self.waiting:
                        self.last_sent[identity] = payload
                except Exception:
                    pass  # 对应连接的接收协程负责退出及释放名额。
            await asyncio.gather(*(send(identity, index, ws) for index, (identity, (_, ws))
                                   in enumerate(list(self.waiting.items()), 1)))

    async def release(self, identity):
        self.active.discard(identity)
        item = self.waiting.pop(identity, None)
        self.last_sent.pop(identity, None)
        if item is not None:
            item[0].cancel()
        # 等待旧位置通知结束后再准入，保证 queued 不会落在 ready 后。
        async with self.notification_lock:
            while self.waiting and len(self.active) < config.MAX_SESSIONS:
                identity, (future, _) = self.waiting.popitem(last=False)
                self.last_sent.pop(identity, None)
                if not future.done():
                    self.active.add(identity)
                    future.set_result(None)
        await self.notify()


_manager = None
_loop = None


def get_admission():
    global _manager, _loop
    loop = asyncio.get_running_loop()
    if _loop is not loop:
        if _manager is not None and (_manager.active or _manager.waiting):
            raise RuntimeError('旧事件循环仍有实验会话')
        _manager, _loop = Admission(), loop
    return _manager
