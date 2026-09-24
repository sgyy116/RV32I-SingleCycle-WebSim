#!/usr/bin/env python3
# ============================================================================
# test_asm.py —— 汇编器单元测试
# 用法: python3 test_asm.py
#
# ★ 这里的期望机器码**全部按 RISC-V 规范手工算出**，没有一条是从 asm.py 自己
#   的输出反查来的。理由见 test_sim.py 里 auipc 那条注释：拿被测对象的输出当
#   期望值，断言就变成了给 bug 背书，错误实现与恒真断言可以长期共存。
#
# 为什么这个文件重要：本机与学生机器上都没有 riscv-*-gcc，compile_server.py
# 会直接回退到 asm.assemble()。**这一份汇编器就是产品实际使用的编译器**，
# 它的每个缺口都是产品的功能缺口。
# ============================================================================

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "python"))

import asm  # noqa: E402

PASS = 0
FAIL = 0

BASE = 0x80000000


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [OK] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name}  {detail}")


def asm1(src):
    """汇编一条（或多条）指令，返回机器码列表。"""
    return asm.assemble(src if isinstance(src, list) else src.splitlines())


def check_code(name, src, expect):
    try:
        got = asm1(src)
    except Exception as e:                      # noqa: BLE001
        check(name, False, f"抛异常 {type(e).__name__}: {e}")
        return
    got_s = " ".join(f"{w:08x}" for w in got)
    exp_s = " ".join(f"{w:08x}" for w in expect)
    check(name, got == expect, f"得到 {got_s}，期望 {exp_s}")


def check_raises(name, src, must_contain):
    try:
        asm1(src)
    except ValueError as e:
        missing = [s for s in must_contain if s not in str(e)]
        check(name, not missing, f"报错信息缺少 {missing}；实际是「{e}」")
        return
    except Exception as e:                      # noqa: BLE001
        check(name, False, f"抛了 {type(e).__name__} 而不是 ValueError：{e}")
        return
    check(name, False, "本该报错却编过了")


def main():
    # ---------------------------------------------------------------- 1
    # 基本编码：独立手算，确认编码核心没有被改动。
    #   addi a0, x0, 10  → opcode 0x13 | rd=10<<7 | f3=0 | rs1=0 | imm=10<<20
    #                     = 0x00A00000 | 0x500 | 0x13 = 0x00A00513
    #   lui  a0, 0x12345 → 0x12345<<12 | rd=10<<7 | 0x37 = 0x12345000|0x500|0x37
    #   j    +4          → J 型 imm=4: imm[10:1]=2 → 2<<21 = 0x00400000 | 0x6F
    #   jalr ra, ra, 0   → rs1=1<<15 | rd=1<<7 | 0x67 = 0x8000|0x80|0x67
    #   sw   t0, 4(sp)   → rs2=5<<20 | rs1=2<<15 | f3=2<<12 | imm[4:0]=4<<7 | 0x23
    #                     = 0x500000|0x10000|0x2000|0x200|0x23 = 0x00512223
    print("== 1. 基本编码（手工算出的期望值）==")
    check_code("addi a0, x0, 10", "addi a0, x0, 10", [0x00A00513])
    check_code("lui a0, 0x12345", "lui a0, 0x12345", [0x12345537])
    check_code("jalr ra, ra, 0", "jalr ra, ra, 0", [0x000080E7])
    check_code("sw t0, 4(sp)", "sw t0, 0x4(sp)", [0x00512223])
    check_code("ecall / ebreak / mret", ["ecall", "ebreak", "mret"],
               [0x00000073, 0x00100073, 0x30200073])
    check_code("x0~x31 与 ABI 名等价", ["addi x10, x0, 1", "addi a0, zero, 1"],
               [0x00100513, 0x00100513])

    # ---------------------------------------------------------------- 2
    # 缺口 a：伪指令 li / mv / nop / ret / call / beqz / bnez
    #   li a0, 10        → 小常数，热成一条 addi
    #   li a0, 0x12345   → 0x12345 = 74565；hi=(74565+0x800)>>12 = 18 = 0x12，
    #                      lo = 74565 - 0x12*4096 = 837 = 0x345
    #                      lui  a0, 0x12 → 0x12<<12|0x500|0x37 = 0x00012537
    #                      addi a0, a0, 0x345 → 0x345<<20|0x50000|0x500|0x13
    #                                        = 0x34550513
    #   li a0, -2048     → 恰在下界内，一条 addi，imm 字段 = 0x800
    #   mv a0, a1        → addi a0, a1, 0 = rs1=11<<15|rd=10<<7|0x13
    #   nop              → addi x0, x0, 0 = 0x00000013
    #   ret              → jalr x0, ra, 0 = rs1=1<<15|rd=0|0x67
    print("== 2. 伪指令 li / mv / nop / ret ==")
    check_code("li a0, 10", "li a0, 10", [0x00A00513])
    check_code("li a0, 0x12345", "li a0, 0x12345", [0x00012537, 0x34550513])
    check_code("li a0, -2048", "li a0, -2048", [0x80000513])
    check_code("li a0, -1", "li a0, -1", [0xFFF00513])
    check_code("mv a0, a1", "mv a0, a1", [0x00058513])
    check_code("nop", "nop", [0x00000013])
    check_code("ret", "ret", [0x00008067])
    # li 的边界：2047 是一条，2048 变两条
    check("li 2047 只热出 1 条", len(asm1("li a0, 2047")) == 1)
    check("li 2048 热出 2 条", len(asm1("li a0, 2048")) == 2)
    # 2048 → hi=(2048+0x800)>>12 = 4096>>12 = 1；lo = 2048-4096 = -2048
    check_code("li a0, 2048 展开值正确", "li a0, 2048", [0x00001537, 0x80050513])

    # ---------------------------------------------------------------- 3
    # 缺口 a 续 / 分支伪指令 + call 的 PC 相对寻址
    #   beqz a0, L → beq a0, x0, L：rs1=10<<15|rs2=0|f3=0|off=4 的 B 型编码
    #                B 型 off=4: imm[10:5]=0, imm[4:1]=2 → 2<<8 = 0x200
    #                = 0x00050263
    #   bnez a0, L → f3=1 → 0x200 | 1<<12 = 0x00051263
    print("== 3. 分支伪指令 beqz / bnez / j ==")
    check_code("beqz a0, L", ["beqz a0, L", "L: ecall"], [0x00050263, 0x00000073])
    check_code("bnez a0, L", ["bnez a0, L", "L: ecall"], [0x00051263, 0x00000073])
    check_code("j L（= jal x0, L）", ["j L", "L: ecall"], [0x0040006F, 0x00000073])
    check_code("jal 省略 rd 默认 ra", ["jal L", "L: ecall"], [0x004000EF, 0x00000073])

    # call 展开成 auipc + jalr（PC 相对）。
    #   call 占 2 条（pc=0、4），故 f 在 pc=8。
    #   auipc: delta = 8 - 0 = 8；hi=(8+0x800)>>12 = 0，lo = 8
    #          auipc ra, 0  → rd=1<<7|0x17 = 0x00000097
    #          jalr ra, ra, 8 → 8<<20|1<<15|1<<7|0x67 = 0x008080E7
    #   跳转落点 = auipc 的 pc(0) + 0 + 8 = 8，正好是 f 的地址
    print("== 4. call 的 PC 相对寻址 ==")
    call_code = asm1(["call f", "f: ecall"])
    check_code("call f 展开", ["call f", "f: ecall"], [0x00000097, 0x008080E7, 0x00000073])
    if len(call_code) == 3:
        auipc_imm = ((call_code[0] >> 12) & 0xFFFFF) << 12
        jalr_imm = asm.sign(call_code[1] >> 20, 12)
        check("call 落点 = 标签 f 的地址 8", 0 + auipc_imm + jalr_imm == 8,
              f"算出 {hex(auipc_imm + jalr_imm)}")

    # ---------------------------------------------------------------- 5
    # 缺口 b：访存偏移支持 0x（原先只认十进制，写 0x10 会崩出
    #          「'NoneType' object has no attribute 'group'」）
    #   lw t0, 0x10(sp)：imm=0x10, rs1=2(sp), rd=5(t0), f3=2
    #     = 0x10<<20 | 2<<15 | 2<<12 | 5<<7 | 0x03 = 0x01012283
    #   lw t0, -0x10(sp)：imm=-16 → &0xFFF = 0xFF0 → 0xFF012283
    print("== 5. 访存偏移接受 0x（与 addi 的规则一致）==")
    check_code("lw t0, 0x10(sp)", "lw t0, 0x10(sp)", [0x01012283])
    check_code("lw t0, -0x10(sp)", "lw t0, -0x10(sp)", [0xFF012283])
    check_code("lw t0, 16(sp) 与 0x10 等价", "lw t0, 16(sp)", [0x01012283])
    check_code("sb a0, 0x0(a1)", "sb a0, 0x0(a1)", [0x00A58023])

    # ---------------------------------------------------------------- 6
    # 缺口 c：行内标签（原先要求标签独占一行，`L: addi ...` 会 KeyError）
    print("== 6. 行内标签 ==")
    check_code("L: addi a0, a0, 1", ["L: addi a0, a0, 1", "ecall"],
               [0x00150513, 0x00000073])
    check("行内标签能被跳转找到",
          asm1(["j L", "L: addi a0, a0, 1"]) == [0x0040006F, 0x00150513])

    # ---------------------------------------------------------------- 7
    # 缺口 d：jalr 的三种写法
    print("== 7. jalr 写法 ==")
    check_code("jalr rd, rs1, imm（原有形式）", "jalr ra, t0, 0", [0x000280E7])
    check_code("jalr rd, imm(rs1)", "jalr ra, 0(t0)", [0x000280E7])
    check_code("jalr rs1（rd 默认 ra）", "jalr t0", [0x000280E7])
    check_code("jalr rd, rs1（imm 取 0）", "jalr ra, t0", [0x000280E7])

    # ---------------------------------------------------------------- 8
    # 缺口 e / f：fp 别名、寄存器号 0-31 校验
    print("== 8. 寄存器解析 ==")
    check_code("fp 是 s0(x8) 的别名", ["addi fp, zero, 1", "addi s0, zero, 1"],
               [0x00100413, 0x00100413])
    check("x31 合法", asm1("addi x31, x0, 0") == [0x00000F93])
    check_raises("x32 越界要报错", "addi a0, x32, 0", ["越界", "x32"])
    check_raises("x99 越界要报错", "addi a0, x99, 0", ["越界", "x99"])
    check_raises("不认识的寄存器要报错", "addi a0, foo, 0", ["不认识的寄存器", "foo"])

    # ---------------------------------------------------------------- 9
    # 缺口：报错要带**真实行号**（原先 :195 报的是指令文本，不是行号）
    print("== 9. 报错带行号、能看懂 ==")
    check_raises("不支持的助记符", ["addi a0, x0, 1", "# 注释", "foobar a0"],
                 ["第 3 行", "foobar"])
    check_raises("访存写法不合法", ["ecall", "lw t0, 0x10sp"],
                 ["第 2 行", "0x10sp", "偏移(基址寄存器)"])
    check_raises("越界立即数不静默掩码", "addi a0, x0, 99999", ["第 1 行", "超出范围"])
    check_raises("shift 量越界", "slli a0, a0, 32", ["超出范围"])
    check_raises("找不到标签", ["beq a0, a1, nowhere"], ["找不到标签", "nowhere"])
    check_raises("li 的操作数不是数", ["ecall", "li a0, abc"], ["第 2 行"])
    check_raises("标签重复定义", ["L: ecall", "L: ecall"], ["重复定义", "L"])
    check_raises("标签名不合法", ["1bad: ecall"], ["标签名不合法"])

    # ---------------------------------------------------------------- 10
    # 缺口：双字伪指令的 PC 计数（la 占 8 字节，后续标签地址才对）
    #   la a0, target：target 在 pc = 8(la) + 4(jal) = 12
    #     target = 0x80000000 + 12 = 0x8000000C
    #     hi = (0x8000000C + 0x800) >> 12 = 0x80000000 >> 12 = 0x80000
    #     lo = 0x8000000C - 0x80000000 = 0xC
    #     lui  a0, 0x80000 → 0x80000<<12|0x500|0x37 = 0x80000537
    #     addi a0, a0, 12  → 0xC<<20|0x50000|0x500|0x13 = 0x00C50513
    #   jal ra, target 在 pc=8：off = 12-8 = 4 → 0x004000EF
    print("== 10. la / 双字伪指令的地址计算 ==")
    check_code("la + 后续标签地址正确",
               ["la a0, target", "jal ra, target", "target: ecall"],
               [0x80000537, 0x00C50513, 0x004000EF, 0x00000073])
    # li 大常数同样占两个字，后面的标签也要跟着挪
    check_code("li 大常数后的标签地址正确",
               ["li a0, 0x12345", "jal ra, done", "done: ecall"],
               [0x00012537, 0x34550513, 0x004000EF, 0x00000073])

    # ---------------------------------------------------------------- 11
    # CSR 与 .word
    #   csrrw x1, mstatus, x2: csr=0x300<<20 | rs1=2<<15 | f3=1<<12 | rd=1<<7 | 0x73
    #                          = 0x300110F3
    #   csrrwi x1, mstatus, 8: csr=0x300<<20 | uimm=8<<15 | f3=5<<12 | rd=1<<7 | 0x73
    #                          = 0x300450F3
    print("== 11. CSR / .word ==")
    check_code("csrrw x1, mstatus, x2", "csrrw x1, mstatus, x2", [0x300110F3])
    check_code("csrrwi x1, mstatus, 8", "csrrwi x1, mstatus, 8", [0x300450F3])
    check_code("csrrw 数字地址", "csrrw x1, 0x300, x2", [0x300110F3])
    check_code(".word", ".word 0x12345678", [0x12345678])
    check_raises("CSR 立即数版只收 0-31", "csrrwi a0, mstatus, 32", ["超出范围"])

    # ---------------------------------------------------------------- 12
    # 注释、空行、逗号风格
    print("== 12. 词法 ==")
    check("空行与注释被跳过", asm1(["", "  # 只有注释", "ecall"]) == [0x00000073])
    check("行尾注释被剥掉", asm1(["addi a0, x0, 1  # 加一"]) == [0x00100513])
    check("无逗号也能编", asm1(["addi a0 x0 1"]) == [0x00100513])

    print(f"\n结果: {PASS} 通过, {FAIL} 失败")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
