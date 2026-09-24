#!/usr/bin/env python3
# ============================================================================
# test_sim.py —— 端到端测试：汇编 → 模拟器 step → 校验寄存器/内存结果
# 用法: python3 test_sim.py
# ============================================================================

import json
import os
import platform
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_exe = ".exe" if platform.system() == "Windows" else ""
SIM = os.path.join(HERE, "..", "cpp", "build", "rv32i_sim" + _exe)

# 使用 backend/python 下的统一微型汇编器
sys.path.insert(0, os.path.join(HERE, "..", "python"))
import asm  # noqa: E402

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


def assemble(src, out):
    with open(src, encoding="utf-8") as f:
        words = asm.assemble(f.read().splitlines())
    with open(out, "wb") as f:
        for w in words:
            f.write(w.to_bytes(4, "little"))


class Sim:
    def __init__(self, bin_path):
        self.proc = subprocess.Popen([SIM], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, text=True,
                                     encoding="utf-8")
        resp = self.send({"cmd": "load_elf", "path": bin_path})
        assert resp.get("status") == "ok", resp

    def send(self, cmd):
        # ensure_ascii=False: 保留真实 UTF-8 中文路径（学长 C++ 的极简 JSON 解析器不认 \uXXXX 转义）
        self.proc.stdin.write(json.dumps(cmd, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        return json.loads(line)

    def step(self):
        return self.send({"cmd": "step"})

    def close(self):
        self.send({"cmd": "shutdown"})
        self.proc.wait(timeout=2)


def run_to_halt(sim, max_steps=200):
    states = []
    for _ in range(max_steps):
        st = sim.step()
        states.append(st)
        if st.get("state", {}).get("halted"):
            return states
    return states


def main():
    global PASS, FAIL

    if not os.path.exists(SIM):
        print("❌ 请先编译模拟器: cd backend/cpp && g++ ... （见 README）")
        sys.exit(1)

    # ---- 测试 1: 基础指令 ----
    print("== 测试 1: test_basic.s ==")
    bin1 = os.path.join(HERE, "test_basic.bin")
    assemble(os.path.join(HERE, "test_basic.s"), bin1)
    sim = Sim(bin1)
    states = run_to_halt(sim)
    sim.close()

    # 取最后一次非停机周期的状态（或停机前一条）
    last = states[-1].get("state", {})
    regs = last.get("regfile", [])

    check("停机 (halted)", last.get("halted"), str(last.get("halted")))
    check("t0 == 42", regs[5] == 42, f"t0={regs[5]}")
    check("t1 == 8", regs[6] == 8, f"t1={regs[6]}")
    check("t2 == 50 (add)", regs[7] == 50, f"t2={regs[7]}")
    check("t3 == 34 (sub)", regs[28] == 34, f"t3={regs[28]}")
    check("t4 == 42 (andi)", regs[29] == 42, f"t4={regs[29]}")
    check("t5 == 298 (ori)", regs[30] == 298, f"t5={regs[30]}")
    check("t6 == -43 (xori)", regs[31] == (2**32 - 43) % 2**32, f"t6={regs[31]}")
    check("s0 == 168 (slli)", regs[8] == 168, f"s0={regs[8]}")
    check("s1 == 84 (srli)", regs[9] == 84, f"s1={regs[9]}")
    check("s2 == 1 (slti)", regs[18] == 1, f"s2={regs[18]}")
    check("s3 == 1 (sltu)", regs[19] == 1, f"s3={regs[19]}")
    check("s4 == 0x12345000 (lui)", regs[20] == 0x12345000, f"s4={hex(regs[20])}")
    check("a1 == 50 (lw)", regs[11] == 50, f"a1={regs[11]}")
    check("a2 == 7 (jal/jalr)", regs[12] == 7, f"a2={regs[12]}")
    check("a3 == 0 (返回路径)", regs[13] == 0, f"a3={regs[13]}")
    check("a4 == 0 (退出码)", regs[14] == 0, f"a4={regs[14]}")

    # 校验 auipc 结果：s5 应为 auipc 指令自身地址
    # 找到 auipc 指令的 PC（从第一条指令偏移 12*4 = 48 = 0x30，从基址 0x80000000 起）
    # 但我们从 states 里找 disassembly 含 "auipc" 的那一拍更稳妥
    auipc_pc = None
    for st in states:
        d = st.get("state", {}).get("disassembly", "")
        if "auipc" in d:
            auipc_pc = int(st["state"]["pc"], 16)
            break
    if auipc_pc is not None:
        check("s5 == auipc PC", regs[21] == auipc_pc, f"s5={hex(regs[21])} expect={hex(auipc_pc)}")
    else:
        check("找到 auipc 指令", False, "未找到")

    # ---- 测试 2: 数据通路 JSON 结构完整性 ----
    print("== 测试 2: cycle_state JSON 结构 ==")
    bin2 = bin1
    sim2 = Sim(bin2)
    st2 = sim2.step().get("state", {})
    sim2.close()

    required_fields = ["pc", "next_pc", "instruction", "disassembly",
                       "instruction_fields", "immediate", "control_signals",
                       "reg_reads", "alu", "memory", "writeback", "branch",
                       "regfile", "halted"]
    missing = [f for f in required_fields if f not in st2]
    check("cycle_state 字段齐全", not missing, f"缺少: {missing}")

    cs = st2.get("control_signals", {})
    check("control_signals 字段齐全",
          all(k in cs for k in ["reg_write", "alu_src", "mem_write", "mem_read",
                                "mem_to_reg", "branch", "jump", "is_auipc",
                                "is_lui", "is_jalr", "alu_op"]))
    check("regfile 32 个元素", len(st2.get("regfile", [])) == 32)

    # ---- 测试 3: run 流式 + 断点 ----
    print("== 测试 3: run 命令与断点 ==")
    sim3 = Sim(bin1)
    sim3.send({"cmd": "set_breakpoint", "addr": "0x80000004"})
    # 读取 run 输出直到 breakpoint_hit 或 halted
    sim3.proc.stdin.write(json.dumps({"cmd": "run"}) + "\n")
    sim3.proc.stdin.flush()
    got_halt = False
    got_bp = False
    while True:
        line = sim3.proc.stdout.readline()
        if not line:
            break
        msg = json.loads(line)
        t = msg.get("type")
        if t == "breakpoint_hit":
            got_bp = True
            break
        if msg.get("state", {}).get("halted"):
            got_halt = True
            break
    check("run 命中断点 0x80000004", got_bp)
    sim3.close()

    print(f"\n结果: {PASS} 通过, {FAIL} 失败")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
