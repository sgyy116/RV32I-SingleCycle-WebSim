#!/usr/bin/env python3
# ============================================================================
# _states.py —— 把一份汇编夹具跑成 cycle_state 流（JSONL）
#
# 为什么需要它：tools/out/ 被 gitignore，_hl_check.mjs / hl_preview.mjs /
# _wave_check.mjs 要读的 JSONL 不在仓库里，每次都得现生成。以前是手敲的，
# 现在固定成脚本，免得下次又忘了当初是怎么喂进去的。
#
# 用法：
#   python tools/_states.py tools/_hl_test.s  tools/out/_hl_states.jsonl
#   python tools/_states.py tools/_hl_ecall.s tools/out/_hl_ecall_states.jsonl
#
# 缺省：src=tools/_hl_test.s  out=tools/out/_hl_states.jsonl
# ============================================================================

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "backend", "python"))

import asm  # noqa: E402

# Windows 用预编译的 exe，其它平台用无后缀的
SIM = os.path.join(ROOT, "backend", "cpp", "build",
                   "rv32i_sim.exe" if os.name == "nt" else "rv32i_sim")

MAX_CYCLES = 200   # 夹具都很短，跑飞了就停，防死循环


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "_hl_test.s")
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "out", "_hl_states.jsonl")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    with open(src, encoding="utf-8") as f:
        words = asm.assemble(f.read().splitlines())
    bin_path = os.path.join(os.path.dirname(out), os.path.basename(src) + ".bin")
    with open(bin_path, "wb") as f:
        for w in words:
            f.write(w.to_bytes(4, "little"))

    proc = subprocess.Popen([SIM], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            text=True, encoding="utf-8")

    def send(obj):
        # ensure_ascii=False：C++ 那个极简 JSON 解析器不认 \uXXXX，中文路径必须原样送
        proc.stdin.write(json.dumps(obj, ensure_ascii=False) + "\n")
        proc.stdin.flush()
        return json.loads(proc.stdout.readline())

    resp = send({"cmd": "load_elf", "path": bin_path})
    assert resp.get("status") == "ok", resp

    n = 0
    with open(out, "w", encoding="utf-8") as f:
        for _ in range(MAX_CYCLES):
            st = send({"cmd": "step"})
            f.write(json.dumps(st, ensure_ascii=False) + "\n")
            n += 1
            if st.get("state", {}).get("halted"):
                break

    send({"cmd": "quit"})
    proc.wait(timeout=5)
    print(f"{src} -> {out}：{n} 个周期（{len(words)} 条指令）")


if __name__ == "__main__":
    main()
