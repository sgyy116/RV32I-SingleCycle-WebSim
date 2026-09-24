#!/usr/bin/env python3
# ============================================================================
# test_rv32.py —— RV32I 全指令 + 中断/异常 专项测试（riscv-tests 风格）
#
# 覆盖：
#   A. 全部 RV32I 运算指令的边界情况（进位/溢出/移位掩码/符号扩展）
#   B. 全部 load/store（小端、符号扩展、非对齐、越界）
#   C. 全部分支指令 taken / not-taken；JAL/JALR 链接值；FENCE
#   D. LUI / AUIPC
#   E. CSR 指令六种 + 只读/未实现 CSR 访问异常
#   F. 异常：ecall(11) / ebreak(3) / 非法指令(2) / 非对齐取指(0) /
#          取指访问错误(1) / 非对齐读(4) / 读越界(5) / 非对齐写(6) / 写越界(7)
#   G. 中断：计时器周期中断、MIE 三道闸、mret 返回与 MIE/MPIE 恢复、
#          vectored mtvec（异常走 base、中断走 base+cause*4）、trap 期间防套嵌
#
# 用法: python test_rv32.py   （需先编译 backend/cpp/build/rv32i_sim.exe）
# ============================================================================

import json
import os
import platform
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
_exe = ".exe" if platform.system() == "Windows" else ""
SIM = os.path.join(HERE, "..", "cpp", "build", "rv32i_sim" + _exe)

sys.path.insert(0, os.path.join(HERE, "..", "python"))
import asm  # noqa: E402

PASS = 0
FAIL = 0
M32 = 0xFFFFFFFF


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [OK] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name}  {detail}")


def u32(x):
    return x & M32


class Sim:
    def __init__(self, bin_path):
        self.proc = subprocess.Popen([SIM], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, text=True,
                                     encoding="utf-8")
        resp = self.send({"cmd": "load_elf", "path": bin_path})
        assert resp.get("status") == "ok", resp

    def send(self, cmd):
        self.proc.stdin.write(json.dumps(cmd, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        return json.loads(self.proc.stdout.readline())

    def close(self):
        try:
            self.send({"cmd": "shutdown"})
            self.proc.wait(timeout=2)
        except Exception:
            self.proc.kill()


def run_program(src_lines, max_steps=4000):
    """汇编 → 加载 → step 到停机，返回 (states, sim)。"""
    words = asm.assemble(src_lines)
    fd, binpath = tempfile.mkstemp(suffix=".bin")
    with os.fdopen(fd, "wb") as f:
        for w in words:
            f.write(w.to_bytes(4, "little"))
    sim = Sim(binpath)
    states = []
    for _ in range(max_steps):
        st = sim.send({"cmd": "step"})
        states.append(st)
        if st.get("state", {}).get("halted"):
            break
    return states, sim


def last_state(states):
    return states[-1]["state"]


def regs_of(states):
    return last_state(states).get("regfile", [])


def trap_states(states):
    return [s["state"] for s in states if s["state"].get("trap", {}).get("taken")]


def handled_traps(states):
    """排除末次停机 ecall 触发的 trap（mtvec=0 → halted），只统计被处理过的 trap"""
    return [t for t in trap_states(states) if not t.get("halted")]


# ---------------------------------------------------------------------------
# 测试程序
# ---------------------------------------------------------------------------

TEST_ARITH = """\
    addi  t0, zero, -1          # t0 = 0xFFFFFFFF
    addi  t1, zero, 33
    add   t2, t0, t1            # 回绕: 32
    sub   t3, zero, t0          # 1
    sll   t4, t0, t1            # 移位量 33&31=1 → 0xFFFFFFFE
    srl   t5, t0, t1            # 0x7FFFFFFF
    sra   t6, t0, t1            # 0xFFFFFFFF
    slt   s0, zero, t0          # 0 < -1 → 0
    slt   s1, t1, t0            # 33 < -1 → 0
    sltu  s2, t1, t0            # 33 < 0xFFFFFFFF → 1
    xor   s3, t0, t1            # 0xFFFFFFDE
    or    s4, zero, t0          # 0xFFFFFFFF
    and   s5, t0, t1            # 33
    xori  s6, t1, -1            # ~33 = 0xFFFFFFDE
    sltiu s7, zero, -1          # 0 < 0xFFFFFFFF → 1
    slti  s8, zero, -1          # 0 < -1 → 0
    slti  s9, t1, 33            # 0
    slti  s10, t1, 34           # 1
    andi  s11, t0, 0            # 0
    ecall
"""

TEST_SHIFT_LUI = """\
    addi  t0, zero, -256        # 0xFFFFFF00
    slli  t1, t0, 4             # 0xFFFFF000
    srli  t2, t0, 4             # 0x0FFFFFF0
    srai  t3, t0, 4             # 0xFFFFFFF0
    lui   t4, 0x80000           # 0x80000000
    lui   t5, 0xFFFFF           # 0xFFFFF000
    srai  t6, t5, 8             # 0xFFFFFFF0
    addi  a0, t5, -2048         # 0xFFFFE800
    ori   a1, zero, 0x7FF       # 0x7FF
    auipc a2, 0                 # a2 = 本指令地址 = base + 10*4
    ecall
"""

TEST_MEM = """\
    la    t0, data
    lui   t1, 0x1
    addi  t1, t1, 0x234    # t1 = 0x1234（addi 立即数只有 12 位）
    addi  t2, zero, -5
    lui   t3, 0xDEADC
    addi  t3, t3, -273          # 0xDEADBEEF
    sw    t3, 0(t0)
    sw    t1, 4(t0)
    sb    t2, 8(t0)
    sh    t1, 10(t0)
    lw    a0, 0(t0)             # 0xDEADBEEF
    lb    a1, 0(t0)             # 0xFFFFFFEF
    lbu   a2, 0(t0)             # 0xEF
    lh    a3, 0(t0)             # 0xFFFFBEEF
    lhu   a4, 0(t0)             # 0xBEEF
    lb    a5, 8(t0)             # 0xFFFFFFFB (-5)
    lbu   a6, 8(t0)             # 0xFB
    lh    a7, 10(t0)            # 0x1234
    lw    s0, 4(t0)             # 0x1234
    lb    s1, 4(t0)             # 0x34
    ecall
data:
    .word 0
    .word 0
    .word 0
"""

TEST_BRANCH = """\
    addi  t0, zero, 5
    addi  t1, zero, -5
    beq   t0, t0, L1
    addi  a0, zero, 99
L1:
bne   t0, t1, L2
    addi  a0, zero, 99
L2:
blt   t1, t0, L3
    addi  a0, zero, 99
L3:
bge   t0, t1, L4
    addi  a0, zero, 99
L4:
bltu  t0, t1, L5
    addi  a0, zero, 99
L5:
bgeu  t1, t0, L6
    addi  a0, zero, 99
L6:
bltu  t1, t1, BAD           # 相等 → 不跳
    beq   t0, t1, BAD           # 不等 → 不跳
    j     OK
BAD:
    addi  a0, zero, 99
OK:
    addi  a0, a0, 1             # a0 = 1
    ecall
"""

TEST_JAL = """\
    la    t0, sub1
    jal   ra, sub1              # ra = jal地址+4
    j     fin
sub1:
    addi  a0, zero, 7
    la    t1, fin
    jalr  t2, t1, 0             # t2 = jalr地址+4
    addi  a0, zero, 99          # 不可达
fin:
    fence                       # 顺序执行, 无副作用
    ecall
"""

TEST_CSR = """\
    addi  t0, zero, 255
    csrrw t1, mscratch, t0      # t1 = 0, mscratch = 255
    csrrs t2, mscratch, zero    # t2 = 255, 不写
    addi  t3, zero, 240
    csrrc t4, mscratch, t3      # t4 = 255, mscratch = 15
    csrrsi t5, mscratch, 1      # t5 = 15, mscratch = 31
    csrrci t6, mscratch, 3      # t6 = 31, mscratch = 28
    csrrwi a0, mscratch, 31     # a0 = 28, mscratch = 31
    csrrs a3, mscratch, zero    # a3 = 31
    csrrs a1, time, zero        # 只读计数器读取
    csrrs a2, cycle, zero
    csrrs a4, instret, zero
    ecall
"""

TEST_ECALL_TRAP = """\
    la    t0, handler
    csrrw zero, mtvec, t0
    csrrsi zero, mstatus, 8     # 开总闸 MIE（测 mret 恢复 MIE/MPIE）
    addi  a0, zero, 1
    ecall                       # mcause=11
    csrrs s0, mstatus, zero     # mret 后: MIE=1, MPIE=1
    csrrs s1, mcause, zero      # 11
    addi  a1, zero, 99
    csrrw zero, mtvec, zero
    ecall
handler:
    addi  a0, a0, 1
    csrrs t1, mcause, zero
    csrrs t2, mepc, zero
    addi  t2, t2, 4
    csrrw zero, mepc, t2
    mret
"""

TEST_EBREAK = """\
    la    t0, handler
    csrrw zero, mtvec, t0
    ebreak                      # mcause=3
    addi  a0, zero, 5
    csrrw zero, mtvec, zero
    ecall
handler:
    csrrs t1, mcause, zero
    csrrs t2, mepc, zero
    addi  t2, t2, 4
    csrrw zero, mepc, t2
    mret
"""

TEST_ILLEGAL = """\
    la    t0, handler
    csrrw zero, mtvec, t0
    .word 0xFFFFFFFF            # 非法指令 → mcause=2, mtval=0xFFFFFFFF
    addi  a0, zero, 5
    csrrw zero, mtvec, zero
    ecall
handler:
    csrrs t1, mcause, zero
    csrrs t2, mtval, zero
    csrrs t3, mepc, zero
    addi  t3, t3, 4
    csrrw zero, mepc, t3
    mret
"""

TEST_CSR_FAULT = """\
    la    t0, handler
    csrrw zero, mtvec, t0
    csrrs t3, 0x7FF, zero       # 未实现 CSR → trap 2（且 t3 不写入）
    csrrw zero, time, zero      # 写只读计数器 → trap 2
    csrrs t4, time, zero        # 读只读 → 不 trap
    csrrs t5, mscratch, zero    # 正常
    csrrw zero, mtvec, zero
    ecall
handler:
    addi  s2, s2, 1
    csrrs s0, mcause, zero
    csrrs s1, mtval, zero
    csrrs t6, mepc, zero
    addi  t6, t6, 4
    csrrw zero, mepc, t6
    mret
"""

TEST_MISALIGN_LOAD = """\
    la    t0, data
    la    s3, handler
    csrrw zero, mtvec, s3
    addi  t0, t0, 2
    lw    t1, 0(t0)             # 非对齐 → trap 4, t1 不写入
    j     fin
handler:
    addi  s2, s2, 1
    csrrs s0, mcause, zero
    csrrs s1, mtval, zero
    csrrs t5, mepc, zero
    addi  t5, t5, 4
    csrrw zero, mepc, t5
    mret
fin:
    csrrw zero, mtvec, zero
    ecall
data:
    .word 0x11223344
"""

TEST_MISALIGN_STORE = """\
    la    t0, data
    la    s3, handler
    csrrw zero, mtvec, s3
    addi  t0, t0, 2
    addi  t1, zero, 0x55
    sw    t1, 0(t0)             # 非对齐写 → trap 6, 内存不写
    j     fin
handler:
    addi  s2, s2, 1
    csrrs s0, mcause, zero
    csrrs s1, mtval, zero
    csrrs t5, mepc, zero
    addi  t5, t5, 4
    csrrw zero, mepc, t5
    mret
fin:
    csrrw zero, mtvec, zero
    ecall
data:
    .word 0
"""

TEST_ACCESS_FAULT = """\
    lui   t0, 0x90000           # 内存窗口之外
    la    t1, handler
    csrrw zero, mtvec, t1
    lw    t2, 0(t0)             # 读越界 → trap 5
    sw    t2, 0(t0)             # 写越界 → trap 7
    csrrw zero, mtvec, zero
    ecall
handler:
    addi  s2, s2, 1
    csrrs s0, mcause, zero
    csrrs s1, mtval, zero
    csrrs t5, mepc, zero
    addi  t5, t5, 4
    csrrw zero, mepc, t5
    mret
"""

TEST_MISALIGN_JUMP = """\
    la    t0, data
    la    s3, handler
    csrrw zero, mtvec, s3
    addi  t0, t0, 2             # 非对齐目标（&~1 后仍 mod4=2）
    jalr  a0, t0, 0             # → trap 0, a0 不写入
    j     fin
handler:
    addi  s2, s2, 1
    csrrs s0, mcause, zero
    csrrs s1, mtval, zero
    csrrs t5, mepc, zero
    addi  t5, t5, 4
    csrrw zero, mepc, t5
    mret
fin:
    csrrw zero, mtvec, zero
    ecall
data:
    .word 0
"""

TEST_FETCH_FAULT = """\
    la    t1, handler
    csrrw zero, mtvec, t1
    la    t2, after
    csrrw zero, mscratch, t2    # 预存返回地址（mepc=坏地址，无法 +4）
    lui   t0, 0x90000
    jalr  zero, t0, 0           # 取指越界 → trap 1
after:
    addi  a0, zero, 5
    csrrw zero, mtvec, zero
    ecall
handler:
    addi  s2, s2, 1
    csrrs s0, mcause, zero
    csrrs s1, mtval, zero
    csrrs t5, mscratch, zero
    csrrw zero, mepc, t5        # 跳回 after
    mret
"""

TEST_TIMER = """\
# 计时器中断：闹钟 20 周期，handler 推迟闹钟；主程序等 t3==3 后关中断停机
    la    t0, handler
    csrrw zero, mtvec, t0
    addi  t0, zero, 20
    csrrw zero, mtimecmp, t0
    addi  s0, zero, 128
    csrrs zero, mie, s0         # MTIE
    addi  t3, zero, 0
    addi  s1, zero, 3
    csrrsi zero, mstatus, 8     # MIE
spin:
    beq   t3, s1, done
    j     spin
done:
    csrrci zero, mstatus, 8     # 关总闸（防再入）
    csrrc zero, mie, s0         # 关 MTIE
    addi  a1, t3, 0             # a1 = 3
    csrrw zero, mtvec, zero
    ecall
handler:
    addi  t3, t3, 1
    csrrs t0, time, zero
    addi  t0, t0, 20
    csrrw zero, mtimecmp, t0
    mret
"""

TEST_MIE_GATE = """\
# MTIE 开、MIE 关 → 计时器到点也不得打断；开总闸后立刻打断一次
    la    t0, handler
    csrrw zero, mtvec, t0
    addi  t0, zero, 5
    csrrw zero, mtimecmp, t0
    addi  s0, zero, 128
    csrrs zero, mie, s0         # 只开 MTIE
    addi  t1, zero, 30
spin1:
    addi  t1, t1, -1
    bne   t1, zero, spin1       # 期间 MIE=0 → t3 必须仍为 0
    csrrsi zero, mstatus, 8     # 开总闸 → 应立即打断
    addi  t2, zero, 20
spin2:
    addi  t2, t2, -1
    bne   t2, zero, spin2
    csrrci zero, mstatus, 8     # 关总闸
    csrrc zero, mie, s0
    addi  a0, t3, 0             # a0 = 1
    csrrw zero, mtvec, zero
    ecall
handler:
    addi  t3, t3, 1
    csrrs t0, time, zero
    addi  t0, t0, 1000          # 推得很远，保证只打断一次
    csrrw zero, mtimecmp, t0
    mret
"""

TEST_VECTORED = """\
# vectored mtvec：异常走 base，中断走 base + cause*4（timer=7 → base+28）
    la    t0, vec_base
    ori   t0, t0, 1            # mode = vectored
    csrrw zero, mtvec, t0
    addi  t0, zero, 20
    csrrw zero, mtimecmp, t0
    addi  s0, zero, 128
    csrrs zero, mie, s0
    addi  t3, zero, 0
    addi  s1, zero, 3
    csrrsi zero, mstatus, 8
spin:
    beq   t3, s1, done
    j     spin
done:
    csrrci zero, mstatus, 8
    ecall                       # 异常 → base → exc_handler
    csrrw zero, mtvec, zero
    ecall
vec_base:
    j     exc_handler           # base
    .word 0                      # +4
    .word 0                      # +8
    .word 0                      # +12
    .word 0                      # +16
    .word 0                      # +20
    .word 0                      # +24
    j     int_handler           # +28 = base + 7*4
exc_handler:
    addi  s2, s2, 1
    csrrs t5, mepc, zero
    addi  t5, t5, 4
    csrrw zero, mepc, t5
    mret
int_handler:
    addi  t3, t3, 1
    csrrs t0, time, zero
    addi  t0, t0, 100
    csrrw zero, mtimecmp, t0
    mret
"""


# ---------------------------------------------------------------------------
# 用例
# ---------------------------------------------------------------------------

def t_arith():
    print("== A. 算术/逻辑指令边界 ==")
    states, sim = run_program(TEST_ARITH.splitlines())
    sim.close()
    r = regs_of(states)
    # ABI: t0=5 t1=6 t2=7 t3=28 t4=29 t5=30 t6=31 s0=8 s1=9 s2=19 s3=20 s4=21
    #      s5=22 s6=23 s7=24 s8=25 s9=26 s10=27 s11=18
    check("add 回绕 t2=32", r[7] == 32, f"t2={r[7]}")
    check("sub t3=1", r[28] == 1, f"t3={r[28]}")
    check("sll 掩码 t4=0xFFFFFFFE", r[29] == 0xFFFFFFFE, hex(r[29]))
    check("srl t5=0x7FFFFFFF", r[30] == 0x7FFFFFFF, hex(r[30]))
    check("sra t6=0xFFFFFFFF", r[31] == M32, hex(r[31]))
    check("slt s0=0", r[8] == 0, f"s0={r[8]}")
    check("slt s1=0", r[9] == 0, f"s1={r[9]}")
    check("sltu s2=1", r[18] == 1, f"s2={r[18]}")
    check("xor s3=0xFFFFFFDE", r[19] == 0xFFFFFFDE, hex(r[19]))
    check("or s4=0xFFFFFFFF", r[20] == M32, hex(r[20]))
    check("and s5=33", r[21] == 33, f"s5={r[21]}")
    check("xori s6=0xFFFFFFDE", r[22] == 0xFFFFFFDE, hex(r[22]))
    check("sltiu s7=1", r[23] == 1, f"s7={r[23]}")
    check("slti s8=0", r[24] == 0, f"s8={r[24]}")
    check("slti s9=0", r[25] == 0, f"s9={r[25]}")
    check("slti s10=1", r[26] == 1, f"s10={r[26]}")
    check("andi s11=0", r[27] == 0, f"s11={r[27]}")


def t_shift_lui():
    print("== B. 移位立即数/LUI/AUIPC ==")
    states, sim = run_program(TEST_SHIFT_LUI.splitlines())
    sim.close()
    r = regs_of(states)
    check("slli t1=0xFFFFF000", r[6] == 0xFFFFF000, hex(r[6]))
    check("srli t2=0x0FFFFFF0", r[7] == 0x0FFFFFF0, hex(r[7]))
    check("srai t3=0xFFFFFFF0", r[28] == 0xFFFFFFF0, hex(r[28]))
    check("lui t4=0x80000000", r[29] == 0x80000000, hex(r[29]))
    check("lui t5=0xFFFFF000", r[30] == 0xFFFFF000, hex(r[30]))
    check("srai t6=0xFFFFFFF0", r[31] == 0xFFFFFFF0, hex(r[31]))
    check("addi a0=0xFFFFE800", r[10] == 0xFFFFE800, hex(r[10]))
    check("ori a1=0x7FF", r[11] == 0x7FF, hex(r[11]))
    auipc_pc = 0x80000000 + 9 * 4
    check("auipc a2=自身PC", r[12] == auipc_pc, hex(r[12]))


def t_mem():
    print("== C. load/store 与小端/符号扩展 ==")
    states, sim = run_program(TEST_MEM.splitlines())
    r = regs_of(states)
    data_addr = 0x80000000 + 22 * 4   # la2+lui2+addi2+lui2+4store+10load+ecall = 22 条
    dump = sim.send({"cmd": "get_memory", "addr": hex(data_addr), "count": 12})
    sim.close()
    check("lw a0=0xDEADBEEF", r[10] == 0xDEADBEEF, hex(r[10]))
    check("lb a1=0xFFFFFFEF", r[11] == 0xFFFFFFEF, hex(r[11]))
    check("lbu a2=0xEF", r[12] == 0xEF, hex(r[12]))
    check("lh a3=0xFFFFBEEF", r[13] == 0xFFFFBEEF, hex(r[13]))
    check("lhu a4=0xBEEF", r[14] == 0xBEEF, hex(r[14]))
    check("lb a5=-5", r[15] == u32(-5), hex(r[15]))
    check("lbu a6=0xFB", r[16] == 0xFB, hex(r[16]))
    check("lh a7=0x1234", r[17] == 0x1234, hex(r[17]))
    check("lw s0=0x1234", r[8] == 0x1234, hex(r[8]))
    check("lb s1=0x34", r[9] == 0x34, hex(r[9]))
    b = dump["bytes"]
    check("小端字节序 EF BE AD DE",
          b[0] == 0xEF and b[1] == 0xBE and b[2] == 0xAD and b[3] == 0xDE,
          str(b[:4]))


def t_branch():
    print("== D. 分支 taken/not-taken ==")
    states, sim = run_program(TEST_BRANCH.splitlines())
    sim.close()
    r = regs_of(states)
    check("a0=1（全部按预期跳/不跳）", r[10] == 1, f"a0={r[10]}")


def t_jal():
    print("== E. JAL/JALR/FENCE ==")
    states, sim = run_program(TEST_JAL.splitlines())
    sim.close()
    r = regs_of(states)
    jal_pc = None
    jalr_pc = None
    for s in (x["state"] for x in states):
        if s["disassembly"].startswith("jal ") and jal_pc is None:
            jal_pc = int(s["pc"], 16)
        if s["disassembly"].startswith("jalr") and jalr_pc is None:
            jalr_pc = int(s["pc"], 16)
    check("a0=7", r[10] == 7, f"a0={r[10]}")
    check("ra=jal+4", r[1] == jal_pc + 4, f"ra={hex(r[1])} jal={hex(jal_pc)}")
    check("t2=jalr+4", r[7] == jalr_pc + 4, f"t2={hex(r[7])} jalr={hex(jalr_pc)}")


def t_csr():
    print("== F. CSR 六种指令 ==")
    states, sim = run_program(TEST_CSR.splitlines())
    sim.close()
    r = regs_of(states)
    check("csrrw 旧值 t1=0", r[6] == 0, f"t1={r[6]}")
    check("csrrs 读 t2=255", r[7] == 255, f"t2={r[7]}")
    check("csrrc 旧值 t4=255", r[29] == 255, f"t4={r[29]}")
    check("csrrsi 旧值 t5=15", r[30] == 15, f"t5={r[30]}")
    check("csrrci 旧值 t6=15", r[31] == 15, f"t6={r[31]}")
    check("csrrwi 旧值 a0=12", r[10] == 12, f"a0={r[10]}")
    check("mscratch 终值 a3=31", r[13] == 31, f"a3={r[13]}")
    check("time 只读可读 a1>0", r[11] > 0, f"a1={r[11]}")
    check("cycle 可读 a2>0", r[12] > 0, f"a2={r[12]}")
    check("instret 可读 a4>0", r[14] > 0, f"a4={r[14]}")


def t_ecall_trap():
    print("== G1. ecall trap 往返 ==")
    states, sim = run_program(TEST_ECALL_TRAP.splitlines())
    sim.close()
    r = regs_of(states)
    last = last_state(states)
    ts = trap_states(states)
    check("a0=2", r[10] == 2, f"a0={r[10]}")
    check("a1=99（mret 恢复执行）", r[11] == 99, f"a1={r[11]}")
    check("handler 里 mcause=11", r[6] == 11, f"t1={r[6]}")
    check("mcause 快照=11", int(last["csr"]["mcause"], 16) == 11,
          last["csr"]["mcause"])
    check("s0 读回 mstatus MIE=1", (r[8] >> 3) & 1 == 1, hex(r[8]))
    check("s0 读回 MPIE=1", (r[8] >> 7) & 1 == 1, hex(r[8]))
    check("s1=11", r[9] == 11, f"s1={r[9]}")
    check("处理过的 trap 1 次", len(handled_traps(states)) == 1, f"{len(ts)}")
    # ecall 是第 6 条指令（la 展开为 2 条）→ pc = base+20；handler 中 t2 = mepc+4
    check("handler 中 t2=mepc+4", r[7] == 0x80000014 + 4, hex(r[7]))
    check("trap.mepc=ecall 地址", int(ts[0]["trap"]["mepc"], 16) == 0x80000014,
          ts[0]["trap"]["mepc"])
    last = last_state(states)
    check("停机 ecall 后 MIE=0（trap 关总闸）",
          (int(last["csr"]["mstatus"], 16) >> 3) & 1 == 0, last["csr"]["mstatus"])


def t_ebreak():
    print("== G2. ebreak 断点异常 ==")
    states, sim = run_program(TEST_EBREAK.splitlines())
    sim.close()
    r = regs_of(states)
    ts = trap_states(states)
    check("mcause=3", r[6] == 3, f"t1={r[6]}")
    check("a0=5（跳过后继续）", r[10] == 5, f"a0={r[10]}")
    check("处理过的 trap 1 次", len(handled_traps(states)) == 1, len(ts))


def t_illegal():
    print("== G3. 非法指令异常 ==")
    states, sim = run_program(TEST_ILLEGAL.splitlines())
    sim.close()
    r = regs_of(states)
    ts = trap_states(states)
    check("mcause=2", r[6] == 2, f"t1={r[6]}")
    check("mtval=0xFFFFFFFF", r[7] == M32, hex(r[7]))
    check("a0=5（跳过非法指令继续）", r[10] == 5, f"a0={r[10]}")
    check("处理过的 trap 1 次", len(handled_traps(states)) == 1, len(ts))


def t_csr_fault():
    print("== G4. CSR 访问异常 ==")
    states, sim = run_program(TEST_CSR_FAULT.splitlines())
    sim.close()
    r = regs_of(states)
    ts = trap_states(states)
    check("处理过的 trap 2 次", len(handled_traps(states)) == 2, len(ts))
    check("mcause=2（未实现 CSR）", r[8] == 2, f"s0={r[8]}")
    # s1 是第二次 trap 的 mtval = csrrw zero, time, zero 的机器码
    check("mtval=csrrw 机器码", r[9] == (0xC01 << 20) | (1 << 12) | 0x73, hex(r[9]))
    check("第一次 trap mtval=csrrs 机器码",
          int(ts[0]["trap"]["mtval"], 16) == (0x7FF << 20) | (2 << 12) | (28 << 7) | 0x73,
          ts[0]["trap"]["mtval"])
    check("t3 未被写入（trap 无副作用）", r[28] == 0, f"t3={r[28]}")
    check("读只读 time 不 trap", r[29] > 0, f"t4={r[29]}")  # t4=x29
    check("正常 CSR 读 t5", r[30] == 0, f"t5={r[30]}")


def t_misalign_load():
    print("== G5. 非对齐读（cause 4） ==")
    states, sim = run_program(TEST_MISALIGN_LOAD.splitlines())
    sim.close()
    r = regs_of(states)
    ts = trap_states(states)
    data_addr = 0x80000000 + 17 * 4   # la4+csrrw+addi+lw+j+handler7+fin2 → data
    check("处理过的 trap 1 次", len(handled_traps(states)) == 1, len(ts))
    check("s2=1", r[18] == 1, f"s2={r[18]}")
    check("mcause=4", r[8] == 4, f"s0={r[8]}")
    check("mtval=data+2", r[9] == data_addr + 2, hex(r[9]))
    check("t1 未写入", r[6] == 0, f"t1={r[6]}")


def t_misalign_store():
    print("== G6. 非对齐写（cause 6） ==")
    states, sim = run_program(TEST_MISALIGN_STORE.splitlines())
    r = regs_of(states)
    dump = sim.send({"cmd": "get_memory", "addr": hex(0x80000000 + 18 * 4), "count": 4})
    sim.close()
    ts = trap_states(states)
    check("处理过的 trap 1 次", len(handled_traps(states)) == 1, len(ts))
    check("s2=1", r[18] == 1, f"s2={r[18]}")
    check("mcause=6", r[8] == 6, f"s0={r[8]}")
    check("内存未被写入", dump["bytes"] == [0, 0, 0, 0], str(dump["bytes"]))


def t_access_fault():
    print("== G7. 访存越界（cause 5/7） ==")
    states, sim = run_program(TEST_ACCESS_FAULT.splitlines())
    sim.close()
    r = regs_of(states)
    ts = trap_states(states)
    causes = [t["trap"]["cause"] for t in ts]
    check("处理过的 trap 2 次", len(handled_traps(states)) == 2, str(causes))
    its = handled_traps(states)
    check("读越界 cause=5", [t["trap"]["cause"] for t in its][:1] == [5], str(causes))
    check("写越界 cause=7", [t["trap"]["cause"] for t in its][1:2] == [7], str(causes))
    check("mtval=0x90000000", r[9] == 0x90000000, hex(r[9]))


def t_misalign_jump():
    print("== G8. 非对齐跳转目标（cause 0） ==")
    states, sim = run_program(TEST_MISALIGN_JUMP.splitlines())
    sim.close()
    r = regs_of(states)
    ts = trap_states(states)
    data_addr = 0x80000000 + 17 * 4
    check("处理过的 trap 1 次", len(handled_traps(states)) == 1, len(ts))
    check("s2=1", r[18] == 1, f"s2={r[18]}")
    check("mcause=0", r[8] == 0, f"s0={r[8]}")
    check("mtval=data+2", r[9] == data_addr + 2, hex(r[9]))
    check("a0 未写入（trap 无副作用）", r[10] == 0, f"a0={r[10]}")


def t_fetch_fault():
    print("== G9. 取指越界（cause 1） ==")
    states, sim = run_program(TEST_FETCH_FAULT.splitlines())
    sim.close()
    r = regs_of(states)
    ts = trap_states(states)
    check("处理过的 trap 1 次", len(handled_traps(states)) == 1, len(ts))
    check("mcause=1", r[8] == 1, f"s0={r[8]}")
    check("mtval=0x90000000", r[9] == 0x90000000, hex(r[9]))
    check("s2=1", r[18] == 1, f"s2={r[18]}")
    check("a0=5（返回后继续）", r[10] == 5, f"a0={r[10]}")


def t_timer():
    print("== H1. 计时器周期中断 ==")
    states, sim = run_program(TEST_TIMER.splitlines(), max_steps=8000)
    sim.close()
    r = regs_of(states)
    ts = trap_states(states)
    check("a1=3（恰好 3 次中断）", r[11] == 3, f"a1={r[11]}")
    its = handled_traps(states)
    check("处理过的 trap 3 次", len(its) == 3, len(its))
    check("全部为计时器中断(0x80000007)",
          all(t["trap"]["cause"] == 0x80000007 for t in its), "")
    check("中断时 mepc=被打断的 PC",
          all(int(t["trap"]["mepc"], 16) == int(t["pc"], 16) for t in its), "")
    last = last_state(states)
    check("最终 MIE=0（主程序已关闸）",
          (int(last["csr"]["mstatus"], 16) >> 3) & 1 == 0, last["csr"]["mstatus"])


def t_mie_gate():
    print("== H2. MIE 三道闸 ==")
    states, sim = run_program(TEST_MIE_GATE.splitlines(), max_steps=8000)
    sim.close()
    r = regs_of(states)
    ts = trap_states(states)
    check("恰好 1 次中断", len(handled_traps(states)) == 1, len(ts))
    check("a0=1", r[10] == 1, f"a0={r[10]}")


def t_vectored():
    print("== H3. vectored mtvec 路由 ==")
    states, sim = run_program(TEST_VECTORED.splitlines(), max_steps=8000)
    sim.close()
    r = regs_of(states)
    ts = trap_states(states)
    int_traps = [t for t in ts if t["trap"]["cause"] == 0x80000007]
    exc_traps = [t for t in ts if t["trap"]["cause"] == 11]
    check("计时器中断 3 次", len(int_traps) == 3, len(int_traps))
    check("ecall 异常 2 次（含末次停机）", len(exc_traps) == 2, len(exc_traps))
    check("s2=1（异常走 base 的 exc_handler）", r[18] == 1, f"s2={r[18]}")
    check("t3=3（中断走 base+28 的 int_handler）", r[28] == 3, f"t3={r[28]}")


def t_reset_keeps_program():
    print("== I. 复位保留程序（复位后可直接继续执行） ==")
    states, sim = run_program(TEST_ARITH.splitlines())
    sim.send({"cmd": "reset"})
    st = sim.send({"cmd": "step"})
    r = st["state"].get("regfile", [])
    check("复位后 PC=入口且指令可执行",
          st["state"]["pc"] == "0x80000000" and not st["state"].get("halted"),
          f"pc={st['state']['pc']} halted={st['state'].get('halted')}")
    # 复位后跑完整程序应得到与首次一致的结果
    while True:
        st = sim.send({"cmd": "step"})
        if st["state"].get("halted"):
            break
    r2 = st["state"]["regfile"]
    check("复位后重跑 t2=32（结果一致）", r2[7] == 32, f"t2={r2[7]}")
    sim.close()


def main():
    global PASS, FAIL
    if not os.path.exists(SIM):
        print("❌ 请先编译模拟器（见 README）")
        return 1

    t_arith()
    t_shift_lui()
    t_mem()
    t_branch()
    t_jal()
    t_csr()
    t_ecall_trap()
    t_ebreak()
    t_illegal()
    t_csr_fault()
    t_misalign_load()
    t_misalign_store()
    t_access_fault()
    t_misalign_jump()
    t_fetch_fault()
    t_timer()
    t_mie_gate()
    t_vectored()
    t_reset_keeps_program()

    print(f"\n结果: {PASS} 通过, {FAIL} 失败")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
