"""回归：HTTP 同源 /ws 可运行，会话隔离与服务器模式限制不能丢失。"""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import aiohttp
import websockets
from aiohttp import web

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import server as middleware
from compile_server import build_app
from cpp_bridge import CppSimulatorBridge

ROOT = Path(__file__).resolve().parents[2]


class SameOriginTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='rv32i-test-')
        cls.log = tempfile.TemporaryFile()
        cls.process = subprocess.Popen(
            [sys.executable, '-B', str(ROOT / 'backend/python/server.py')], cwd=ROOT,
            env=dict(os.environ, WS_PORT='23980', COMPILE_PORT='23981',
                     RV32I_BIND_HOST='127.0.0.1', RV32I_SERVER_MODE='1',
                     TEMP=cls.temp.name, TMP=cls.temp.name, TMPDIR=cls.temp.name),
            stdout=cls.log, stderr=cls.log,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait()
        cls.log.close()
        cls.temp.cleanup()

    async def asyncSetUp(self):
        self.http = aiohttp.ClientSession()
        for _ in range(100):
            try:
                async with self.http.get('http://127.0.0.1:23981/') as r:
                    if r.status == 200:
                        return
            except aiohttp.ClientError:
                pass
            await asyncio.sleep(.05)
        self.fail('HTTP 服务未启动')

    async def asyncTearDown(self):
        await self.http.close()

    async def connect(self, port=23981):
        try:
            ws = await websockets.connect(f'ws://127.0.0.1:{port}/ws')
        except Exception as exc:
            self.fail(f'{port} 的 /ws 握手失败：{exc}')
        self.assertEqual(json.loads(await ws.recv())['type'], 'ready')
        return ws

    async def test_same_origin_load_step_and_cleanup(self):
        ws = await self.connect()
        async with ws:
            await ws.send(json.dumps({'type': 'load', 'source': 'addi t0,zero,42'}))
            self.assertEqual(json.loads(await ws.recv())['type'], 'loaded')
            await ws.send(json.dumps({'type': 'step'}))
            state = json.loads(await ws.recv())
            self.assertEqual(state['state']['regfile'][5], 42)
        for _ in range(100):
            if not list(Path(self.temp.name).glob('rv32i-*')):
                break
            await asyncio.sleep(.05)
        self.assertEqual(list(Path(self.temp.name).glob('rv32i-*')), [])

    async def test_independent_sessions(self):
        async def run(value):
            ws = await self.connect()
            async with ws:
                await ws.send(json.dumps({'type': 'load', 'source': f'addi t0,zero,{value}'}))
                self.assertEqual(json.loads(await ws.recv())['type'], 'loaded')
                await ws.send(json.dumps({'type': 'step'}))
                return json.loads(await ws.recv())['state']['regfile'][5]
        self.assertEqual(await asyncio.gather(run(17), run(29)), [17, 29])

    async def test_server_restrictions_and_invalid_json(self):
        async with self.http.post('http://127.0.0.1:23981/api/compile', json={'source': 'nop'}) as r:
            self.assertIn(r.status, (404, 405))
        ws = await self.connect()
        async with ws:
            await ws.send(json.dumps({'type': 'load_elf', 'path': str(ROOT / 'VERSION')}))
            self.assertEqual(json.loads(await ws.recv())['type'], 'error')
            await ws.send('invalid json')
            self.assertEqual(json.loads(await ws.recv())['type'], 'error')
            await ws.send(json.dumps({'type': 'load', 'source': 'nop'}))
            self.assertEqual(json.loads(await ws.recv())['type'], 'loaded')

    async def test_standalone_websocket_remains_available(self):
        ws = await self.connect(23980)
        await ws.close()

    async def test_active_same_origin_server_shutdown(self):
        runner = web.AppRunner(build_app(middleware.handle_session), shutdown_timeout=.3)
        await runner.setup()
        await web.TCPSite(runner, '127.0.0.1', 23982).start()
        ws = None
        try:
            ws = await self.connect(23982)
            await ws.send(json.dumps({'type': 'load', 'source': 'nop'}))
            self.assertEqual(json.loads(await ws.recv())['type'], 'loaded')
            await asyncio.wait_for(runner.cleanup(), timeout=3)
            await asyncio.wait_for(ws.wait_closed(), timeout=3)
            self.assertEqual(ws.close_code, 1001, '停服必须主动发送 GOING_AWAY，而非超时强制断开')
            self.assertEqual(middleware.SESSIONS, {})
        finally:
            if ws is not None:
                await ws.close()
            await runner.cleanup()

    async def test_bridge_shutdown_exits_normally(self):
        image = Path(self.temp.name) / 'shutdown.bin'
        image.write_bytes(bytes.fromhex('13000000'))  # nop
        bridge = CppSimulatorBridge()
        try:
            self.assertEqual((await bridge.start(str(image)))['status'], 'ok')
            process = bridge.proc
            await bridge.shutdown()
            self.assertEqual(process.returncode, 0, '正常停服不应等超时后强杀核心')
        finally:
            await bridge.shutdown()


if __name__ == '__main__':
    unittest.main(verbosity=2)
