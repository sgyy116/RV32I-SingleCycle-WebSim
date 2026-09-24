#!/usr/bin/env python3
# ============================================================================
# asm.py —— 微型 RV32I 汇编器（教学用，作为交叉编译器的回退方案）
#
# 支持子集：
#   addi rd, rs1, imm    add rd, rs1, rs2    sub rd, rs1, rs2
#   lw rd, imm(rs1)      sw rs2, imm(rs1)    lh/lb/lhu/lbu/sh/sb
#   beq/bne/blt/bge/bltu/bgeu rs1, rs2, label
#   jal rd, label        jalr rd, rs1, imm   lui rd, imm   auipc rd, imm
#   j label              slli/srli/srai rd, rs1, shamt
#   sll/srl/sra/slt/sltu/xor/or/and rd, rs1, rs2
#   xori/ori/andi/slti/sltiu rd, rs1, imm
#   ecall                ebreak               .word 0x12345678
# 用法: python3 asm.py input.s output.bin
# ============================================================================

import sys
import re

REG = {name: i for i, name in enumerate([
    "zero", "ra", "sp", "gp", "tp", "t0", "t1", "t2",
    "s0", "s1", "a0", "a1", "a2", "a3", "a4", "a5",
    "a6", "a7", "s2", "s3", "s4", "s5", "s6", "s7",
    "s8", "s9", "s10", "s11", "t3", "t4", "t5", "t6",
])}


def reg(r):
    r = r.strip()
    if r.startswith("x"):
        return int(r[1:])
    if r in REG:
        return REG[r]
    raise ValueError(f"unknown register {r}")


def imm(s):
    s = s.strip()
    if s.startswith("0x") or s.startswith("-0x"):
        return int(s, 16)
    return int(s)


BASE = 0x80000000  # 程序加载基址（与模拟器 RESET_VECTOR 一致）


def csr(s):
    s = s.strip().lower()
    names = {
        "mstatus": 0x300, "misa": 0x301, "mie": 0x304, "mtvec": 0x305,
        "mscratch": 0x340, "mepc": 0x341, "mcause": 0x342, "mtval": 0x343,
        "mip": 0x344,
        "cycle": 0xC00, "time": 0xC01, "instret": 0xC02,
        "mtimecmp": 0x780,   # 模拟器自定义：计时器闹钟值
    }
    return names[s] if s in names else int(s, 0)


def sign(x, bits):
    x &= (1 << bits) - 1
    if x & (1 << (bits - 1)):
        x -= (1 << bits)
    return x


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


def assemble(lines):
    """汇编源码行列表，返回 32 位指令字列表。"""
    instructions = []
    pc = 0
    labels = {}
    for raw in lines:
        line = re.sub(r"#.*", "", raw).strip()
        if not line:
            continue
        if line.endswith(":"):
            labels[line[:-1]] = pc
            continue
        instructions.append((pc, line))
        # la 会展开成 lui+addi 两条指令，占 8 字节，后续标签地址才正确
        pc += 8 if line.replace(",", " ").split()[0] == "la" else 4

    output = []
    for pc, line in instructions:
        parts = line.replace(",", " ").split()
        mnemonic = parts[0]
        rest = parts[1:]

        if mnemonic in ("addi", "slti", "sltiu", "xori", "ori", "andi"):
            rd, rs1, im = reg(rest[0]), reg(rest[1]), imm(rest[2])
            f3 = {"addi": 0, "slti": 2, "sltiu": 3, "xori": 4, "ori": 6, "andi": 7}[mnemonic]
            output.append(enc_i(im, rs1, f3, rd, 0x13))
        elif mnemonic in ("slli", "srli", "srai"):
            rd, rs1, sh = reg(rest[0]), reg(rest[1]), imm(rest[2])
            f7 = 0x20 if mnemonic == "srai" else 0x00
            f3 = 1 if mnemonic == "slli" else 5
            output.append(enc_r(f7, sh, rs1, f3, rd, 0x13))
        elif mnemonic in ("add", "sub", "sll", "slt", "sltu", "xor", "srl", "sra", "or", "and"):
            rd, rs1, rs2 = reg(rest[0]), reg(rest[1]), reg(rest[2])
            f7 = {"sub": 0x20, "sra": 0x20}.get(mnemonic, 0)
            f3 = {"add": 0, "sub": 0, "sll": 1, "slt": 2, "sltu": 3,
                  "xor": 4, "srl": 5, "sra": 5, "or": 6, "and": 7}[mnemonic]
            output.append(enc_r(f7, rs2, rs1, f3, rd, 0x33))
        elif mnemonic in ("lw", "lh", "lb", "lhu", "lbu"):
            rd, addr = reg(rest[0]), rest[1]
            m = re.match(r"^(-?\d+)\((\w+)\)$", addr)
            im, rs1 = imm(m.group(1)), reg(m.group(2))
            f3 = {"lw": 2, "lh": 1, "lb": 0, "lhu": 5, "lbu": 4}[mnemonic]
            output.append(enc_i(im, rs1, f3, rd, 0x03))
        elif mnemonic in ("sw", "sh", "sb"):
            rs2, addr = reg(rest[0]), rest[1]
            m = re.match(r"^(-?\d+)\((\w+)\)$", addr)
            im, rs1 = imm(m.group(1)), reg(m.group(2))
            f3 = {"sw": 2, "sh": 1, "sb": 0}[mnemonic]
            output.append(enc_s(im, rs2, rs1, f3, 0x23))
        elif mnemonic in ("beq", "bne", "blt", "bge", "bltu", "bgeu"):
            rs1, rs2, lab = reg(rest[0]), reg(rest[1]), rest[2]
            target = labels[lab]
            off = target - pc
            f3 = {"beq": 0, "bne": 1, "blt": 4, "bge": 5, "bltu": 6, "bgeu": 7}[mnemonic]
            output.append(enc_b(off, rs2, rs1, f3, 0x63))
        elif mnemonic == "jal":
            rd, lab = reg(rest[0]), rest[1]
            target = labels[lab]
            off = target - pc
            output.append(enc_j(off, rd, 0x6F))
        elif mnemonic == "j":
            target = labels[rest[0]]
            off = target - pc
            output.append(enc_j(off, 0, 0x6F))
        elif mnemonic == "jalr":
            rd, rs1, im = reg(rest[0]), reg(rest[1]), imm(rest[2])
            output.append(enc_i(im, rs1, 0, rd, 0x67))
        elif mnemonic == "lui":
            rd, im = reg(rest[0]), imm(rest[1])
            output.append(enc_u(im & 0xFFFFF, rd, 0x37))
        elif mnemonic == "auipc":
            rd, im = reg(rest[0]), imm(rest[1])
            output.append(enc_u(im & 0xFFFFF, rd, 0x17))
        elif mnemonic == "fence":
            output.append(0x0000000F)
        elif mnemonic == "ecall":
            output.append(0x00000073)
        elif mnemonic == "ebreak":
            output.append(0x00100073)
        elif mnemonic == "mret":
            output.append(0x30200073)
        elif mnemonic == "la":
            # la rd, label → lui rd,hi; addi rd,rd,lo（绝对地址 = 基址 + 标签偏移）
            rd, lab = reg(rest[0]), rest[1]
            target = labels[lab] + BASE
            hi = (target + 0x800) >> 12        # 高 20 位（带舍入）
            lo = target - (hi << 12)           # 低 12 位
            output.append(enc_u(hi & 0xFFFFF, rd, 0x37))   # lui rd, hi
            output.append(enc_i(lo, rd, 0, rd, 0x13))      # addi rd, rd, lo
        elif mnemonic in ("csrrw", "csrrs", "csrrc", "csrrwi", "csrrsi", "csrrci"):
            # csr* rd, csr, rs1/uimm
            rd, csrn = reg(rest[0]), csr(rest[1])
            f3 = {"csrrw": 1, "csrrs": 2, "csrrc": 3,
                  "csrrwi": 5, "csrrsi": 6, "csrrci": 7}[mnemonic]
            if mnemonic in ("csrrwi", "csrrsi", "csrrci"):
                src = imm(rest[2]) & 0x1F      # uimm：5 位立即数
            else:
                src = reg(rest[2])             # rs1 寄存器编号
            output.append(enc_i(csrn, src, f3, rd, 0x73))
        elif mnemonic == ".word":
            output.append(imm(rest[0]) & 0xFFFFFFFF)
        else:
            raise ValueError(f"不支持的助记符: {mnemonic}（第 {line} 行）")
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
