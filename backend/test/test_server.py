#!/usr/bin/env python3
# ============================================================================
# test_server.py —— Python 中间层集成测试
#
# 启动 server.py，用零依赖的 WebSocket 客户端连接，测试:
#   hello / load(汇编) / step / run / pause / get_memory
#
# 用法: python3 test_server.py
# ============================================================================

import asyncio
import base64
import hashlib
import json
import os
import socket
import struct
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(HERE, "..", "python", "server.py")
WS_PORT = 8090
COMPILE_PORT = 8091

PASS = 0
FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [OK] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name}  {detail}")


class WSClient:
    """零依赖 WebSocket 客户端（测试用）"""

    def __init__(self, host="127.0.0.1", port=WS_PORT):
        self.sock = socket.create_connection((host, port), timeout=5)
        self._handshake()
        self._buf = b""

    def _handshake(self):
        key = base64.b64encode(b"0123456789abcdef").decode()
        req = (
            f"GET / HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{WS_PORT}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        resp = self._recv_until(b"\r\n\r\n")
        assert b"101" in resp.split(b"\r\n")[0], resp

    def _recv_until(self, marker):
        data = b""
        while marker not in data:
            chunk = self.sock.recv(4096)
            if not chunk:
                break
            data += chunk
        return data

    def _recv_exact(self, n):
        while len(self._buf) < n:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("closed")
            self._buf += chunk
        data, self._buf = self._buf[:n], self._buf[n:]
        return data

    def send(self, text: str):
        payload = text.encode()
        header = bytearray([0x81])
        ln = len(payload)
        if ln < 126:
            header.append(0x80 | ln)
        else:
            header.append(0x80 | 126)
            header += struct.pack(">H", ln)
        mask = b"\x01\x02\x03\x04"
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)

    def recv(self, timeout=5):
        self.sock.settimeout(timeout)
        hdr = self._recv_exact(2)
        opcode = hdr[0] & 0x0F
        ln = hdr[1] & 0x7F
        if ln == 126:
            ln = struct.unpack(">H", self._recv_exact(2))[0]
        elif ln == 127:
            ln = struct.unpack(">Q", self._recv_exact(8))[0]
        payload = self._recv_exact(ln)
        if opcode == 0x9:  # ping
            self.send_pong(payload)
            return self.recv(timeout)
        return payload.decode()

    def send_pong(self, payload):
        self.sock.sendall(bytes([0x8A, len(payload)]) + payload)

    def send_json(self, obj):
        self.send(json.dumps(obj))

    def recv_json(self, timeout=5):
        return json.loads(self.recv(timeout))

    def close(self):
        try:
            self.sock.close()
        except Exception:  # noqa: BLE001
            pass


def wait_for_port(port, timeout=10):
    start = time.time()
    while time.time() - start < timeout:
        try:
            s = socket.create_connection(("127.0.0.1", port), timeout=1)
            s.close()
            return True
        except OSError:
            time.sleep(0.2)
    return False


async def main():
    global PASS, FAIL

    env = dict(os.environ)
    env["WS_PORT"] = str(WS_PORT)
    env["COMPILE_PORT"] = str(COMPILE_PORT)
    proc = subprocess.Popen(
        [sys.executable, SERVER],
        env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )

    try:
        if not wait_for_port(WS_PORT):
            try:
                out, _ = proc.communicate(timeout=2)
                print("服务器输出:\n", out.decode()[-2000:])
            except Exception:  # noqa: BLE001
                pass
            print("❌ WebSocket 服务器启动失败")
            return 1

        ws = WSClient()
        print("== 测试 1: 握手与 ready ==")
        ready = ws.recv_json()
        check("收到 ready 消息", ready.get("type") == "ready", str(ready))
        check("ready 协议版本", ready.get("version") == "1.0", str(ready))

        print("== 测试 2: hello ==")
        ws.send_json({"type": "hello"})
        r = ws.recv_json()
        check("hello 响应", r.get("type") == "ready")

        print("== 测试 3: 编译 + 加载 ==")
        source = """
            addi t0, zero, 42
            addi t1, zero, 8
            add  t2, t0, t1
            addi a0, zero, 0
            ecall
        """
        ws.send_json({"type": "load", "source": source})
        r = ws.recv_json()
        check("加载成功", r.get("type") == "loaded", str(r)[:100])
        check("loaded 字段齐全",
              isinstance(r.get("entry"), str)
              and r.get("arch") == "RV32I"
              and isinstance(r.get("disassembly"), list), str(r)[:120])

        print("== 测试 4: step 与 cycle_state ==")
        ws.send_json({"type": "step"})
        r = ws.recv_json()
        st = r.get("state", {})
        check("step 返回 cycle_state", r.get("type") == "cycle_state", str(r)[:80])
        check("cycle_state 外层周期号", isinstance(r.get("cycle"), int))
        check("cycle_state 状态字段",
              all(k in st for k in ["pc", "control_signals", "branch", "csr", "trap", "regfile"]))
        check("branch.taken 为布尔值", isinstance(st.get("branch", {}).get("taken"), bool))
        # regfile 为写回后的值：第一条 addi t0, zero, 42 执行后 t0 = 42
        check("t0 = 42", st.get("regfile", [])[5] == 42, str(st.get("regfile", [])[:8]))
        check("disassembly 正确", "addi t0, zero, 42" in st.get("disassembly", ""))

        # 继续 step 直到收到 halted 事件
        halted = False
        for _ in range(10):
            ws.send_json({"type": "step"})
            while True:
                r = ws.recv_json()
                if r.get("type") == "halted":
                    halted = True
                    break
                if r.get("type") == "cycle_state" and not r.get("state", {}).get("halted"):
                    break
                if r.get("type") == "cycle_state" and r.get("state", {}).get("halted"):
                    continue  # 等待随后的 halted 事件
            if halted:
                break
        check("程序停机", halted)

        print("== 测试 5: get_memory ==")
        ws.send_json({"type": "get_memory", "addr": "0x80000000", "count": 8})
        r = ws.recv_json()
        check("内存转储", r.get("type") == "memory_dump" and len(r.get("bytes", [])) == 8, str(r)[:80])
        check("内存转储地址", r.get("addr") == "0x80000000", str(r)[:80])

        print("== 测试 6: 反汇编与控制确认消息 ==")
        ws.send_json({"type": "get_disassembly", "addr": "0x80000000", "count": 4})
        r = ws.recv_json()
        check("反汇编响应", r.get("type") == "disassembly"
              and r.get("start") == "0x80000000"
              and len(r.get("instructions", [])) == 4, str(r)[:100])

        ws.send_json({"type": "set_breakpoint", "addr": "0x80000004"})
        r = ws.recv_json()
        check("设置断点确认", r == {"type": "breakpoint_set", "addr": "0x80000004"}, str(r))

        ws.send_json({"type": "clear_breakpoint", "addr": "0x80000004"})
        r = ws.recv_json()
        check("清除断点确认", r == {"type": "breakpoint_cleared", "addr": "0x80000004"}, str(r))

        ws.send_json({"type": "reset"})
        r = ws.recv_json()
        check("复位确认", r.get("type") == "reset_done", str(r))

        ws.send_json({"type": "pause"})
        r = ws.recv_json()
        check("暂停请求确认", r.get("type") == "paused_ack", str(r))

        print("== 测试 7: run ==")
        ws.send_json({"type": "load", "source": source})
        r = ws.recv_json()
        check("重新加载", r.get("type") == "loaded", str(r)[:80])
        ws.send_json({"type": "run"})
        got_state = False
        got_halted = False
        run_cycles = []
        for _ in range(100):
            r = ws.recv_json()
            if r.get("type") == "cycle_state":
                got_state = True
                run_cycles.append(r.get("cycle"))
            if r.get("type") == "halted":
                got_halted = True
                break
        check("run 流式推送 cycle_state", got_state)
        check("run 不重复转发周期", len(run_cycles) == len(set(run_cycles)), str(run_cycles))
        check("run 收到 halted", got_halted)

        print("== 测试 8: load_elf 错误映射 ==")
        ws.send_json({"type": "load_elf", "path": os.path.join(HERE, "missing.bin")})
        r = ws.recv_json()
        check("无效路径返回 error", r.get("type") == "error" and "加载失败" in r.get("message", ""), str(r))

        ws.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()

    print(f"\n结果: {PASS} 通过, {FAIL} 失败")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
