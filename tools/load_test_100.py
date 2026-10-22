#!/usr/bin/env python3
"""先建立全部会话，再统一发起编译加载和单步；依赖 aiohttp、websockets。"""

import argparse
import asyncio
import json
import statistics
import time
from pathlib import Path
from urllib.parse import urlsplit

import aiohttp
import websockets


SOURCE = "addi t0, zero, 42\naddi a0, zero, 0\necall\n"


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * fraction))]


async def run(args):
    parsed = urlsplit(args.url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("--url 必须是完整的 http(s) 地址")
    ws_url = args.ws_url or f"{'wss' if parsed.scheme == 'https' else 'ws'}://{parsed.netloc}/ws"
    source = Path(args.source_file).read_text(encoding="utf-8") if args.source_file else SOURCE
    start = asyncio.Event()
    compile_start = asyncio.Event()
    release = asyncio.Event()
    total_latencies = []
    compile_latencies = []
    send_times = []
    errors = []
    connected = prepared = completed = peak = 0
    timeout = aiohttp.ClientTimeout(total=args.timeout)

    async with aiohttp.ClientSession(timeout=timeout) as http:
        async def user(index):
            nonlocal connected, prepared, completed, peak
            await start.wait()
            began = time.perf_counter()
            opened = False
            try:
                async with http.get(args.url) as response:
                    if response.status != 200:
                        raise RuntimeError(f"页面 HTTP {response.status}")
                    await response.read()
                async with websockets.connect(
                    ws_url, open_timeout=args.timeout, close_timeout=3, max_size=4 * 1024 * 1024
                ) as ws:
                    opened = True
                    connected += 1
                    peak = max(peak, connected)
                    msg = json.loads(await asyncio.wait_for(ws.recv(), args.timeout))
                    if msg.get("type") != "ready":
                        raise RuntimeError(f"连接响应异常: {str(msg)[:100]}")
                    prepared += 1
                    await compile_start.wait()
                    sent_at = time.perf_counter()
                    await ws.send(json.dumps({"type": "load", "source": source}))
                    send_times.append(sent_at)
                    msg = json.loads(await asyncio.wait_for(ws.recv(), args.timeout))
                    if msg.get("type") != "loaded":
                        raise RuntimeError(f"加载响应异常: {str(msg)[:150]}")
                    compile_latencies.append(time.perf_counter() - sent_at)
                    await ws.send(json.dumps({"type": "step"}))
                    msg = json.loads(await asyncio.wait_for(ws.recv(), args.timeout))
                    if msg.get("type") != "cycle_state":
                        raise RuntimeError(f"单步响应异常: {str(msg)[:150]}")
                    total_latencies.append(time.perf_counter() - began)
                    completed += 1
                    await release.wait()
            except Exception as exc:
                errors.append(f"用户 {index}: {type(exc).__name__}: {exc}")
            finally:
                if opened:
                    connected -= 1

        tasks = [asyncio.create_task(user(i + 1)) for i in range(args.users)]
        start.set()
        deadline = time.monotonic() + args.timeout
        while prepared + len(errors) < args.users and time.monotonic() < deadline:
            await asyncio.sleep(0.1)
        # 所有连接收到 ready 后，统一释放编译请求。
        compile_start.set()
        deadline = time.monotonic() + args.timeout
        while completed + len(errors) < args.users and time.monotonic() < deadline:
            await asyncio.sleep(0.1)
        if completed == args.users:
            await asyncio.sleep(args.hold)
        release.set()
        pending = [task for task in tasks if not task.done()]
        if completed + len(errors) < args.users:
            errors.append(f"超时：{args.users - completed - len(errors)} 个用户未完成")
            for task in pending:
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    print(f"目标并发: {args.users}; 峰值 WebSocket 连接: {peak}; 编译前就绪: {prepared}; 完成编译/单步: {completed}; 失败: {len(errors)}")
    if send_times:
        print(f"编译请求发出时间跨度: {(max(send_times) - min(send_times)) * 1000:.1f}ms")
    if compile_latencies:
        print(f"编译并加载耗时: 平均 {statistics.mean(compile_latencies):.2f}s, P95 {percentile(compile_latencies, .95):.2f}s, 最大 {max(compile_latencies):.2f}s")
    if total_latencies:
        print(f"页面至单步耗时: 平均 {statistics.mean(total_latencies):.2f}s, P95 {percentile(total_latencies, .95):.2f}s, 最大 {max(total_latencies):.2f}s")
    for error in errors[:10]:
        print(error)
    return 0 if prepared == completed == peak == args.users and not errors else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="站点地址，如 https://rv32i.example.edu/")
    parser.add_argument("--ws-url", help="仅本机直连调试时指定独立 WebSocket 地址")
    parser.add_argument("--source-file", help="使用指定汇编源码，测试实际课程程序的编译压力")
    parser.add_argument("--users", type=int, default=100)
    parser.add_argument("--hold", type=float, default=15, help="全部用户就绪后维持连接的秒数")
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args()
    if args.users < 1 or args.hold < 0 or args.timeout <= 0:
        parser.error("用户数、维持时间及超时参数不合法")
    raise SystemExit(asyncio.run(run(args)))


if __name__ == "__main__":
    main()
