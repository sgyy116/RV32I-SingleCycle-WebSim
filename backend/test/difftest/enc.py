# -*- coding: utf-8 -*-
"""
enc.py —— 差分测试用的**独立**机器码编码器与微型汇编器

为什么不用 backend/python/asm.py：
  asm.py 是**被测产品的一部分**（它就是本项目的编译器）。差分测试要检验后端，
  语料若由 asm.py 生成，asm.py 的编码错误会被原样带进语料，两边同时错 ⇒ 永远测不出来。
  所以这里另写一份纯编码器，依据只有 RISC-V Unprivileged ISA 规范的位域表。
  它同时也是「非法编码」语料唯一的来源——asm.py 表达不了保留 funct7 / RV32M / 非法 opcode。

独立性声明：本文件的位域布局全部依据 RISC-V 规范的编码表书写，
编写时没有阅读 backend/cpp/src/rv_disasm.cpp 的编码分支。

约定：
  - 立即数一律按**规范要求的位域**重新排布，不做「先拼后截」的偷懒写法，
    这样非法/越界立即数会以规范的方式被截断，与实现无关。
  - 所有函数返回 0..0xFFFFFFFF 的整数。
"""

MASK32 = 0xFFFFFFFF


def _u32(v):
    return v & MASK32


# ---------------------------------------------------------------------------
# 六个基本格式
# ---------------------------------------------------------------------------

def r(funct7, rs2, rs1, funct3, rd, opcode):
    return _u32((funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode)


def i(imm, rs1, funct3, rd, opcode):
    return _u32(((imm & 0xFFF) << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode)


def s(imm, rs2, rs1, funct3, opcode):
    imm = imm & 0xFFF
    return _u32(((imm >> 5) << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12)
                | ((imm & 0x1F) << 7) | opcode)


def b(imm, rs2, rs1, funct3, opcode):
    """B 型：bit31=imm[12]，bit30:25=imm[10:5]，bit11:8=imm[4:1]，bit7=imm[11]"""
    imm &= 0x1FFF
    b12 = (imm >> 12) & 1
    b11 = (imm >> 11) & 1
    b10_5 = (imm >> 5) & 0x3F
    b4_1 = (imm >> 1) & 0xF
    return _u32((b12 << 31) | (b10_5 << 25) | (rs2 << 20) | (rs1 << 15)
                | (funct3 << 12) | (b4_1 << 8) | (b11 << 7) | opcode)


def u(imm20, rd, opcode):
    """U 型：imm 高 20 位直接落在 bit31:12"""
    return _u32(((imm20 & 0xFFFFF) << 12) | (rd << 7) | opcode)


def j(imm, rd, opcode):
    """J 型：bit31=imm[20]，bit30:21=imm[10:1]，bit20=imm[11]，bit19:12=imm[19:12]"""
    imm &= 0x1FFFFF
    b20 = (imm >> 20) & 1
    b19_12 = (imm >> 12) & 0xFF
    b11 = (imm >> 11) & 1
    b10_1 = (imm >> 1) & 0x3FF
    return _u32((b20 << 31) | (b10_1 << 21) | (b11 << 20) | (b19_12 << 12)
                | (rd << 7) | opcode)


# ---------------------------------------------------------------------------
# opcode 常量
# ---------------------------------------------------------------------------
OP_LUI     = 0b0110111
OP_AUIPC   = 0b0010111
OP_JAL     = 0b1101111
OP_JALR    = 0b1100111
OP_BRANCH  = 0b1100011
OP_LOAD    = 0b0000011
OP_STORE   = 0b0100011
OP_IMM     = 0b0010011
OP_REG     = 0b0110011
OP_MISC    = 0b0001111
OP_SYSTEM  = 0b1110011


# ---------------------------------------------------------------------------
# 逐条指令（只写差分测试要用到的；每条都对应规范里的一行）
# ---------------------------------------------------------------------------

def lui(rd, imm20):          return u(imm20, rd, OP_LUI)
def auipc(rd, imm20):        return u(imm20, rd, OP_AUIPC)
def jal(rd, imm):            return j(imm, rd, OP_JAL)
def jalr(rd, rs1, imm):      return i(imm, rs1, 0b000, rd, OP_JALR)

def beq(rs1, rs2, imm):      return b(imm, rs2, rs1, 0b000, OP_BRANCH)
def bne(rs1, rs2, imm):      return b(imm, rs2, rs1, 0b001, OP_BRANCH)
def blt(rs1, rs2, imm):      return b(imm, rs2, rs1, 0b100, OP_BRANCH)
def bge(rs1, rs2, imm):      return b(imm, rs2, rs1, 0b101, OP_BRANCH)
def bltu(rs1, rs2, imm):     return b(imm, rs2, rs1, 0b110, OP_BRANCH)
def bgeu(rs1, rs2, imm):     return b(imm, rs2, rs1, 0b111, OP_BRANCH)

def lb(rd, rs1, imm):        return i(imm, rs1, 0b000, rd, OP_LOAD)
def lh(rd, rs1, imm):        return i(imm, rs1, 0b001, rd, OP_LOAD)
def lw(rd, rs1, imm):        return i(imm, rs1, 0b010, rd, OP_LOAD)
def lbu(rd, rs1, imm):       return i(imm, rs1, 0b100, rd, OP_LOAD)
def lhu(rd, rs1, imm):       return i(imm, rs1, 0b101, rd, OP_LOAD)

def sb(rs2, rs1, imm):       return s(imm, rs2, rs1, 0b000, OP_STORE)
def sh(rs2, rs1, imm):       return s(imm, rs2, rs1, 0b001, OP_STORE)
def sw(rs2, rs1, imm):       return s(imm, rs2, rs1, 0b010, OP_STORE)

def addi(rd, rs1, imm):      return i(imm, rs1, 0b000, rd, OP_IMM)
def slti(rd, rs1, imm):      return i(imm, rs1, 0b010, rd, OP_IMM)
def sltiu(rd, rs1, imm):     return i(imm, rs1, 0b011, rd, OP_IMM)
def xori(rd, rs1, imm):      return i(imm, rs1, 0b100, rd, OP_IMM)
def ori(rd, rs1, imm):       return i(imm, rs1, 0b110, rd, OP_IMM)
def andi(rd, rs1, imm):      return i(imm, rs1, 0b111, rd, OP_IMM)
def slli(rd, rs1, sh):       return i(sh & 0x1F, rs1, 0b001, rd, OP_IMM)
def srli(rd, rs1, sh):       return i(sh & 0x1F, rs1, 0b101, rd, OP_IMM)
def srai(rd, rs1, sh):       return i((0x20 << 5) | (sh & 0x1F), rs1, 0b101, rd, OP_IMM)

def add(rd, rs1, rs2):       return r(0x00, rs2, rs1, 0b000, rd, OP_REG)
def sub(rd, rs1, rs2):       return r(0x20, rs2, rs1, 0b000, rd, OP_REG)
def sll(rd, rs1, rs2):       return r(0x00, rs2, rs1, 0b001, rd, OP_REG)
def slt(rd, rs1, rs2):       return r(0x00, rs2, rs1, 0b010, rd, OP_REG)
def sltu(rd, rs1, rs2):      return r(0x00, rs2, rs1, 0b011, rd, OP_REG)
def xor(rd, rs1, rs2):       return r(0x00, rs2, rs1, 0b100, rd, OP_REG)
def srl(rd, rs1, rs2):       return r(0x00, rs2, rs1, 0b101, rd, OP_REG)
def sra(rd, rs1, rs2):       return r(0x20, rs2, rs1, 0b101, rd, OP_REG)
def or_(rd, rs1, rs2):       return r(0x00, rs2, rs1, 0b110, rd, OP_REG)
def and_(rd, rs1, rs2):      return r(0x00, rs2, rs1, 0b111, rd, OP_REG)

def fence():                 return i(0, 0, 0b000, 0, OP_MISC)
def fence_i():               return i(0, 0, 0b001, 0, OP_MISC)

def ecall():                 return 0x00000073
def ebreak():                return 0x00100073
def mret():                  return 0x30200073

def csrrw(rd, csr, rs1):     return i(csr, rs1, 0b001, rd, OP_SYSTEM)
def csrrs(rd, csr, rs1):     return i(csr, rs1, 0b010, rd, OP_SYSTEM)
def csrrc(rd, csr, rs1):     return i(csr, rs1, 0b011, rd, OP_SYSTEM)
def csrrwi(rd, csr, uimm):   return i(csr, uimm & 0x1F, 0b101, rd, OP_SYSTEM)
def csrrsi(rd, csr, uimm):   return i(csr, uimm & 0x1F, 0b110, rd, OP_SYSTEM)
def csrrci(rd, csr, uimm):   return i(csr, uimm & 0x1F, 0b111, rd, OP_SYSTEM)


# ---------------------------------------------------------------------------
# CSR 地址
# ---------------------------------------------------------------------------
CSR_MSTATUS   = 0x300
CSR_MISA      = 0x301
CSR_MIE       = 0x304
CSR_MTVEC     = 0x305
CSR_MSCRATCH  = 0x340
CSR_MEPC      = 0x341
CSR_MCAUSE    = 0x342
CSR_MTVAL     = 0x343
CSR_MIP       = 0x344
CSR_MTIMECMP  = 0x780   # 本项目自定义（非 RISC-V 标准）
CSR_CYCLE     = 0xC00
CSR_TIME      = 0xC01
CSR_INSTRET   = 0xC02

# 寄存器 ABI 名（只为了语料可读）
X = {n: i for i, n in enumerate(
    "zero ra sp gp tp t0 t1 t2 s0 s1 a0 a1 a2 a3 a4 a5 a6 a7 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 t3 t4 t5 t6".split())}


# ---------------------------------------------------------------------------
# 微型汇编器：两遍，标签 + 数据字
# ---------------------------------------------------------------------------

class Program:
    """
    一个测试程序的构造器。

    代码与数据都摆在同一个连续映像里（模拟器把它整块加载到 0x80000000），
    因此「标号地址」= BASE + 4 * 下标，语料侧完全确定，不必询问模拟器。

    每个位置存一个闭包 `fn(addr, labels) -> word`；带标签的跳转在闭包里算相对偏移，
    所以标号可以前向引用，不需要 fixup 表。
    """

    BASE = 0x80000000

    def __init__(self):
        self.items = []      # [callable(addr, labels) -> word]
        self.labels = {}

    # ---- 位置与标号 ----
    def label(self, name):
        if name in self.labels:
            raise ValueError(f"标号重复: {name}")
        self.labels[name] = len(self.items)
        return self

    def here(self):
        """当前地址（只在 assemble 之后正确，用于少量需要绝对地址的场合）"""
        return self.BASE + 4 * len(self.items)

    # ---- 发射 ----
    def word(self, w):
        self.items.append(lambda a, l, w=_u32(w): w)
        return self

    def _emit(self, fn):
        self.items.append(fn)
        return self

    def nop(self):
        return self.word(addi(0, 0, 0))

    # 带标签的相对跳转：偏移 = 目标地址 - 本条地址
    def _branch(self, builder, rs1, rs2, label):
        def fn(addr, labels):
            if label not in labels:
                raise ValueError(f"未定义标号: {label}")
            return builder(rs2, rs1, labels[label] - addr)
        return self._emit(fn)

    def beq_(self, rs1, rs2, label):   return self._branch(beq, rs1, rs2, label)
    def bne_(self, rs1, rs2, label):   return self._branch(bne, rs1, rs2, label)
    def blt_(self, rs1, rs2, label):   return self._branch(blt, rs1, rs2, label)
    def bge_(self, rs1, rs2, label):   return self._branch(bge, rs1, rs2, label)
    def bltu_(self, rs1, rs2, label):  return self._branch(bltu, rs1, rs2, label)
    def bgeu_(self, rs1, rs2, label):  return self._branch(bgeu, rs1, rs2, label)

    def jal_(self, rd, label):
        def fn(addr, labels):
            return jal(rd, labels[label] - addr)
        return self._emit(fn)

    def la_(self, rd, label):
        """la rd, label —— 用 lui+addi（%hi 带进位补偿）取标号的**绝对地址**"""
        def hi_fn(addr, labels):
            target = labels[label]
            return lui(rd, ((target + 0x800) >> 12) & 0xFFFFF)
        def lo_fn(addr, labels):
            target = labels[label]
            hi = ((target + 0x800) >> 12) & 0xFFFFF
            return addi(rd, rd, target - (hi << 12))
        self._emit(hi_fn)
        self._emit(lo_fn)
        return self

    # 绝对地址立即数（地址在 assemble 前未知时用 la_）

    # ---- 组装 ----
    def assemble(self):
        labels = {name: self.BASE + 4 * i for name, i in self.labels.items()}
        words = []
        for idx, fn in enumerate(self.items):
            words.append(_u32(fn(self.BASE + 4 * idx, labels)))
        return words, labels

    def write(self, path):
        words, _ = self.assemble()
        with open(path, 'wb') as f:
            for w in words:
                f.write(w.to_bytes(4, 'little'))
        return words


def lui_addi(rd, value):
    """把任意 32 位数装进 rd，返回 [word, ...]（教科书 li 展开）。

    关键在 %lo：`lui` 的 20 位立即数**会被符号扩展**，所以 0x7FFF_F800..0x7FFF_FFFF
    这一段的 hi<<12 会大于 value，直接相减得不出 12 位内的 lo。
    正确做法是 lo 取 value 的低 12 位再做符号解释（等价于 %lo 的规范定义）。
    """
    v = value & MASK32
    if -2048 <= value <= 2047:
        return [addi(rd, X['zero'], value)]
    hi = ((v + 0x800) >> 12) & 0xFFFFF
    lo = v & 0xFFF
    if lo & 0x800:
        lo -= 0x1000
    out = [lui(rd, hi)]
    if lo:
        out.append(addi(rd, rd, lo))
    return out


def li_small(prog, rd, value):
    """同 lui_addi，但直接发射进 Program"""
    for w in lui_addi(rd, value):
        prog.word(w)
    return prog
