"""匿名实验会话回归：真实编译、双入口并发、管道同步和资源回收。"""
import asyncio
import json
import logging
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

import aiohttp
from aiohttp import web
import websockets

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import server
import compile_server
from compile_server import build_app
from cpp_bridge import CppSimulatorBridge

logging.disable(logging.CRITICAL)


class SessionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.runner = web.AppRunner(build_app(server.handle_session))
        await self.runner.setup()
        site = web.TCPSite(self.runner, '127.0.0.1', 0)
        await site.start()
        self.http_url = f'http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}'
        self.ws_server = await websockets.serve(server.handle_connection, '127.0.0.1', 0)
        self.ws_url = f'ws://127.0.0.1:{self.ws_server.sockets[0].getsockname()[1]}'
        self.clients = []

    async def asyncTearDown(self):
        for ws in self.clients:
            await ws.close()
        self.ws_server.close()
        await self.ws_server.wait_closed()
        await self.runner.cleanup()
        self.assertEqual(server.SESSIONS, {})

    async def connect(self, standalone=False):
        url = self.ws_url if standalone else self.http_url.replace('http:', 'ws:') + '/ws'
        ws = await websockets.connect(url)
        self.clients.append(ws)
        ready = await self.recv(ws)
        self.assertEqual(ready['type'], 'ready')
        return ws, ready

    async def recv(self, ws):
        return json.loads(await asyncio.wait_for(ws.recv(), 3))

    async def command(self, ws, kind, **args):
        await ws.send(json.dumps(dict(type=kind, **args)))
        return await self.recv(ws)

    async def test_identity_and_state_are_isolated_across_both_entries(self):
        (a, ra), (b, rb) = await asyncio.gather(self.connect(), self.connect(True))
        self.assertNotEqual(ra.get('session_id'), rb.get('session_id'))
        self.assertEqual(len(ra['session_id']), 32)
        self.assertEqual((await self.command(a, 'hello'))['session_id'], ra['session_id'])
        loaded = await asyncio.gather(
            self.command(a, 'load', source='addi t0,zero,17\naddi t0,t0,1'),
            self.command(b, 'load', source='addi t0,zero,29\naddi t0,t0,2'))
        self.assertEqual([m['type'] for m in loaded], ['loaded', 'loaded'])
        sa, sb = await asyncio.gather(self.command(a, 'step'), self.command(b, 'step'))
        self.assertEqual([sa['state']['regfile'][5], sb['state']['regfile'][5]], [17, 29])
        directories = [Path(h.session_dir) for h in server.SESSIONS.values()]
        self.assertEqual(len(set(directories)), 2)
        self.assertTrue(all(p.is_dir() for p in directories))
        await self.command(a, 'reset')
        self.assertEqual((await self.command(b, 'step'))['state']['regfile'][5], 31)
        processes = [h.bridge.proc for h in server.SESSIONS.values()]
        for ws in (a, b):
            await ws.close()
        for _ in range(100):
            if not server.SESSIONS:
                break
            await asyncio.sleep(.02)
        self.assertFalse(server.SESSIONS)
        self.assertTrue(all(p.returncode is not None for p in processes))
        self.assertTrue(all(not p.exists() for p in directories))

    async def test_browser_cannot_load_another_sessions_file_even_in_local_mode(self):
        a, _ = await self.connect()
        b, _ = await self.connect()
        await self.command(a, 'load', source='addi t0,zero,55')
        owner = next(h for h in server.SESSIONS.values() if h.elf_path)
        rejected = await self.command(b, 'load_elf', path=owner.elf_path)
        self.assertEqual(rejected['type'], 'error')
        self.assertEqual((await self.command(b, 'step'))['type'], 'error')
        self.assertEqual((await self.command(a, 'step'))['state']['regfile'][5], 55)

    async def test_invalid_payload_does_not_destroy_session(self):
        ws, _ = await self.connect()
        for payload in ('[]', 'null', '{"type":"load","source":123}',
                        '{"type":"get_memory","count":-1}'):
            await ws.send(payload)
            self.assertEqual((await self.recv(ws))['type'], 'error')
        self.assertEqual((await self.command(ws, 'load', source='nop'))['type'], 'loaded')
        for count in (-1, 1000000000, 'oops'):
            self.assertEqual((await self.command(ws, 'get_memory', count=count))['type'], 'error')
        self.assertEqual((await self.command(ws, 'get_memory', count=4))['type'], 'memory_dump')

    async def test_run_query_pause_and_reload_do_not_mix_responses(self):
        ws, _ = await self.connect()
        await self.command(ws, 'load', source='loop: addi t0,t0,1\nj loop')
        await ws.send(json.dumps({'type': 'run'}))
        self.assertEqual((await self.recv(ws))['type'], 'cycle_state')
        await ws.send(json.dumps({'type': 'get_memory', 'count': 4}))
        for _ in range(200):
            msg = await self.recv(ws)
            if msg['type'] == 'memory_dump':
                break
            self.assertIn(msg['type'], ('cycle_state', 'paused'))
        else:
            self.fail('运行期间查询未得到正确响应')
        self.assertEqual(len(msg['bytes']), 4)
        await ws.send(json.dumps({'type': 'pause'}))
        for _ in range(200):
            if (await self.recv(ws))['type'] == 'paused_ack':
                break
        else:
            self.fail('暂停请求没有完成')
        self.assertEqual((await self.recv(ws))['type'], 'paused')
        self.assertEqual((await self.command(ws, 'load', source='addi t0,zero,7'))['type'], 'loaded')
        self.assertEqual((await self.command(ws, 'step'))['state']['regfile'][5], 7)

    async def test_repeated_load_reaps_previous_process(self):
        ws, _ = await self.connect()
        await self.command(ws, 'load', source='nop')
        handler = next(iter(server.SESSIONS.values()))
        old = handler.bridge.proc
        self.assertEqual((await self.command(ws, 'load', source='nop'))['type'], 'loaded')
        self.assertIsNot(handler.bridge.proc, old)
        self.assertEqual(old.returncode, 0)

    async def test_memory_breakpoints_failures_and_reconnect_are_independent(self):
        a, ra = await self.connect()
        b, _ = await self.connect(True)
        source = 'lui t1,0x80000\naddi t0,zero,73\nsw t0,256(t1)\nloop: j loop'
        for ws in (a, b):
            self.assertEqual((await self.command(ws, 'load', source=source))['type'], 'loaded')
        for _ in range(3):
            await self.command(a, 'step')
        ma = await self.command(a, 'get_memory', addr='0x80000100', count=4)
        mb = await self.command(b, 'get_memory', addr='0x80000100', count=4)
        self.assertEqual(ma['bytes'], [73, 0, 0, 0])
        self.assertEqual(mb['bytes'], [0, 0, 0, 0])
        await self.command(b, 'set_breakpoint', addr='0x80000004')
        await b.send(json.dumps({'type': 'run'}))
        self.assertEqual((await self.recv(b))['type'], 'cycle_state')
        self.assertEqual((await self.recv(b))['type'], 'breakpoint_hit')
        self.assertEqual((await self.command(b, 'load', source='not_an_instruction'))['type'], 'error')
        self.assertEqual((await self.command(a, 'step'))['state']['regfile'][5], 73)
        await a.close()
        fresh, rc = await self.connect()
        self.assertNotEqual(ra['session_id'], rc['session_id'])
        self.assertEqual((await self.command(fresh, 'step'))['type'], 'error')

    async def test_bridge_start_itself_reaps_previous_process(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / 'nop.bin'
            image.write_bytes(bytes.fromhex('13000000'))
            bridge = CppSimulatorBridge()
            old = None
            try:
                await bridge.start(str(image))
                old = bridge.proc
                await bridge.start(str(image))
                self.assertIsNotNone(old.returncode)
            finally:
                await bridge.shutdown()
                if old is not None and old.returncode is None:
                    old.kill()
                    await old.wait()

    async def test_http_compile_has_no_shared_artifacts_or_paths(self):
        # 本地调试端点保留结果预览，不再把文件路径作为跨会话加载凭据。
        directories = []
        actual_compile = compile_server.compile_source

        def record_compile(source, directory):
            directories.append(Path(directory))
            return actual_compile(source, directory)

        with patch.object(compile_server, 'compile_source', side_effect=record_compile):
            await self._http_previews()
        self.assertEqual(len(set(directories)), 2)
        self.assertTrue(all(not p.exists() for p in directories))

    async def test_cancelled_compilation_finishes_before_directory_cleanup(self):
        started, release = threading.Event(), threading.Event()
        directories = []
        actual_compile = compile_server.compile_source

        def slow_compile(source, directory):
            directories.append(Path(directory))
            started.set()
            if not release.wait(3):
                raise RuntimeError('测试编译线程未获释放')
            return actual_compile(source, directory)

        class Socket:
            async def send_text(self, _text):
                pass

            async def recv_text(self):
                return json.dumps({'type': 'load', 'source': 'nop'})

        with patch.object(compile_server, 'compile_source', side_effect=slow_compile):
            task = asyncio.create_task(server.handle_session(Socket()))
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 2))
                task.cancel()
                await asyncio.sleep(.03)
                self.assertTrue(directories[0].is_dir(), '编译还在写入时不能删除目录')
            finally:
                release.set()
                with self.assertRaises(asyncio.CancelledError):
                    await asyncio.wait_for(task, 4)
        self.assertFalse(directories[0].exists())
        self.assertEqual(server.SESSIONS, {})

    async def _http_previews(self):
        async with aiohttp.ClientSession() as http:
            async def compile_one(value):
                async with http.post(self.http_url + '/api/compile',
                                     json={'source': f'addi t0,zero,{value}'}) as r:
                    self.assertEqual(r.status, 200)
                    result = await r.json()
                    self.assertTrue(result['success'])
                    self.assertNotIn('elf_path', result)
            await asyncio.gather(compile_one(17), compile_one(29))


if __name__ == '__main__':
    unittest.main(verbosity=2)
