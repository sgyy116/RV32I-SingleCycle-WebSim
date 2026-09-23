#!/usr/bin/env python3
# ============================================================================
# asm.py —— 微型 RV32I 汇编器（教学用，作为交叉编译器的回退方案）
#
# ★ 这份汇编器就是本产品实际使用的编译器。
#   本机（以及学生机器）上 riscv-none-elf-gcc / riscv64-unknown-elf-gcc /
#   riscv32-unknown-elf-gcc / riscv64-linux-gnu-gcc / riscv64-elf-gcc 都不存在，
#   compile_server.py 会直接回退到这里。**它不支持什么，产品就不支持什么。**
#   因此前端的高亮关键字表（frontend/src/utils/riscvLang.ts 的 MNEMONICS）
#   必须与本文件逐条对齐，改一边就要改另一边。
#
# 支持子集：
#   addi rd, rs1, imm    add rd, rs1, rs2    sub rd, rs1, rs2
#   lw rd, imm(rs1)      sw rs2, imm(rs1)    lh/lb/lhu/lbu/sh/sb
#   beq/bne/blt/bge/bltu/bgeu rs1, rs2, label
#   jal rd, label        jal label（rd 默认 ra）
#   jalr rd, rs1, imm    jalr rd, imm(rs1)   jalr rs1（rd 默认 ra，imm=0）
#   lui rd, imm          auipc rd, imm
#   slli/srli/srai rd, rs1, shamt
#   sll/srl/sra/slt/sltu/xor/or/and rd, rs1, rs2
#   xori/ori/andi/slti/sltiu rd, rs1, imm
#   ecall                ebreak               mret
#   csrrw/csrrs/csrrc/csrrwi/csrrsi/csrrci rd, csr, rs1|uimm
#   .word 0x12345678
#
# 伪指令（会展开成上面的一条或两条真实指令）：
#   li rd, imm           mv rd, rs            nop            ret
#   j label              beqz rs, label       bnez rs, label
#   la rd, label         call label
#
# 立即数/偏移一律十进制或 0x 十六进制皆可（`lw t0, 0x10(sp)` 与 `addi a0, x0, 0x10` 一致）。
# 标签可以独占一行，也可以行内写在指令前（`L: addi a0, a0, 1`）。
#
# 用法: python3 asm.py input.s output.bin
# ============================================================================

import re
import sys

REG = {name: i for i, name in enumerate([
    "zero", "ra", "sp", "gp", "tp", "t0", "t1", "t2",
    "s0", "s1", "a0", "a1", "a2", "a3", "a4", "a5",
    "a6", "a7", "s2", "s3", "s4", "s5", "s6", "s7",
    "s8", "s9", "s10", "s11", "t3", "t4", "t5", "t6",
])}
REG["fp"] = 8      # s0 的 ABI 别名，就是 x8

BASE = 0x80000000  # 程序加载基址（与模拟器 RESET_VECTOR 一致）

BRANCHES = ("beq", "bne", "blt", "bge", "bltu", "bgeu")
LOADS = ("lw", "lh", "lb", "lhu", "lbu")
STORES = ("sw", "sh", "sb")
ALU_IMM = ("addi", "slti", "sltiu", "xori", "ori", "andi")
ALU_REG = ("add", "sub", "sll", "slt", "sltu", "xor", "srl", "sra", "or", "and")
SHIFTS = ("slli", "srli", "srai")
CSR_OPS = ("csrrw", "csrrs", "csrrc", "csrrwi", "csrrsi", "csrrci")


# ---------------------------------------------------------------- 操作数解析

def reg(r):
    r = r.strip()
    if r.startswith("x"):
        digits = r[1:]
        if not digits.isdigit():
            raise ValueError(f"寄存器写法不对：{r}（应为 x0~x31 或 zero/ra/sp/... 这类 ABI 名）")
        n = int(digits)
        # 原先 `return int(r[1:])` 不校验范围：写 x99 会静默把编码字段污染成乱七八糟的值，
        # 生成一条谁也没写过的指令，而且不报错。
        if not 0 <= n <= 31:
            raise ValueError(f"寄存器号越界：{r}（只有 x0~x31，共 32 个）")
        return n
    if r in REG:
        return REG[r]
    raise ValueError(f"不认识的寄存器：{r}")


def imm(s):
    s = s.strip()
    if s.startswith("0x") or s.startswith("0X"):
        return int(s, 16)
    if s.startswith("-0x") or s.startswith("-0X"):
        return -int(s[3:], 16)
    return int(s)


def mem_operand(s):
    """解析 `偏移(基址)`，返回 (基址寄存器号, 偏移)。

    偏移允许十进制也允许 0x —— 同一个文件里的 addi 一直支持 0x，访存却只认十进制，
    这是两条互相矛盾的规则。而且原来的正则在失配时 m 是 None，会漏出
    「'NoneType' object has no attribute 'group'」这种学生完全看不懂的报错。
    """
    m = re.match(r"^(-?(?:0[xX][0-9a-fA-F]+|\d+))\((\w+)\)$", s.strip())
    if not m:
        raise ValueError(
            f"访存地址写法不对：{s}（应为 偏移(基址寄存器)，例如 0x10(sp)、-4(sp)、0(sp)）")
    return reg(m.group(2)), imm(m.group(1))


def csr(s):
    s = s.strip().lower()
    names = {
        "mstatus": 0x300, "misa": 0x301, "mie": 0x304, "mtvec": 0x305,
        "mscratch": 0x340, "mepc": 0x341, "mcause": 0x342, "mtval": 0x343,
        "mip": 0x344,
        "cycle": 0xC00, "time": 0xC01, "instret": 0xC02,
        "mtimecmp": 0x780,   # 模拟器自定义：计时器闹钟值
    }
    if s in names:
        return names[s]
    n = int(s, 0)
    if not 0 <= n <= 0xFFF:
        raise ValueError(f"CSR 号越界：{s}（CSR 地址只有 12 位，0~0xfff）")
    return n


def sign(x, bits):
    x &= (1 << bits) - 1
    if x & (1 << (bits - 1)):
        x -= (1 << bits)
    return x


def _chk(val, lo, hi, what):
    """立即数/偏移范围校验。超范围宁可报错，也不要静默掩码成一条错的指令。"""
    if not lo <= val <= hi:
        raise ValueError(f"{what} 超出范围（{lo} ~ {hi}）：{val}")
    return val


# ---------------------------------------------------------------- 编码核心
# 下面 5 个编码函数逐位对照 RISC-V 规范写，本轮一行未改（已逐位核对过，是对的）。

def enc_r(funct7, rs2, rs1, funct3, rd, opcode):
    return (funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode


def enc_i(imm, rs1, funct3, rd, opcode):
    return ((imm & 0xFFF) << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode


def enc_s(imm, rs2, rs1, funct3, opcode):
    imm &= 0xFFF
    return ((imm >> 5) << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | ((imm & 0x1F) << 7) | opcode


def enc_b(imm, rs2, rs1, funct3, opcode):
    imm &= 0x1FFF
    return (((imm >> 12) & 1) << 31) | (((imm >> 5) & 0x3F) << 25) | (rs2 << 20) | (rs1 << 15) | \
           (funct3 << 12) | (((imm >> 1) & 0xF) << 8) | (((imm >> 11) & 1) << 7) | opcode


def enc_u(imm, rd, opcode):
    return ((imm & 0xFFFFF) << 12) | (rd << 7) | opcode


def enc_j(imm, rd, opcode):
    imm &= 0x1FFFFF
    return (((imm >> 20) & 1) << 31) | (((imm >> 1) & 0x3FF) << 21) | (((imm >> 11) & 1) << 20) | \
           (((imm >> 12) & 0xFF) << 12) | (rd << 7) | opcode


# ---------------------------------------------------------------- 伪指令展开

def _hi_lo(value):
    """把一个 32 位值拆成 lui 的高 20 位与 addi 的低 12 位（带 0x800 舍入补偿）。"""
    hi = (value + 0x800) >> 12
    return hi, value - (hi << 12)


def _need(ops, n, mnemonic):
    """操作数个数校验。少给一个操作数应该是「需要 2 个」这种提示，
    而不是漏出 IndexError: list index out of range。"""
    if len(ops) != n:
        raise ValueError(f"{mnemonic} 需要 {n} 个操作数，实际给了 {len(ops)} 个")


def expand(mnemonic, ops, pc):
    """把一条语句展开成 [(真实助记符, [操作数]), ...]。pc 是这条语句自己的地址。

    展开放在**第一遍扫描**里做，而不是等第二遍编码时再展开——这样「这条语句占几个字」
    在算标签地址时就已经确定了。原先只在第一遍里硬写 `pc += 8 if ... == "la"`，
    每加一条双字伪指令就得回去改一次那个判断。

    符号元组的形状是 ("sym", 标签, "hi"|"lo", 基址)：
      基址为 None → 绝对地址（标签 + 加载基址），给 la 用；
      基址为一个整数 → PC 相对，减去那条基址指令的地址，给 call 用。
    ★ call 的 hi 与 lo **必须共用同一条 auipc 的地址**，不能各自用自己那条指令的地址：
      auipc 在 pc、jalr 在 pc+4，若 lo 拿 pc+4 去减，落点会整体少 4 字节。
    """
    if mnemonic == "nop":
        _need(ops, 0, mnemonic)
        return [("addi", ["zero", "zero", "0"])]
    if mnemonic == "mv":
        _need(ops, 2, mnemonic)
        return [("addi", [ops[0], ops[1], "0"])]
    if mnemonic == "ret":
        _need(ops, 0, mnemonic)
        return [("jalr", ["zero", "ra", "0"])]
    if mnemonic == "j":
        _need(ops, 1, mnemonic)
        return [("jal", ["zero", ops[0]])]
    if mnemonic in ("beqz", "bnez"):
        _need(ops, 2, mnemonic)
        return [("beq" if mnemonic == "beqz" else "bne", [ops[0], "zero", ops[1]])]
    if mnemonic == "li":
        _need(ops, 2, mnemonic)
        v = sign(imm(ops[1]), 32)
        if -2048 <= v <= 2047:                 # 小常数一条 addi 就够
            return [("addi", [ops[0], "zero", str(v)])]
        hi, lo = _hi_lo(v)
        return [("lui", [ops[0], str(hi)]), ("addi", [ops[0], ops[0], str(lo)])]
    if mnemonic == "la":
        # la rd, label → lui rd, hi ; addi rd, rd, lo（绝对地址 = 基址 + 标签偏移）
        _need(ops, 2, mnemonic)
        return [("lui",  [ops[0], ("sym", ops[1], "hi", None)]),
                ("addi", [ops[0], ops[0], ("sym", ops[1], "lo", None)])]
    if mnemonic == "call":
        # call label → auipc ra, hi ; jalr ra, ra, lo（PC 相对，偏移 = 标签 - auipc 的 PC）
        # 注意 call 只有 label 一个操作数（rd 固定 ra），所以标签在 ops[0]，不是 ops[1]
        _need(ops, 1, mnemonic)
        return [("auipc", ["ra", ("sym", ops[0], "hi", pc)]),
                ("jalr",  ["ra", "ra", ("sym", ops[0], "lo", pc)])]
    return [(mnemonic, ops)]


def _sym(v, labels):
    """操作数定值：普通字面量走 imm()；伪指令展开留下的符号元组在这里按标签算出来。"""
    if not isinstance(v, tuple):
        return imm(v)
    _, label, which, base = v
    if label not in labels:
        raise ValueError(f"找不到标签：{label}")
    delta = labels[label] + BASE if base is None else labels[label] - base
    hi, lo = _hi_lo(delta)
    return hi if which == "hi" else lo


def _label_off(label, pc, labels):
    if label not in labels:
        raise ValueError(f"找不到标签：{label}")
    return labels[label] - pc


# ---------------------------------------------------------------- 单条编码

def encode(mnemonic, o, pc, labels):
    if mnemonic in ALU_IMM:
        rd, rs1 = reg(o[0]), reg(o[1])
        im = _chk(_sym(o[2], labels), -2048, 2047, "立即数")
        f3 = {"addi": 0, "slti": 2, "sltiu": 3, "xori": 4, "ori": 6, "andi": 7}[mnemonic]
        return enc_i(im, rs1, f3, rd, 0x13)
    if mnemonic in SHIFTS:
        rd, rs1 = reg(o[0]), reg(o[1])
        sh = _chk(_sym(o[2], labels), 0, 31, "移位量")
        f7 = 0x20 if mnemonic == "srai" else 0x00
        f3 = 1 if mnemonic == "slli" else 5
        return enc_r(f7, sh, rs1, f3, rd, 0x13)
    if mnemonic in ALU_REG:
        rd, rs1, rs2 = reg(o[0]), reg(o[1]), reg(o[2])
        f7 = {"sub": 0x20, "sra": 0x20}.get(mnemonic, 0)
        f3 = {"add": 0, "sub": 0, "sll": 1, "slt": 2, "sltu": 3,
              "xor": 4, "srl": 5, "sra": 5, "or": 6, "and": 7}[mnemonic]
        return enc_r(f7, rs2, rs1, f3, rd, 0x33)
    if mnemonic in LOADS:
        rd = reg(o[0])
        rs1, im = mem_operand(o[1])
        _chk(im, -2048, 2047, "访存偏移")
        f3 = {"lw": 2, "lh": 1, "lb": 0, "lhu": 5, "lbu": 4}[mnemonic]
        return enc_i(im, rs1, f3, rd, 0x03)
    if mnemonic in STORES:
        rs2 = reg(o[0])
        rs1, im = mem_operand(o[1])
        _chk(im, -2048, 2047, "访存偏移")
        f3 = {"sw": 2, "sh": 1, "sb": 0}[mnemonic]
        return enc_s(im, rs2, rs1, f3, 0x23)
    if mnemonic in BRANCHES:
        rs1, rs2 = reg(o[0]), reg(o[1])
        off = _label_off(o[2], pc, labels)
        if off % 2:
            raise ValueError(f"分支目标没有 4 字节对齐（偏移 {off} 是奇数）")
        _chk(off, -4096, 4094, "分支偏移")
        f3 = {"beq": 0, "bne": 1, "blt": 4, "bge": 5, "bltu": 6, "bgeu": 7}[mnemonic]
        return enc_b(off, rs2, rs1, f3, 0x63)
    if mnemonic == "jal":
        rd = reg(o[0]) if len(o) > 1 else 1        # 省略 rd 时默认 ra，与 GNU as 一致
        lab = o[1] if len(o) > 1 else o[0]
        off = _label_off(lab, pc, labels)
        if off % 2:
            raise ValueError(f"跳转目标没有 4 字节对齐（偏移 {off} 是奇数）")
        _chk(off, -1048576, 1048574, "跳转偏移")
        return enc_j(off, rd, 0x6F)
    if mnemonic == "jalr":
        if len(o) == 1:                            # jalr rs1  →  jalr ra, rs1, 0
            rd, rs1, im = 1, reg(o[0]), 0
        elif len(o) == 2 and "(" in o[1]:          # jalr rd, imm(rs1)
            rd = reg(o[0])
            rs1, im = mem_operand(o[1])
        elif len(o) == 2:                          # jalr rd, rs1  →  imm 取 0
            rd, rs1, im = reg(o[0]), reg(o[1]), 0
        else:                                      # jalr rd, rs1, imm
            rd, rs1 = reg(o[0]), reg(o[1])
            im = _sym(o[2], labels)
        _chk(im, -2048, 2047, "jalr 偏移")
        return enc_i(im, rs1, 0, rd, 0x67)
    if mnemonic == "lui":
        rd = reg(o[0])
        im = _chk(_sym(o[1], labels), -0x80000, 0xFFFFF, "lui 立即数")
        return enc_u(im, rd, 0x37)
    if mnemonic == "auipc":
        rd = reg(o[0])
        im = _chk(_sym(o[1], labels), -0x80000, 0xFFFFF, "auipc 立即数")
        return enc_u(im, rd, 0x17)
    if mnemonic == "ecall":
        return 0x00000073
    if mnemonic == "ebreak":
        return 0x00100073
    if mnemonic == "mret":
        return 0x30200073
    if mnemonic in CSR_OPS:
        rd = reg(o[0])
        addr = csr(o[1])
        f3 = {"csrrw": 1, "csrrs": 2, "csrrc": 3,
              "csrrwi": 5, "csrrsi": 6, "csrrci": 7}[mnemonic]
        if mnemonic in ("csrrwi", "csrrsi", "csrrci"):
            src = _chk(_sym(o[2], labels), 0, 31, "CSR uimm")   # uimm：5 位
        else:
            src = reg(o[2])                                        # rs1 寄存器编号
        return enc_i(addr, src, f3, rd, 0x73)
    if mnemonic == ".word":
        return imm(o[0]) & 0xFFFFFFFF
    raise ValueError(f"不支持的助记符：{mnemonic}")


# ---------------------------------------------------------------- 主流程

def assemble(lines):
    """汇编源码行列表，返回 32 位指令字列表。"""
    # 第一遍：去注释、登记标签、展开伪指令，同时把每条真实指令的地址算出来
    program = []          # [(pc, 助记符, [操作数], 源行, 行号)]
    labels = {}
    pc = 0
    for lineno, raw in enumerate(lines, 1):
        line = re.sub(r"#.*", "", raw).strip()
        if not line:
            continue
        # 标签：允许独占一行，也允许行内写成 `L: addi a0, a0, 1`。
        # 原先要求 `line.endswith(":")`，行内标签会被整行当成指令名，报 KeyError。
        if ":" in line:
            label, _, tail = line.partition(":")
            label = label.strip()
            if not re.match(r"^[A-Za-z_.$][\w.$]*$", label):
                raise ValueError(f"第 {lineno} 行：标签名不合法：{label}")
            if label in labels:
                raise ValueError(f"第 {lineno} 行：标签重复定义：{label}")
            labels[label] = pc
            line = tail.strip()
            if not line:
                continue
        parts = line.replace(",", " ").split()
        # 伪指令展开也可能出错（比如 li 的第二个操作数不是数），这里的报错同样要带行号
        try:
            expanded = expand(parts[0], parts[1:], pc)
        except (ValueError, IndexError) as e:
            raise ValueError(f"第 {lineno} 行 `{line}`：{e}") from None
        for m, o in expanded:
            program.append((pc, m, o, line, lineno))
            pc += 4

    # 第二遍：编码。出错时补上真实行号——原先报的是指令文本，学生看不出是哪一行。
    output = []
    for pc, mnemonic, o, line, lineno in program:
        try:
            output.append(encode(mnemonic, o, pc, labels))
        except (ValueError, IndexError) as e:
            raise ValueError(f"第 {lineno} 行 `{line}`：{e}") from None
    return output


def main():
    if len(sys.argv) < 3:
        print("用法: python3 asm.py input.s output.bin")
        return 1
    with open(sys.argv[1], encoding="utf-8") as f:
        words = assemble(f.read().splitlines())
    with open(sys.argv[2], "wb") as f:
        for w in words:
            f.write(w.to_bytes(4, "little"))
    print(f"已生成 {len(words)} 条指令 -> {sys.argv[2]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
