# -*- coding: utf-8 -*-
"""
probe.py —— 探测「规范未定义 / 本项目自定义」的行为，把实测结果打印出来

为什么需要它：差分测试的参照模型对**规范规定**的行为必须按规范写（这才有独立性）。
但有一批行为规范根本没管，例如：
  - 自定义 CSR 0x780（mtimecmp）读写会怎样
  - 只读 CSR（cycle/time/instret）被写会怎样
  - 非对齐访存 / 越界访存：报异常还是静默取整
  - 计时器中断到点时，当前这条指令是提交还是作废
这些只能先实测，再在参照模型里**显式写下采用哪一种**，并在注释里标 `[实测]`。
本文件就是那些实测结论的来源，随时可以重跑复核。

注意：本文件**不使用** `from enc import *`。enc 里的 r/i/s/b/u/j 是六个编码格式的
构造函数，与常见的循环变量名撞车，会把它们遮蔽掉（这个坑本文件踩过一次）。

用法: python probe.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import enc
from enc import (X, addi, lui, lw, lh, lhu, lb, lbu, sw, sh, sb, s,
                 csrrw, csrrs, csrrc, ecall, mret, fence, fence_i,
                 OP_REG, OP_IMM, OP_JALR, OP_LOAD, OP_STORE, OP_BRANCH, OP_SYSTEM,
                 OP_MISC, CSR_TIME, CSR_CYCLE, CSR_MSTATUS, CSR_MIP, CSR_MIE,
                 CSR_MTIMECMP, CSR_MTVEC, CSR_MEPC, CSR_MCAUSE, CSR_MTVAL,
                 CSR_MSCRATCH, CSR_INSTRET)
from refmodel import RefModel
from sim import Sim, write_bin, SimError

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = os.path.join(HERE, "_probe.bin")

R = X


def run(words, n):
    """跑 n 拍，返回 states 列表"""
    write_bin(words, TMP)
    with Sim(TMP) as s:
        return s.steps(n)


def title(t):
    print("\n" + "=" * 74)
    print(t)
    print("=" * 74)


# ---------------------------------------------------------------------------
# 译码 / 合法性 全组合扫描
#
# refmodel.py 头部 [C] 第 12 条写着「全 opcode×funct3×funct7 组合的扫描见 probe.py」，
# 这一节就是那次扫描。它同时是两件事的来源：
#   ① 「哪些编码非法」这张表（只读后端，与参照模型无关，是**独立**实测）；
#   ② 「译码呈现不设合法性闸门」这句话的**可执行版本** —— 不是写在注释里就算数，
#      而是逐组合去比 opcode_name/format/immediate/control_signals 四项。
#
# 为什么要扫满 funct7：对 addi/load/jalr 这些 I 型，funct7 就是立即数的高 7 位，
# 128 个取值扫的是立即数而**不是合法性**，扫了白扫。真正要扫满的只有
# 「funct7 参与判定」的两处：R 型（0x33）与移位的 0x13/funct3∈{1,5}。
# ---------------------------------------------------------------------------

def _sweep_combos():
    out = []
    for f7 in (0x00, 0x01, 0x20, 0x21, 0x7f):        # R 型：0x20 只对 sub/sra 合法
        for f3 in range(8):
            out.append((0x33, f3, f7))
    for f7 in (0x00, 0x01, 0x20, 0x3f):              # 移位：只认 0x00 / 0x20
        for f3 in range(8):
            out.append((0x13, f3, f7))
    for op in (0x37, 0x17, 0x6f, 0x67, 0x63, 0x03, 0x23, 0x0f, 0x73):
        for f7 in (0x00, 0x7f):                      # funct7 不参与判定，取两端即可
            for f3 in range(8):
                out.append((op, f3, f7))
    for op in (0x00, 0x02, 0x0b, 0x2f, 0x3b, 0x4b, 0x5b, 0x6b, 0x7b):
        for f7 in (0x00, 0x7f):                      # 压根不属于 RV32I 的 opcode
            out.append((op, 0, f7))
            out.append((op, 7, f7))
    return out


def _sweep_word(op, f3, f7):
    """rd=5 / rs1=6 / rs2=7：都非零且互不相同，免得被「x0 不写」之类的规则掩盖现象"""
    return (f7 << 25) | (7 << 20) | (6 << 15) | (f3 << 12) | (5 << 7) | op


def section_decode_sweep():
    title("X. 全 opcode×funct3×funct7 扫描：合法性表 + 译码呈现的四项逐组合比对")

    combos = _sweep_combos()
    illegal = {}          # opcode -> [(f3, f7), ...]
    by_op_f7 = {}         # opcode -> {f7: 8 个 funct3 的合法/非法}
    mismatches = []
    load_bad = 0
    n_trap = 0

    with Sim() as sim:
        for op, f3, f7 in combos:
            word = _sweep_word(op, f3, f7)
            write_bin([word], TMP)
            sim.load(TMP)                    # load_elf 会把 pc/寄存器/停机标志一并复位
            st = sim.step()["state"]

            # 守门：load 之后取到的必须是刚写进去的那条。若反复 load 没有真正复位，
            # 下面所有结论都作废 —— 这个前提本身也要被检查，不能默认成立。
            if st["instruction"] != "0x%08x" % word:
                load_bad += 1
                continue

            trap = st["trap"]["taken"]
            if trap:
                n_trap += 1
                if st["trap"]["cause"] != 2:
                    mismatches.append((word, "非法指令的 mcause 不是 2：%s"
                                       % st["trap"]["cause"], ""))
                illegal.setdefault(op, []).append((f3, f7))
            by_op_f7.setdefault(op, {}).setdefault(f7, {})[f3] = trap

            # [C]12 的可执行版本：这四项只看 opcode(+funct3/funct7)，与合法性无关。
            # 用参照模型当判据 —— 这一比是**防漂移**（两边互为镜像，不构成独立验证），
            # 真正独立的是上面那张合法性表：它只读后端，参照模型没参与。
            want = RefModel([word]).step()
            got = {"instruction_fields": st["instruction_fields"],
                   "immediate": st["immediate"],
                   "control_signals": st["control_signals"]}
            exp = {k: want[k] for k in got}
            if got != exp:
                for k in got:
                    if got[k] != exp[k]:
                        mismatches.append((word, "%s: 后端=%s 参照=%s"
                                           % (k, got[k], exp[k]), ""))

    if load_bad:
        print(f"  ⚠ {load_bad} 个组合在 load 之后取到的不是刚写进去的那条指令 ——")
        print("    说明 load_elf 没有真正复位 PC，本节结论全部不成立，先修这里。")
        return

    print(f"  共 {len(combos)} 个组合，{n_trap} 个取陷阱（全部 mcause=2）\n")
    print("  合法性表（行 = funct7，列 = funct3 0..7；`.` 合法 / `X` 非法 / `?` 本次未扫）")
    for op in sorted(by_op_f7):
        print(f"    opcode 0x{op:02x}   01234567")
        for f7 in sorted(by_op_f7[op]):
            row = "".join("?" if f3 not in by_op_f7[op][f7]
                          else ("X" if by_op_f7[op][f7][f3] else ".")
                          for f3 in range(8))
            print(f"      f7=0x{f7:02x}       {row}")
        if op not in illegal:
            print("      → 本节扫到的取值全部合法")
    print("\n  非法组合明细：")
    for op in sorted(illegal):
        pairs = ", ".join("f3=%d,f7=0x%02x" % (a, b) for a, b in illegal[op])
        print(f"    opcode 0x{op:02x}：{pairs}")

    print()
    if mismatches:
        print(f"  ⚠ 译码呈现四项有 {len(mismatches)} 处与参照模型不一致（第一个组合起列）：")
        for word, why, _ in mismatches[:10]:
            print(f"    0x{word:08x}  {why}")
        print("    → 要么参照模型的 [C]12 记错了，要么后端改了译码；两者必须对齐。")
    else:
        print("  译码呈现四项（opcode_name/format/immediate/control_signals）"
              "在**全部**组合上与参照模型一致——包括非法组合。")
        print("  即 [C]12「呈现不设合法性闸门」成立：非法与否的唯一后果是取陷阱、不提交。")


def main():
    # ---------------------------------------------------------------- A
    title("A. mtime(0xC01) 的取值规律")
    w = [csrrs(R['a0'], CSR_TIME, 0),
         csrrs(R['a1'], CSR_TIME, 0),
         csrrs(R['a2'], CSR_TIME, 0),
         csrrs(R['a3'], CSR_TIME, 0)]
    for ci, st in enumerate(run(w, 4)):
        rf = st["state"]["regfile"]
        print(f"  第{ci}拍: 读到的 mtime(a{ci})={rf[10 + ci]:>3}   "
              f"dump 里 csr.mtime={st['state']['csr']['mtime']}")

    # ---------------------------------------------------------------- B
    title("B. 写 mtime(0xC01) / 写 cycle(0xC00) 会怎样")
    w = [addi(R['t0'], R['zero'], 100),
         csrrw(R['zero'], CSR_TIME, R['t0']),
         csrrs(R['a0'], CSR_TIME, 0),
         addi(R['t1'], R['zero'], 777),
         csrrw(R['zero'], CSR_CYCLE, R['t1']),
         csrrs(R['a1'], CSR_CYCLE, 0)]
    st = run(w, 6)[-1]
    rf = st["state"]["regfile"]
    print(f"  写 mtime=100 后读回 a0={rf[10]}（若为当前计数则写被忽略）")
    print(f"  写 cycle=777 后读回 a1={rf[11]}   dump 里 csr.mtime={st['state']['csr']['mtime']}")

    # ---------------------------------------------------------------- C
    title("C. mstatus(0x300) 写 0xFFFFFFFF 后能留下哪些位")
    w = [addi(R['t0'], R['zero'], -1),
         csrrw(R['zero'], CSR_MSTATUS, R['t0']),
         csrrs(R['a0'], CSR_MSTATUS, 0)]
    st = run(w, 3)[-1]
    print(f"  读回 = 0x{st['state']['regfile'][10]:08x}   "
          f"dump 里 csr.mstatus={st['state']['csr']['mstatus']}")

    # ---------------------------------------------------------------- D
    title("D. mip(0x344) 会不会自动置 MTIP(bit7)")
    w = [addi(R['t0'], R['zero'], 3),
         csrrw(R['zero'], CSR_MTIMECMP, R['t0']),
         addi(R['a0'], R['zero'], 0),
         addi(R['a1'], R['zero'], 0),
         addi(R['a2'], R['zero'], 0),
         addi(R['a3'], R['zero'], 0)]
    for ci, st in enumerate(run(w, 6)):
        c = st["state"]["csr"]
        print(f"  第{ci}拍: mtime={c['mtime']} mtimecmp={c['mtimecmp']} "
              f"mip={c['mip']} mie={c['mie']}")

    # ---------------------------------------------------------------- E
    title("E. 非对齐访存：报异常还是静默")
    for name, ins in [("lw @+1", lw(R['a0'], R['t0'], 1)),
                      ("lh @+1", lh(R['a0'], R['t0'], 1)),
                      ("lhu @+1", lhu(R['a0'], R['t0'], 1)),
                      ("lb @+1", lb(R['a0'], R['t0'], 1)),
                      ("sw @+1", sw(R['a1'], R['t0'], 1)),
                      ("sh @+1", sh(R['a1'], R['t0'], 1))]:
        w = [lui(R['t0'], 0x80000), ins]
        st = run(w, 2)[-1]["state"]
        print(f"  {name:<8} trap={st['trap']['taken']} cause={st['trap']['cause']} "
              f"halted={st['halted']} mem.access={st['memory']['access_type']} "
              f"a0=0x{st['regfile'][10]:08x}")

    # ---------------------------------------------------------------- F
    title("F. 越界访存（0x90000000，远超 128KB 内存区间）")
    for name, ins in [("lw", lw(R['a0'], R['t0'], 0)), ("sw", sw(R['a1'], R['t0'], 0))]:
        w = [lui(R['t0'], 0x90000), ins]
        st = run(w, 2)[-1]["state"]
        print(f"  {name:<4} trap={st['trap']['taken']} cause={st['trap']['cause']} "
              f"halted={st['halted']} a0=0x{st['regfile'][10]:08x}")

    # ---------------------------------------------------------------- G
    title("G. 哪些编码被认定为非法指令（cause=2）")
    cases = [
        ("mul a0,a1,a2 (RV32M)",        enc.r(0x01, 12, 11, 0b000, 10, OP_REG)),
        ("div a0,a1,a2 (RV32M)",        enc.r(0x01, 12, 11, 0b100, 10, OP_REG)),
        ("slli 保留 funct7=1",          enc.i((1 << 5) | 3, 5, 0b001, 6, OP_IMM)),
        ("slli 保留 funct7=0x21",       enc.i((0x21 << 5) | 3, 5, 0b001, 6, OP_IMM)),
        ("srli 保留 funct7=0x21",       enc.i((0x21 << 5) | 3, 5, 0b101, 6, OP_IMM)),
        ("add 保留 funct7=0x02",        enc.r(0x02, 12, 11, 0b000, 10, OP_REG)),
        ("sub 配 f3=001",               enc.r(0x20, 12, 11, 0b001, 10, OP_REG)),
        ("jalr f3=001",                 enc.i(0, 1, 0b001, 1, OP_JALR)),
        ("lb  f3=011",                  enc.i(0, 1, 0b011, 1, OP_LOAD)),
        ("sb  f3=011",                  s(0, 12, 11, 0b011, OP_STORE)),
        ("beq f3=010",                  enc.b(0, 12, 11, 0b010, OP_BRANCH)),
        ("opcode 0001011 (custom-0)",   0x0000000B),
        ("opcode 0111111 (保留)",       0x0000007F),
        ("system f3=100",               enc.i(0, 0, 0b100, 0, OP_SYSTEM)),
        ("wfi 0x10500073",              0x10500073),
        ("sfence.vma 0x12000073",       0x12000073),
        ("csrrw 到未定义 CSR 0x7FF",    csrrw(R['a0'], 0x7FF, R['t0'])),
        ("fence f3=010 (保留)",         enc.i(0, 0, 0b010, 0, OP_MISC)),
        ("fence.i (合法)",              fence_i()),
        ("fence (合法)",                fence()),
    ]
    for name, word in cases:
        st = run([word], 1)[-1]["state"]
        verdict = ("非法" if st["trap"]["taken"] and st["trap"]["cause"] == 2
                   else "其它异常" if st["trap"]["taken"] else "合法")
        print(f"  {verdict:<5} {name:<28} cause={st['trap']['cause']} "
              f"mtval={st['trap']['mtval']} halted={int(st['halted'])} "
              f"disasm={st['disassembly']!r}")

    # ---------------------------------------------------------------- H
    title("H. mtvec==0 时 ecall → 停机兜底；停机那拍的 pc / next_pc")
    w = [addi(R['a0'], R['zero'], 1), ecall(), addi(R['a0'], R['zero'], 99)]
    for ci, st in enumerate(run(w, 4)):
        sx = st["state"]
        print(f"  第{ci}拍 pc={sx['pc']} next_pc={sx['next_pc']} halted={int(sx['halted'])} "
              f"trap={int(sx['trap']['taken'])} cause={sx['trap']['cause']} a0={sx['regfile'][10]}")

    # ---------------------------------------------------------------- I
    title("I. mtvec!=0 的异常流程：mepc/mcause/mtval、被打断指令是否写回")
    w = [lui(R['t0'], 0x80000),
         addi(R['t0'], R['t0'], 0x40),
         csrrw(R['zero'], CSR_MTVEC, R['t0']),
         addi(R['a0'], R['zero'], 5),
         ecall(),
         addi(R['a0'], R['zero'], 77)]
    while len(w) < 0x40 // 4:
        w.append(addi(R['zero'], R['zero'], 0))
    w += [csrrw(R['s0'], CSR_MEPC, R['zero']),
          csrrw(R['s1'], CSR_MCAUSE, R['zero']),
          csrrw(R['s2'], CSR_MTVAL, R['zero']),
          mret()]
    for ci, st in enumerate(run(w, 9)):
        sx = st["state"]
        print(f"  第{ci}拍 pc={sx['pc']} {sx['disassembly']:<22} "
              f"wb.active={int(sx['writeback']['active'])} "
              f"rd={sx['writeback']['reg_index']:>2} data={sx['writeback']['data']:>6} "
              f"a0={sx['regfile'][10]:>3} s0={sx['regfile'][8]:>6} "
              f"s1={sx['regfile'][9]:>3} trap={int(sx['trap']['taken'])}")

    # ---------------------------------------------------------------- J
    title("J. mret 与 mstatus.MIE/MPIE")
    w = [lui(R['t0'], 0x80000),
         addi(R['t0'], R['t0'], 0x40),
         csrrw(R['zero'], CSR_MTVEC, R['t0']),
         addi(R['t1'], R['zero'], 8),
         csrrw(R['zero'], CSR_MSTATUS, R['t1']),
         ecall(),
         addi(R['a0'], R['zero'], 77)]
    while len(w) < 0x40 // 4:
        w.append(addi(R['zero'], R['zero'], 0))
    w += [csrrw(R['s0'], CSR_MSTATUS, R['zero']),
          mret(),
          csrrw(R['s1'], CSR_MSTATUS, R['zero'])]
    for ci, st in enumerate(run(w, 12)):
        sx = st["state"]
        print(f"  第{ci}拍 pc={sx['pc']} {sx['disassembly']:<20} "
              f"mstatus={sx['csr']['mstatus']} s0=0x{sx['regfile'][8]:08x} "
              f"s1=0x{sx['regfile'][9]:08x} a0={sx['regfile'][10]}")

    # ---------------------------------------------------------------- K
    title("K. jalr 的目标地址 LSB 是否被清零")
    w = [lui(R['t0'], 0x80000),
         addi(R['t0'], R['t0'], 0x17),
         enc.jalr(R['ra'], R['t0'], 0)]
    st = run(w, 3)[-1]["state"]
    print(f"  jalr 到 0x80000017 → next_pc={st['next_pc']}（bit0=0 表示清零）")

    # ---------------------------------------------------------------- L
    title("L. CSR 写副作用规则（csrrs/csrrc 配 x0 不得写）")
    w = [addi(R['t0'], R['zero'], 1),
         csrrw(R['zero'], CSR_MSCRATCH, R['t0']),
         csrrs(R['a0'], CSR_MSCRATCH, R['zero']),
         csrrs(R['zero'], CSR_MSCRATCH, R['zero']),
         csrrw(R['a1'], CSR_MSCRATCH, R['zero']),
         csrrc(R['zero'], CSR_MSCRATCH, R['zero']),
         csrrw(R['a2'], CSR_MSCRATCH, R['zero'])]
    st = run(w, 7)[-1]
    rf = st["state"]["regfile"]
    print(f"  mscratch=1 后：csrrs 读回 a0={rf[10]}；csrrs(rd=x0) 后 a1={rf[11]}；"
          f"csrrc(rd=x0) 后 a2={rf[12]}")
    print("  （a1/a2 都还是 1 才说明「配 x0 不产生写副作用」成立）")

    # ---------------------------------------------------------------- M
    title("M. 计时器中断：mtimecmp=0 + MTIE + MIE，看哪一拍被中断、指令是否提交")
    w = [addi(R['t0'], R['zero'], 0x80),
         csrrw(R['zero'], CSR_MIE, R['t0']),
         addi(R['t1'], R['zero'], 8),
         csrrw(R['zero'], CSR_MSTATUS, R['t1']),
         csrrw(R['zero'], CSR_MTIMECMP, R['zero']),
         addi(R['a0'], R['zero'], 11),
         addi(R['a1'], R['zero'], 22),
         addi(R['a2'], R['zero'], 33)]
    for ci, st in enumerate(run(w, 8)):
        sx = st["state"]
        print(f"  第{ci}拍 pc={sx['pc']} {sx['disassembly']:<22} "
              f"trap={int(sx['trap']['taken'])} cause={sx['trap']['cause']} "
              f"halted={int(sx['halted'])} a0={sx['regfile'][10]:>3} "
              f"a1={sx['regfile'][11]:>3} a2={sx['regfile'][12]:>3} "
              f"mepc={sx['csr']['mepc']}")

    # ---------------------------------------------------------------- N
    title("N. 非法指令的 mtval/mepc；解不出指令时的 writeback/memory 字段")
    w = [lui(R['t0'], 0x80000),
         addi(R['t0'], R['t0'], 0x40),
         csrrw(R['zero'], CSR_MTVEC, R['t0']),
         enc.r(0x01, 12, 11, 0b000, 10, OP_REG),
         addi(R['a0'], R['zero'], 1)]
    while len(w) < 0x40 // 4:
        w.append(addi(R['zero'], R['zero'], 0))
    w += [csrrw(R['s0'], CSR_MEPC, R['zero']),
          csrrw(R['s1'], CSR_MCAUSE, R['zero']),
          csrrw(R['s2'], CSR_MTVAL, R['zero'])]
    for ci, st in enumerate(run(w, 8)):
        sx = st["state"]
        print(f"  第{ci}拍 pc={sx['pc']} {sx['disassembly']!r:<26} "
              f"trap={int(sx['trap']['taken'])} cause={sx['trap']['cause']} "
              f"mtval={sx['trap']['mtval']} wb.active={int(sx['writeback']['active'])} "
              f"mem={sx['memory']['access_type']}")

    # ---------------------------------------------------------------- O
    title("O. 逐 opcode 的 funct3 合法性映射（与规范对照）")
    # 规范：每个 opcode 只有列出的 funct3 合法，其余一律属于「保留」→ 非法指令。
    # 合法组合见 RISC-V Unprivileged ISA 的 opcode 表：
    #   JALR   : 000
    #   LOAD   : 000 001 010 100 101
    #   STORE  : 000 001 010
    #   BRANCH : 000 001 100 101 110 111
    #   OP-IMM : 000 010 011 100 110 111 001 101
    #   OP     : 000 001 010 011 100 101 110 111（funct7 另有限制）
    #   MISC   : 000(FENCE) 001(FENCE.I)
    #   SYSTEM : 000(ECALL/EBREAK/MRET) 001 010 011 101 110 111
    SPEC_LEGAL = {
        "JALR":   {0b000},
        "LOAD":   {0b000, 0b001, 0b010, 0b100, 0b101},
        "STORE":  {0b000, 0b001, 0b010},
        "BRANCH": {0b000, 0b001, 0b100, 0b101, 0b110, 0b111},
        "OP-IMM": {0b000, 0b001, 0b010, 0b011, 0b100, 0b101, 0b110, 0b111},
        "OP":     {0b000, 0b001, 0b010, 0b011, 0b100, 0b101, 0b110, 0b111},
        "MISC":   {0b000, 0b001},
        "SYSTEM": {0b000, 0b001, 0b010, 0b011, 0b101, 0b110, 0b111},
    }
    makers = {
        "JALR":   lambda f3: enc.i(0, 1, f3, 1, OP_JALR),
        "LOAD":   lambda f3: enc.i(0, 1, f3, 1, OP_LOAD),
        "STORE":  lambda f3: enc.s(0, 12, 11, f3, OP_STORE),
        "BRANCH": lambda f3: enc.b(0, 12, 11, f3, OP_BRANCH),
        "OP-IMM": lambda f3: enc.i(0, 5, f3, 6, OP_IMM),
        "OP":     lambda f3: enc.r(0x00, 12, 11, f3, 10, OP_REG),
        "MISC":   lambda f3: enc.i(0, 0, f3, 0, OP_MISC),
        "SYSTEM": lambda f3: enc.i(0, 0, f3, 0, OP_SYSTEM),
    }
    for cls in ("JALR", "LOAD", "STORE", "BRANCH", "OP-IMM", "OP", "MISC", "SYSTEM"):
        row = []
        for f3 in range(8):
            st = run([makers[cls](f3)], 1)[-1]["state"]
            illegal = st["trap"]["taken"] and st["trap"]["cause"] == 2
            want = f3 in SPEC_LEGAL[cls]
            mark = "  " if illegal != want else "!!"
            row.append(f"{f3}:{'非法' if illegal else '合法'}{mark}")
        print(f"  {cls:<7} " + " ".join(row))
    print("  （!! 表示与规范不符：规范说该保留、实现却当合法指令执行，或反之）")

    # ---------------------------------------------------------------- P
    title("P. ecall/ebreak 的非标准变体（rd 或 rs1 非 0）、ebreak 的 cause")
    for name, word in [("ecall 标准", ecall()),
                       ("ebreak 标准", enc.ebreak()),
                       ("ecall rd=5", enc.i(0, 0, 0b000, 5, OP_SYSTEM)),
                       ("ecall rs1=5", enc.i(0, 5, 0b000, 0, OP_SYSTEM)),
                       ("mret 标准", mret()),
                       ("mret 带 rd=5", 0x30200273)]:
        st = run([word], 1)[-1]["state"]
        print(f"  {name:<14} trap={int(st['trap']['taken'])} cause={st['trap']['cause']} "
              f"disasm={st['disassembly']!r}")

    # ---------------------------------------------------------------- Q
    title("Q. 计时器中断（mtvec != 0）：被打断的那条指令到底提交了没有")
    # handler 在 0x80000060：读 mepc 存 s0，然后把 mtimecmp 抬高再 mret
    w = [lui(R['t0'], 0x80000),
         addi(R['t0'], R['t0'], 0x60),
         csrrw(R['zero'], CSR_MTVEC, R['t0']),        # 0x80000008
         addi(R['t1'], R['zero'], 0x80),
         csrrw(R['zero'], CSR_MIE, R['t1']),          # MTIE = 1
         addi(R['t2'], R['zero'], 8),
         csrrw(R['zero'], CSR_MSTATUS, R['t2']),      # MIE = 1
         addi(R['a0'], R['zero'], 11),                # 0x8000001c 待观察
         addi(R['a1'], R['zero'], 22),
         addi(R['a2'], R['zero'], 33)]
    while len(w) < 0x60 // 4:
        w.append(addi(R['zero'], R['zero'], 0))
    w += [csrrw(R['s0'], CSR_MEPC, R['zero']),       # handler: s0 = mepc
          addi(R['t3'], R['zero'], 0x7FF),
          csrrw(R['zero'], CSR_MTIMECMP, R['t3']),   # 抬闹钟，防中断风暴
          csrrs(R['s1'], CSR_MCAUSE, R['zero']),     # s1 = mcause
          mret()]
    for ci, st in enumerate(run(w, 16)):
        sx = st["state"]
        print(f"  第{ci}拍 pc={sx['pc']} {sx['disassembly']:<24} "
              f"trap={int(sx['trap']['taken'])} cause={sx['trap']['cause']:>10} "
              f"a0={sx['regfile'][10]:>3} a1={sx['regfile'][11]:>3} "
              f"a2={sx['regfile'][12]:>3} s0={sx['csr']['mepc']}")

    # ---------------------------------------------------------------- R
    title("R. 协议里各枚举字段的**全部取值**（参照模型要逐字复现这些字符串）")
    prog = [lui(R['t0'], 0x80000),          # LUI
            enc.auipc(R['a0'], 0x1),        # AUIPC
            addi(R['a1'], R['zero'], -1),   # ADDI
            enc.slti(R['a2'], R['a1'], 5),  # SLTI
            enc.sltiu(R['a3'], R['a1'], 5), # SLTIU
            enc.xori(R['a4'], R['a1'], 5),  # XORI
            enc.ori(R['a5'], R['a1'], 5),   # ORI
            enc.andi(R['a6'], R['a1'], 5),  # ANDI
            enc.slli(R['a7'], R['a1'], 3),  # SLLI
            enc.srli(R['s2'], R['a1'], 3),  # SRLI
            enc.srai(R['s3'], R['a1'], 3),  # SRAI
            enc.add(R['s4'], R['a1'], R['a2']),
            enc.sub(R['s5'], R['a1'], R['a2']),
            enc.sll(R['s6'], R['a1'], R['a2']),
            enc.slt(R['s7'], R['a1'], R['a2']),
            enc.sltu(R['s8'], R['a1'], R['a2']),
            enc.xor(R['s9'], R['a1'], R['a2']),
            enc.srl(R['s10'], R['a1'], R['a2']),
            enc.sra(R['s11'], R['a1'], R['a2']),
            enc.or_(R['t3'], R['a1'], R['a2']),
            enc.and_(R['t4'], R['a1'], R['a2']),
            sw(R['a1'], R['t0'], 0),        # STORE
            lw(R['t5'], R['t0'], 0),        # LOAD
            lb(R['t6'], R['t0'], 0),
            lh(R['a0'], R['t0'], 0),
            lbu(R['a1'], R['t0'], 0),
            lhu(R['a2'], R['t0'], 0),
            sh(R['a1'], R['t0'], 0),
            sb(R['a1'], R['t0'], 0),
            fence(),
            fence_i(),
            enc.jal(R['ra'], 4),            # JAL
            ]
    obs = {"opcode_name": set(), "format": set(), "alu_op": set(),
           "access_type": set(), "access_size": set(), "wb_source": set(),
           "mem_to_reg_when": [], "branch": []}
    states = run(prog, len(prog))
    for ci, st in enumerate(states):
        sx = st["state"]
        f = sx["instruction_fields"]
        obs["opcode_name"].add(f["opcode_name"])
        obs["format"].add(f["format"])
        obs["alu_op"].add(sx["control_signals"]["alu_op"])
        obs["access_type"].add(sx["memory"]["access_type"])
        if sx["memory"]["access_type"] != "NONE":
            obs["access_size"].add(sx["memory"]["access_size"])
        if sx["writeback"]["active"]:
            obs["wb_source"].add(sx["writeback"]["source"])
    for k in ("opcode_name", "format", "alu_op", "access_type", "access_size", "wb_source"):
        print(f"  {k:<12} {sorted(obs[k], key=str)}")

    # 补齐 R 段漏掉的几类：BRANCH / JALR / SYSTEM，以及 B 型编码、CSR 的 wb.source
    print("  --- 逐条补测 ---")
    prog2 = [addi(R['t0'], R['zero'], 1),          # 0
             addi(R['t1'], R['zero'], 1),          # 4
             enc.beq(R['t0'], R['t1'], 8),         # 8  跳到 16
             addi(R['a0'], R['zero'], 9),          # 12 被跳过
             enc.jalr(R['ra'], R['t0'], 0),        # 16 jalr → 跳到 1（无效地址）
             csrrw(R['s0'], CSR_MSCRATCH, R['t1']),  # 20
             ecall()]                               # 24
    for ci, st in enumerate(run(prog2, 8)):
        sx = st["state"]
        f = sx["instruction_fields"]
        print(f"  第{ci}拍 pc={sx['pc']} {sx['disassembly']:<24} "
              f"opcode_name={f['opcode_name']:<9} format={f['format']} "
              f"alu_op={sx['control_signals']['alu_op']:<5} "
              f"next_pc={sx['next_pc']} taken={int(sx['branch']['taken'])} "
              f"target={sx['branch']['target_addr']} "
              f"wb={sx['writeback']['source'] if sx['writeback']['active'] else '-'}")

    # ---------------------------------------------------------------- S
    title("S. branch.taken / branch.target_addr 到底怎么定义的")
    cases = [
        ("addi（基线）",      [addi(R['a0'], R['zero'], 1)]),
        ("beq 不成立 imm=8",  [addi(R['t0'], R['zero'], 1), addi(R['t1'], R['zero'], 2),
                               enc.beq(R['t0'], R['t1'], 8)]),
        ("beq 不成立 imm=4",  [addi(R['t0'], R['zero'], 1), addi(R['t1'], R['zero'], 2),
                               enc.beq(R['t0'], R['t1'], 4)]),
        ("jal imm=4（目标=pc+4）", [enc.jal(R['ra'], 4)]),
        ("jal imm=8",         [enc.jal(R['ra'], 8), addi(R['zero'], R['zero'], 0)]),
        ("jalr 目标=pc+4",    [enc.jalr(R['ra'], R['zero'], 4)]),
        ("lui",               [lui(R['a0'], 0x12345)]),
    ]
    for name, words in cases:
        states = run(words, len(words))
        sx = states[-1]["state"]
        print(f"  {name:<22} pc={sx['pc']} next_pc={sx['next_pc']} "
              f"taken={int(sx['branch']['taken'])} target={sx['branch']['target_addr']} "
              f"branch信号={int(sx['control_signals']['branch'])} "
              f"jump={int(sx['control_signals']['jump'])} jalr={int(sx['control_signals']['is_jalr'])}")

    # ---------------------------------------------------------------- T
    title("T. 逐条指令的 ALU 操作数 / 访存 / 写回 / 控制信号（模型要逐字复现）")
    prog = [addi(R['t0'], R['zero'], -7),        # 0  OP-IMM
            lui(R['t1'], 0x12345),               # 1  LUI
            enc.auipc(R['t2'], 0x10),            # 2  AUIPC
            enc.slli(R['a0'], R['t0'], 2),       # 3
            enc.srai(R['a1'], R['t0'], 2),       # 4
            enc.add(R['a2'], R['t0'], R['t1']),  # 5
            enc.sub(R['a3'], R['t0'], R['t1']),  # 6
            enc.slt(R['a4'], R['t0'], R['t1']),  # 7
            enc.sltu(R['a5'], R['t0'], R['t1']), # 8
            enc.xor(R['a6'], R['t0'], R['t1']),  # 9
            sw(R['a2'], R['t0'], 4),             # 10 地址是 t0-7+4
            lb(R['a7'], R['zero'], 0),           # 11 读 0x80000000
            lhu(R['s2'], R['zero'], 2),          # 12
            enc.jal(R['s3'], 8),                 # 13 → 跳过下一条
            addi(R['s4'], R['zero'], 1),         # 14 被跳过
            enc.jalr(R['s5'], R['zero'], 0x20),  # 15 → 0x80000040
            ]
    while len(prog) < 0x40 // 4:
        prog.append(addi(R['zero'], R['zero'], 0))
    prog.append(csrrw(R['s6'], CSR_MSCRATCH, R['t2']))   # 0x40
    for ci, st in enumerate(run(prog, len(prog))):
        sx = st["state"]
        c = sx["control_signals"]
        a = sx["alu"]
        m = sx["memory"]
        print(f"  {sx['disassembly']:<24} op1={a['op1']:>12} op2={a['op2']:>12} "
              f"res={a['result']:>12} zf={int(a['zero'])} lt={int(a['less'])} | "
              f"cw={int(c['reg_write'])}{int(c['alu_src'])}{int(c['mem_write'])}"
              f"{int(c['mem_read'])}{int(c['mem_to_reg'])}{int(c['branch'])}"
              f"{int(c['jump'])}{int(c['is_auipc'])}{int(c['is_lui'])}{int(c['is_jalr'])} "
              f"{c['alu_op']:<5}| mem={m['access_type']:<5}/{m['access_size']} "
              f"addr={m['addr']} rd={m['read_data']} wd={m['write_data']} | "
              f"wb={sx['writeback']['source'] if sx['writeback']['active'] else '-':<10}"
              f"->x{sx['writeback']['reg_index']}=0x{sx['writeback']['data'] & 0xFFFFFFFF:x}")

    # ---------------------------------------------------------------- U
    title("U. CSR / ecall / mret / fence 的控制信号、写回来源、访存字段")
    prog = [csrrw(R['s0'], CSR_MSCRATCH, R['t0']),   # 0  csrrw 写
            csrrs(R['s1'], CSR_MSCRATCH, R['t0']),   # 1  csrrs
            csrrc(R['s2'], CSR_MSCRATCH, R['t0']),   # 2  csrrc
            enc.csrrwi(R['s3'], CSR_MSCRATCH, 3),    # 3
            enc.csrrsi(R['s4'], CSR_MSCRATCH, 3),    # 4
            enc.csrrci(R['s5'], CSR_MSCRATCH, 3),    # 5
            csrrw(R['zero'], CSR_MSCRATCH, R['t0']), # 6  rd=x0
            csrrs(R['s6'], CSR_TIME, 0),             # 7  只读计数
            csrrs(R['s7'], CSR_CYCLE, 0),            # 8
            csrrs(R['s8'], CSR_INSTRET, 0),          # 9
            fence(),                                  # 10
            fence_i(),                                # 11
            ecall(),                                  # 12
            mret()]                                   # 13
    for ci, st in enumerate(run(prog, 14)):
        sx = st["state"]
        c = sx["control_signals"]
        a = sx["alu"]
        m = sx["memory"]
        print(f"  {sx['disassembly']:<26} "
              f"cw={int(c['reg_write'])}{int(c['alu_src'])}{int(c['mem_write'])}"
              f"{int(c['mem_read'])}{int(c['mem_to_reg'])}{int(c['branch'])}"
              f"{int(c['jump'])}{int(c['is_auipc'])}{int(c['is_lui'])}{int(c['is_jalr'])} "
              f"{c['alu_op']:<5} | alu: op1={a['op1']} op2={a['op2']} res={a['result']} | "
              f"mem={m['access_type']}/{m['access_size']} | "
              f"wb={sx['writeback']['source'] if sx['writeback']['active'] else '-':<10}"
              f"->x{sx['writeback']['reg_index']}=0x{sx['writeback']['data'] & 0xFFFFFFFF:x} | "
              f"mepc={sx['csr']['mepc']} mtvec={sx['csr']['mtvec']} trap={int(sx['trap']['taken'])}")

    # ---------------------------------------------------------------- V
    title("V. mret 是否清 MPIE；trap 只改 mstatus 的 bit3/bit7 吗")
    w = [addi(R['t0'], R['zero'], -1),
         csrrw(R['zero'], CSR_MSTATUS, R['t0']),   # mstatus = 0xFFFFFFFF
         lui(R['t1'], 0x80000),
         addi(R['t1'], R['t1'], 0x30),
         csrrw(R['zero'], CSR_MTVEC, R['t1']),     # mtvec = 0x80000030
         ecall()]                                  # 第5拍
    while len(w) < 0x30 // 4:
        w.append(addi(R['zero'], R['zero'], 0))
    w += [csrrw(R['s0'], CSR_MSTATUS, R['zero']),  # handler 读 mstatus
          addi(R['t2'], R['zero'], 0),             # 顺便看 mscratch
          mret()]
    for ci, st in enumerate(run(w, 10)):
        sx = st["state"]
        print(f"  第{ci}拍 pc={sx['pc']} {sx['disassembly']:<26} "
              f"mstatus=0x{sx['csr']['mstatus']} s0=0x{sx['regfile'][8]:08x}")

    # ---------------------------------------------------------------- W
    title("W. mret 之后 MPIE(bit7) 是否被清掉")
    #  mstatus=0x08（MIE=1,MPIE=0）→ trap 后应为 0x80（MPIE←1, MIE←0）
    #  → mret 后：若 MPIE 保持，mstatus=0x88；若 MPIE 被清，mstatus=0x80
    #  handler 里用 csrrs s0, mstatus, x0 读（rs1=x0 ⇒ 不产生写副作用），
    #  这样 mret 之前 mstatus 没被人动过。
    w = [addi(R['t0'], R['zero'], 8),                # 0x00
         csrrw(R['zero'], CSR_MSTATUS, R['t0']),     # 0x04  mstatus = 8
         lui(R['t1'], 0x80000),                      # 0x08
         addi(R['t1'], R['t1'], 0x20),               # 0x0c  t1 = 0x80000020
         csrrw(R['zero'], CSR_MTVEC, R['t1']),       # 0x10  mtvec
         ecall(),                                    # 0x14  trap，mepc=0x80000014
         addi(R['zero'], R['zero'], 0),              # 0x18  被跳过
         addi(R['zero'], R['zero'], 0),              # 0x1c  被跳过
         csrrs(R['s0'], CSR_MSTATUS, 0),             # 0x20  handler：只读
         mret()]                                     # 0x24
    for ci, st in enumerate(run(w, 8)):
        sx = st["state"]
        print(f"  第{ci}拍 pc={sx['pc']} {sx['disassembly']:<26} "
              f"mstatus={sx['csr']['mstatus']} s0=0x{sx['regfile'][8]:08x} "
              f"mepc={sx['csr']['mepc']}")

    section_decode_sweep()

    os.remove(TMP)


if __name__ == "__main__":
    try:
        main()
    except SimError as e:
        print(f"[基础设施错误] {e}")
        sys.exit(2)
