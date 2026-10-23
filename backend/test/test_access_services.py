"""网络检测接口与双 WebSocket 入口共用的实验准入队列。"""
import asyncio
import json
import io
import logging
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import aiohttp
from aiohttp import web
import websockets

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import config
import server
from compile_server import build_app
from admission import Admission

logging.disable(logging.CRITICAL)


class AccessTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.settings = patch.multiple(config, MAX_SESSIONS=1, MAX_WAITING=2, SESSION_IDLE_SECONDS=60,
                                       create=True)
        self.settings.start()
        self.runner = web.AppRunner(build_app(server.handle_session))
        await self.runner.setup()
        site = web.TCPSite(self.runner, '127.0.0.1', 0)
        await site.start()
        self.base = f'http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}'
        self.standalone = await websockets.serve(server.handle_connection, '127.0.0.1', 0)
        self.other = f'ws://127.0.0.1:{self.standalone.sockets[0].getsockname()[1]}'
        self.clients = []
        self.http = aiohttp.ClientSession()

    async def asyncTearDown(self):
        for ws in self.clients:
            await ws.close()
        self.standalone.close()
        await self.standalone.wait_closed()
        await self.runner.cleanup()
        await self.http.close()
        self.settings.stop()
        self.assertFalse(server.SESSIONS)

    async def connect(self, other=False):
        ws = await websockets.connect(self.other if other else self.base.replace('http:', 'ws:') + '/ws')
        self.clients.append(ws)
        return ws, await self.recv(ws)

    async def recv(self, ws):
        return json.loads(await asyncio.wait_for(ws.recv(), 3))

    async def until(self, ws, kind):
        for _ in range(10):
            msg = await self.recv(ws)
            if msg['type'] == kind:
                return msg
        self.fail(f'没有收到 {kind}')

    async def test_fifo_queue_shares_limit_and_allocates_no_simulator(self):
        a, ready = await self.connect()
        self.assertEqual(ready['type'], 'ready')
        b, queued = await self.connect(True)
        self.assertEqual(queued['type'], 'queued')
        self.assertEqual(queued['position'], 1)
        self.assertEqual(queued['active'], 1)
        c, second = await self.connect()
        self.assertEqual(second['type'], 'queued')
        self.assertEqual(second['position'], 2)
        self.assertEqual(len(server.SESSIONS), 1, '等待者不应创建实验目录和进程')
        self.assertTrue(all(h.bridge is None for h in server.SESSIONS.values()))
        await a.close()
        self.assertEqual((await self.until(b, 'ready'))['type'], 'ready')
        update = await self.until(c, 'queued')
        while update['position'] != 1:
            update = await self.recv(c)
        await b.send(json.dumps({'type': 'load', 'source': 'addi t0,zero,42'}))
        self.assertEqual((await self.recv(b))['type'], 'loaded')
        await b.send(json.dumps({'type': 'step'}))
        self.assertEqual((await self.recv(b))['state']['regfile'][5], 42)
        await b.close()
        self.assertEqual((await self.until(c, 'ready'))['type'], 'ready')

    async def test_queue_cancel_full_and_commands_are_not_executed(self):
        a, _ = await self.connect()
        b, msg = await self.connect()
        self.assertEqual(msg['type'], 'queued')
        c, _ = await self.connect(True)
        d, full = await self.connect()
        self.assertEqual(full['type'], 'queue_full')
        await asyncio.wait_for(d.wait_closed(), 3)
        await b.send(json.dumps({'type': 'load', 'source': 'nop'}))
        self.assertEqual((await self.until(b, 'queued'))['position'], 1)
        await b.send(json.dumps({'type': 'cancel_queue'}))
        await asyncio.wait_for(b.wait_closed(), 3)
        for _ in range(10):
            if (await self.until(c, 'queued'))['position'] == 1:
                break
        else:
            self.fail('退出排队后位置未更新')
        await a.close()
        self.assertEqual((await self.until(c, 'ready'))['type'], 'ready')
        await c.send(json.dumps({'type': 'step'}))
        self.assertEqual((await self.recv(c))['type'], 'error')

    async def test_waiting_disconnect_does_not_take_next_slot(self):
        a, _ = await self.connect()
        b, msg = await self.connect()
        self.assertEqual(msg['type'], 'queued')
        await b.close()
        c, _ = await self.connect(True)
        await a.close()
        self.assertEqual((await self.until(c, 'ready'))['type'], 'ready')

    async def test_queue_only_notifies_changed_positions(self):
        class Socket:
            def __init__(self):
                self.messages = []

            async def send_text(self, text):
                self.messages.append(json.loads(text))

        gate = Admission()
        gate.join('active', Socket())
        sockets = [Socket() for _ in range(5)]
        with patch.object(config, 'MAX_WAITING', 10):
            for index, socket in enumerate(sockets):
                gate.join(str(index), socket)
                await gate.notify()
        self.assertEqual(sum(len(socket.messages) for socket in sockets), 5,
                         '队尾加入不应重复广播未变化的位置')
        await gate.release('active')
        self.assertEqual(sum(len(socket.messages) for socket in sockets), 9,
                         '队首准入后，只需向剩余四人更新位置')
        self.assertEqual([socket.messages[-1]['position'] for socket in sockets[1:]], [1, 2, 3, 4])

    async def test_idle_active_session_releases_slot(self):
        with patch.object(config, 'SESSION_IDLE_SECONDS', .15, create=True):
            a, _ = await self.connect()
            b, msg = await self.connect()
            self.assertEqual(msg['type'], 'queued')
            self.assertEqual((await self.until(a, 'session_expired'))['type'], 'session_expired')
            self.assertEqual((await self.until(b, 'ready'))['type'], 'ready')

    async def test_network_probe_is_uncached_bounded_and_works_while_queued(self):
        await self.connect()
        _, msg = await self.connect()
        self.assertEqual(msg['type'], 'queued')
        async with self.http.get(self.base + '/api/network/ping') as response:
            self.assertEqual(response.status, 200)
            self.assertTrue((await response.json())['ok'])
            self.assertIn('no-store', response.headers['Cache-Control'])
        async with self.http.get(self.base + '/api/network/download?size=65536') as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(len(await response.read()), 65536)
            self.assertNotIn('Content-Encoding', response.headers)
        async with self.http.get(self.base + '/api/network/download?size=999999999') as response:
            self.assertEqual(response.status, 400)
        async with self.http.post(self.base + '/api/network/upload', data=b'x' * 262144) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual((await response.json())['bytes'], 262144)
        async with self.http.post(self.base + '/api/network/upload', data=io.BytesIO(b'x' * (1048576 + 1))) as response:
            self.assertEqual(response.status, 413)


if __name__ == '__main__':
    unittest.main(verbosity=2)
