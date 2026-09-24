# -*- coding: utf-8 -*-
"""
sim.py —— 差分测试用的 C++ 模拟器子进程驱动

与产品中间层（backend/python/cpp_bridge.py）的差别：那份是 asyncio + WebSocket 用的，
这份是同步的，给测试脚本用。协议本身相同（stdin/stdout 逐行 JSON）。

两个必须守住的点（踩过）：
  1. 只用 `step`，**不要用 `get_state`** —— main.cpp 里 get_state 内部会真的 core.step()，
     循环里用它每周期会多执行一条指令。
  2. `json.dumps(..., ensure_ascii=False)` —— C++ 侧的极简 JSON 解析器不认 \\uXXXX 转义，
     路径里有中文会挂。
"""

import json
import os
import platform
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
_EXE = ".exe" if platform.system() == "Windows" else ""
SIM = os.path.join(HERE, "..", "..", "cpp", "build", "rv32i_sim" + _EXE)


class SimError(RuntimeError):
    """基础设施错误（进程起不来、协议不响应）——与「比对失配」区分开"""


class Sim:
    def __init__(self, bin_path=None):
        if not os.path.exists(SIM):
            raise SimError(f"模拟器可执行文件不存在: {SIM}，先编译 C++ 后端")
        self.proc = subprocess.Popen(
            [SIM], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, encoding="utf-8",
        )
        if bin_path is not None:
            self.load(bin_path)

    def send(self, cmd):
        if self.proc.poll() is not None:
            raise SimError(f"模拟器已退出（returncode={self.proc.returncode}）")
        self.proc.stdin.write(json.dumps(cmd, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            err = self.proc.stderr.read() if self.proc.stderr else ""
            raise SimError(f"模拟器无响应: {err[:400]}")
        return json.loads(line)

    def load(self, bin_path):
        resp = self.send({"cmd": "load_elf", "path": os.path.abspath(bin_path)})
        if resp.get("status") != "ok":
            raise SimError(f"加载失败: {resp}")
        return resp

    def reset(self):
        return self.send({"cmd": "reset"})

    def step(self):
        """返回完整 cycle_state（含 "state" 子对象与 "cycle"）"""
        return self.send({"cmd": "step"})

    def steps(self, n):
        return [self.step() for _ in range(n)]

    def get_memory(self, addr, count=16):
        r = self.send({"cmd": "get_memory", "addr": addr if isinstance(addr, str) else hex(addr),
                       "count": count})
        return r.get("bytes", [])

    def disassemble(self, start, count):
        r = self.send({"cmd": "disassemble",
                       "start": start if isinstance(start, str) else hex(start),
                       "count": count})
        return r.get("instructions", [])

    def close(self):
        try:
            if self.proc.poll() is None:
                self.send({"cmd": "shutdown"})
                self.proc.wait(timeout=3)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def run_words(words, n_steps, tmp_path):
    """把 words 写成裸二进制、加载、step n 次，返回 (states, memory_after)

    memory_after 用 get_memory 把整块装载区读回来（语料都在 128KB 之内）。
    """
    write_bin(words, tmp_path)
    with Sim(tmp_path) as s:
        states = s.steps(n_steps)
        mem = s.get_memory(0x80000000, min(4 * len(words), 4096))
        return states, mem


def write_bin(words, path):
    with open(path, "wb") as f:
        for w in words:
            f.write((w & 0xFFFFFFFF).to_bytes(4, "little"))
    return path
