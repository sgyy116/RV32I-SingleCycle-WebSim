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


def assemble_words(words, out):
    """把一串已算好的机器码直接写成裸二进制。
    用于表达 asm.py 根本写不出来的编码（RV32M、保留 funct7、非法 funct3）。"""
    with open(out, "wb") as f:
        for w in words:
            f.write((w & 0xFFFFFFFF).to_bytes(4, "little"))


class Sim:
    def __init__(self, bin_path):
        self.proc = subprocess.Popen([SIM], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, text=True,
                                     encoding="utf-8")
        resp = self.send({"cmd": "load_elf", "path": bin_path})
        assert resp.get("status") == "ok", resp

    def send(self, cmd):
        # ensure_ascii=False: 保留真实 UTF-8 中文路径（C++ 的极简 JSON 解析器不认 \uXXXX 转义）
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

    # 校验 auipc 结果：s5 = auipc 自身 PC + (imm << 12)，imm = 0x12345
    #
    # ★ 期望值必须由 Python 独立算出，绝不能从被测对象自己的 trace 里反查。
    #   这里原先写的是 `regs[21] == auipc_pc`（拿 state 里的 pc 当期望值），
    #   而那恰好就是错误实现的行为（PASS_A 只透传 op1=pc，立即数被丢掉），
    #   所以断言一直在给 bug 背书 —— 加上 test_basic.s 里用的 imm 是 0，
    #   正确实现与错误实现结果相同，两重巧合让它潜伏至今。
    auipc_pc = None
    for st in states:
        if "auipc" in st.get("state", {}).get("disassembly", ""):
            auipc_pc = int(st["state"]["pc"], 16)
            break
    # auipc 是 test_basic.s 里第 13 条指令（12*4 = 48 = 0x30），基址 0x80000000
    check("auipc 指令位于 0x80000030", auipc_pc == 0x80000030,
          f"实际 {hex(auipc_pc) if auipc_pc is not None else '未找到'}")
    if auipc_pc is not None:
        expect = (auipc_pc + (0x12345 << 12)) & 0xFFFFFFFF
        check("s5 == auipc PC + 0x12345000", regs[21] == expect,
              f"s5={hex(regs[21])} expect={hex(expect)}")
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

    # ---- 测试 4: 伪指令端到端 ----
    # test_asm.py 验的是「编码器算的 == 我手算的」，两边可能一起错；
    # 这一节把伪指令编出的程序真的跑一遍，验的是 CPU 执行后的结果。
    print("== 测试 4: 伪指令端到端 (test_pseudo.s) ==")
    bin4 = os.path.join(HERE, "test_pseudo.bin")
    assemble(os.path.join(HERE, "test_pseudo.s"), bin4)
    sim4 = Sim(bin4)
    states4 = run_to_halt(sim4)
    sim4.close()
    last4 = states4[-1].get("state", {})
    r = last4.get("regfile", [])

    check("停机 (halted)", last4.get("halted"), str(last4.get("halted")))
    check("li 小常数 a0 == 0", r[10] == 0, f"a0={r[10]}")
    check("li 大常数 a1 == 0x12345", r[11] == 0x12345, f"a1={hex(r[11])}")
    check("mv a2 == a1", r[12] == 0x12345, f"a2={hex(r[12])}")
    check("li 负数 a6 == -100", r[16] == (2**32 - 100) % 2**32, f"a6={hex(r[16])}")
    check("bnez 循环 s1 == 5+4+3+2+1 = 15", r[9] == 15, f"s1={r[9]}")
    check("循环退出后 s0 == 0", r[8] == 0, f"s0={r[8]}")
    check("call 返回后执行了 a3 == 1", r[13] == 1, f"a3={r[13]}")
    check("子程序里 li a4 == 7", r[14] == 7, f"a4={r[14]}")
    # t4 读到 0xCAFEBABE 就同时证明了 la 算出的地址是对的（否则读到 0 或别的）
    check("la + lw 读到 data == 0xCAFEBABE", r[29] == 0xCAFEBABE, f"t4={hex(r[29])}")
    check("sw 0x4(t3) 后 lw 0x4(t3) 回读一致", r[30] == 0xCAFEBABE, f"t5={hex(r[30])}")
    check("la 的目标落在镜像内",
          0x80000000 <= r[28] < 0x80000000 + 4096, f"t3={hex(r[28])}")
    check("退出码 a5 == 0", r[15] == 0, f"a5={r[15]}")

    # ---- 测试 5: 非法指令编码 ----
    # 验两条独立的正确性要求：
    #   ① 不属于 RV32I 的编码必须**报错**，绝不能静默当别的指令执行。
    #      原先 rv_disasm 的 OP_OP 除 sub/sra 外完全不看 funct7，于是 RV32M 的
    #      mul/div/rem（funct7=0x01）被当成 add/sll/slt 跑出一个**不报错的错值**。
    #   ② 报错时给学生看的反汇编文本必须能看懂。原先五个 default 只置 kind 不置
    #      mnemonic，而后面拼文本的代码是无条件执行的，文本会变成 " gp, ra, sp"
    #      这种「没有指令名的操作数碎片」。
    print("== 测试 5: 非法指令编码 ==")

    # 机器码用显式位域拼。这里不 import asm.py —— 它本来就表达不了这些编码。
    def r_type(funct7, rs2, rs1, funct3, rd, opcode=0x33):
        return ((funct7 << 25) | (rs2 << 20) | (rs1 << 15)
                | (funct3 << 12) | (rd << 7) | opcode)

    def i_type(opcode, funct3, rd, rs1, imm12):
        return ((imm12 & 0xFFF) << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode

    def s_type(funct3, rs2, rs1, imm12):
        imm = imm12 & 0xFFF
        return (((imm >> 5) << 25) | (rs2 << 20) | (rs1 << 15)
                | (funct3 << 12) | ((imm & 0x1F) << 7) | 0x23)

    def b_type(funct3, rs2, rs1, imm13):
        # B 型的位分布最容易写错：imm[12|10:5] 在高位，imm[4:1|11] 在低位
        imm = imm13 & 0x1FFF
        return ((((imm >> 12) & 1) << 31) | (((imm >> 5) & 0x3F) << 25)
                | (rs2 << 20) | (rs1 << 15) | (funct3 << 12)
                | (((imm >> 1) & 0xF) << 8) | (((imm >> 11) & 1) << 7) | 0x63)

    # 拼装函数自己也要对一次手算字面量：双重录入，防我把位拼错还理直气壮
    print("  -- 位域拼装 vs 手算字面量 --")
    check("add x3,x1,x2 的机器码", r_type(0b0000000, 2, 1, 0b000, 3) == 0x002081B3)
    check("sub x3,x1,x2 的机器码", r_type(0b0100000, 2, 1, 0b000, 3) == 0x402081B3)
    check("mul x3,x1,x2 的机器码", r_type(0b0000001, 2, 1, 0b000, 3) == 0x022081B3)
    check("div x3,x1,x2 的机器码", r_type(0b0000001, 2, 1, 0b100, 3) == 0x0220C1B3)
    check("slli x3,x1,1 带保留 funct7 的机器码",
          i_type(0x13, 0b001, 3, 1, 0x021) == 0x02109193)
    check("beq x1,x2,8 的机器码", b_type(0b000, 2, 1, 8) == 0x00208463)

    LEGAL = [
        ("add x3, x1, x2", r_type(0b0000000, 2, 1, 0b000, 3), "add gp, ra, sp"),
        ("sub x3, x1, x2", r_type(0b0100000, 2, 1, 0b000, 3), "sub gp, ra, sp"),
        ("srl x3, x1, x2", r_type(0b0000000, 2, 1, 0b101, 3), "srl gp, ra, sp"),
        ("sra x3, x1, x2", r_type(0b0100000, 2, 1, 0b101, 3), "sra gp, ra, sp"),
    ]
    ILLEGAL = [
        ("mul x3, x1, x2（RV32M，本 CPU 不属于 RV32I）", r_type(0b0000001, 2, 1, 0b000, 3)),
        ("div x3, x1, x2（RV32M）", r_type(0b0000001, 2, 1, 0b100, 3)),
        ("slli 的 funct7≠0（保留编码）", i_type(0x13, 0b001, 3, 1, 0x021)),
        ("srli 的 funct7 既非 0x00 也非 0x20", i_type(0x13, 0b101, 3, 1, 0x041)),
        ("branch 的 funct3=010（保留）", b_type(0b010, 2, 1, 8)),
        ("load 的 funct3=011（RV64 的 ld）", i_type(0x03, 0b011, 3, 1, 0)),
        ("store 的 funct3=011（RV64 的 sd）", s_type(0b011, 2, 1, 0)),
    ]
    bin5 = os.path.join(HERE, "test_illegal.bin")

    def first_cycle(word):
        # 本机 mtvec 默认 0 ⇒ 未处理的 trap 立刻停机，所以一条非法指令单独跑一遍
        assemble_words([word, 0x00000073], bin5)   # 后跟 ecall，正常路径才走得到
        s = Sim(bin5)
        st = s.step().get("state", {})
        s.close()
        return st

    print("  -- 合法编码不许被误判（funct7 收口的回归护栏）--")
    for note, word, want in LEGAL:
        st = first_cycle(word)
        check(f"{note} 未触发陷阱", not st.get("trap", {}).get("taken"),
              f"trap={st.get('trap')}")
        check(f"{note} 反汇编为 {want!r}", st.get("disassembly") == want,
              f"disassembly={st.get('disassembly')!r}")

    print("  -- 非法编码必须报错、文本可读 --")
    for note, word in ILLEGAL:
        st = first_cycle(word)
        tr = st.get("trap", {})
        check(f"{note} → trap.cause == 2", tr.get("cause") == 2, f"cause={tr.get('cause')}")
        check(f"{note} → mtval == 机器码", tr.get("mtval") == f"0x{word:08x}",
              f"mtval={tr.get('mtval')} 期望 0x{word:08x}")
        check(f"{note} → 反汇编文本是 .word",
              st.get("disassembly") == f".word {word:#x}",
              f"disassembly={st.get('disassembly')!r}")
        check(f"{note} → 未处理陷阱直接停机", st.get("halted") is True,
              f"halted={st.get('halted')}")

    # ---- 测试 6: 六条分支全覆盖 ----
    # taken 原先是一张 switch(d.kind) 表：功能上对，但图上那个 taken 只有 branch/zf
    # 两个输入（等价于只判得动 beq），blt/bge/bltu/bgeu 的判断过程在图上学不到。
    # 改法是两边一起动：
    #   后端  base = funct3[2] ? LT : ZF;  taken = funct3[0] ? !base : base
    #   前端  taken 单元收 branch + funct3[2] + funct3[0] + ZF + LT 五路
    # 这一节把 6 条分支各跑一遍，并**专挑有符号与无符号结论相反**的操作数：
    #   -1 = 0xFFFFFFFF，拿它和 1 比，有符号看是 -1<1（真）、无符号看是 0xFFFFFFFF<1（假）。
    # 于是 alu_op 把 SLT / SLTU 选反、或 funct3[0] 极性取反，都会立刻失败。
    print("== 测试 6: 六条分支全覆盖 ==")

    # (助记符, rs1 值, rs2 值, 期望跳转)
    CASES = [
        ("beq",   5,  5, True),
        ("beq",   5,  6, False),
        ("bne",   5,  6, True),
        ("bne",   5,  5, False),
        ("blt",  -1,  1, True),    # 有符号 -1 < 1 真；无符号 0xFFFFFFFF < 1 假
        ("blt",   1, -1, False),   # 有符号 1 < -1 假；无符号 1 < 0xFFFFFFFF 真
        ("bge",   1, -1, True),
        ("bge",  -1,  1, False),
        ("bltu", -1,  1, False),   # 与上面 blt(-1,1) 的结论**相反**
        ("bltu",  1, -1, True),    # 与上面 blt(1,-1) 的结论**相反**
        ("bgeu",  1, -1, False),
        ("bgeu", -1,  1, True),
    ]

    for mn, a_val, b_val, want in CASES:
        # 布局固定：0:li t0,A  1:li t1,B  2:分支  3:li a0,0  4:j E  5:L: li a0,1  6:E: ecall
        # 两条路径都汇到 ecall（mtvec==0 于是停机），所以判错方向不会挂住，只会读到错的 a0
        src = [f"    li t0, {a_val}",
               f"    li t1, {b_val}",
               f"    {mn} t0, t1, L",
               "    li a0, 0",
               "    j E",
               "L:  li a0, 1",
               "E:  ecall"]
        asm_path = os.path.join(HERE, "_branch_tmp.s")
        with open(asm_path, "w", encoding="utf-8") as f:
            f.write("\n".join(src) + "\n")
        bin6 = os.path.join(HERE, "_branch_tmp.bin")
        assemble(asm_path, bin6)

        s6 = Sim(bin6)
        states6 = run_to_halt(s6)
        s6.close()

        tag = f"{mn} {a_val},{b_val}"
        # 定位执行分支的那一周期
        br = [st["state"] for st in states6
              if st.get("state", {}).get("disassembly", "").startswith(mn + " ")]
        if len(br) != 1:
            check(f"{tag} 只执行到一次分支指令", False, f"命中 {len(br)} 次")
            continue
        st = br[0]
        check(f"{tag} 的 PC 是 0x80000008", st["pc"] == "0x80000008", f"pc={st['pc']}")
        check(f"{tag} → branch.taken == {want}", st["branch"]["taken"] is want,
              f"taken={st['branch']['taken']}")
        # 跳转目标：L 在分支指令后第 3 条（+12 字节）；不跳转则顺序执行（+4）
        want_target = 0x80000008 + (12 if want else 4)
        check(f"{tag} → branch.target_addr == {hex(want_target)}",
              st["branch"]["target_addr"] == hex(want_target),
              f"target={st['branch']['target_addr']}")
        # 端到端：走哪条路径最终由 a0 体现
        a0 = states6[-1]["state"]["regfile"][10]
        check(f"{tag} → 端到端 a0 == {1 if want else 0}", a0 == (1 if want else 0), f"a0={a0}")

    for tmp in (os.path.join(HERE, "_branch_tmp.s"), os.path.join(HERE, "_branch_tmp.bin")):
        if os.path.exists(tmp):
            os.remove(tmp)

    print(f"\n结果: {PASS} 通过, {FAIL} 失败")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
