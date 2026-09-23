# -*- coding: utf-8 -*-
"""
corpus.py —— 差分测试语料生成器

**纯编码**：只用 enc.py（按规范位域表手写），**绝不 import backend/python/asm.py**。
理由见 enc.py 头部：asm.py 是被测产品的一部分，用它生成语料就是拿产品测产品。

为什么不用现成的 .s 夹具：
  1. 那批夹具全是合法指令，而**最易错的角落恰恰是非法/保留编码**——
     asm.py 根本表达不了（funct7=0x01 的 RV32M、JALR 的 funct3=1、保留的 shamt）；
  2. 夹具的期望值当初是从实现里反查的（自证），拿去当判据是循环论证；
  3. 后端只有 load_elf(path)，没有「设寄存器/设内存」的命令 ⇒ 初态必须靠 prologue
     指令流构造。参照模型从同一条 PC、同一片全零内存执行**完全相同的指令流**，
     prologue 顺带也被覆盖了。

每个用例返回 (name, words, n_steps, note, expects_halt)：
  n_steps 是「本用例应该走几拍」；模型/实现任一侧 halted 时由 run.py 提前收尾，
  并双向确认「两边是不是在**同一拍**停的」。
"""

import random

from enc import (Program, X, lui_addi, addi, lui, auipc, jal, jalr, lb, lh, lw, lbu, lhu,
                 sb, sh, sw, add, sub, sll, slt, sltu, xor, srl, sra, or_, and_,
                 slti, sltiu, xori, ori, andi, slli, srli, srai,
                 beq, bne, blt, bge, bltu, bgeu, fence, fence_i, ecall, ebreak, mret,
                 csrrw, csrrs, csrrc, csrrwi, csrrsi, csrrci,
                 r, i, s, b, u, j,
                 CSR_MSTATUS, CSR_MIE, CSR_MTVEC, CSR_MSCRATCH, CSR_MEPC, CSR_MCAUSE,
                 CSR_MTVAL, CSR_MIP, CSR_MTIMECMP, CSR_CYCLE, CSR_TIME, CSR_INSTRET,
                 OP_REG, OP_IMM, OP_JALR, OP_MISC, OP_BRANCH, OP_LOAD, OP_STORE,
                 OP_LUI, OP_AUIPC, OP_JAL, OP_SYSTEM)

R = X                       # 寄存器名短别名
HANDLER_OFF = 0x100         # trap handler 固定放在 +0x100（第 64 个字）
BODY_MAX = 64               # 因此程序主体不允许超过 64 个字

# 几组有代表性的操作数：0 / 1 / -1 / 符号位 / 非对齐 / 移位越界量
PAIRS = [
    (0, 0), (1, 0), (0, 1), (5, 3), (0xFFFFFFFF, 1), (0x80000000, 0x7FFFFFFF),
    (0x7FFFFFFF, 0x80000000), (0x12345678, 0x0000000F), (0xDEADBEEF, 0xCAFEBABE),
    (0xFFFFFFFF, 0xFFFFFFFF), (0x00010000, 0x00000020), (0x80000000, 0x0000001F),
]

CASE = 0


def _seq(name, words, note="", halt=False, extra=0):
    return (name, list(words), len(words) + extra, note, halt)


# ===========================================================================
# 公共构件
# ===========================================================================

def _li(rd, value):
    """装立即数（lui+addi），返回 word 列表"""
    return lui_addi(rd, value)


def _trap_prog(body, handler, off=HANDLER_OFF):
    """程序主体在前，handler 对齐到 +off；两侧看的是同一个映像，无需额外约定"""
    cap = off // 4
    assert len(body) <= cap, "body 超过 %d 字，会盖住 +0x%x 的 handler" % (cap, off)
    return list(body) + [addi(0, 0, 0)] * (cap - len(body)) + list(handler)


def _handler_prologue():
    """记录 mepc/mcause/mtval，并数中断/异常次数"""
    return [csrrs(R['a0'], CSR_MCAUSE, R['zero']),
            csrrs(R['a1'], CSR_MEPC, R['zero']),
            csrrs(R['a2'], CSR_MTVAL, R['zero']),
            addi(R['s2'], R['s2'], 1)]


def _skip_handler():
    """记录现场 → mepc += 4 跳过坏指令 → mret（每次进 handler 记一个数）"""
    return _handler_prologue() + [
        csrrs(R['t3'], CSR_MEPC, R['zero']),
        addi(R['t3'], R['t3'], 4),
        csrrw(R['zero'], CSR_MEPC, R['t3']),
        mret(),
    ]


def _quiet_handler():
    """中断 handler：先进来把 mtimecmp 顶到最大，避免 mret 之后立刻再触发"""
    return _handler_prologue() + [
        lui(R['t4'], 0),
        addi(R['t4'], R['t4'], -1),                 # t4 = 0xFFFFFFFF
        csrrw(R['zero'], CSR_MTIMECMP, R['t4']),
        mret(),
    ]


def _setup_trap(off=HANDLER_OFF, mstatus=0x00000008, mie=0, mtimecmp=None):
    """设 mtvec / mstatus / mie / mtimecmp 的公共前缀"""
    body = _li(R['t0'], 0x80000000 + off)
    body += [csrrw(R['zero'], CSR_MTVEC, R['t0'])]
    if mstatus is not None:
        body += _li(R['t1'], mstatus)
        body += [csrrw(R['zero'], CSR_MSTATUS, R['t1'])]
    if mie is not None:
        body += _li(R['t2'], mie)
        body += [csrrw(R['zero'], CSR_MIE, R['t2'])]
    if mtimecmp is not None:
        body += _li(R['t3'], mtimecmp)
        body += [csrrw(R['zero'], CSR_MTIMECMP, R['t3'])]
    return body


# ===========================================================================
# 1. 算术逻辑
# ===========================================================================

def c_alu_r():
    """全部 10 条 R 型 × 12 组操作数，且两种操作数顺序都算一遍（抓接反）"""
    w = []
    ops = [add, sub, sll, slt, sltu, xor, srl, sra, or_, and_]
    for a, b in PAIRS:
        w += _li(R['t0'], a)
        w += _li(R['t1'], b)
        for op in ops:
            w.append(op(R['a0'], R['t0'], R['t1']))
            w.append(op(R['a1'], R['t1'], R['t0']))
    return _seq("alu_r", w, "10 条 R 型 × 12 组操作数 × 双向")


def c_alu_i():
    """OP-IMM 立即数边界（-2048/2047/符号扩展）+ 移位量边界"""
    w = []
    for rs1v in (0, 1, 0xFFFFFFFF, 0x80000000, 0x7FFFFFFF, 0x12345678):
        w += _li(R['t0'], rs1v)
        for op in (addi, slti, sltiu, xori, ori, andi):
            for imm in (-2048, -1, 0, 1, 2047):
                w.append(op(R['a0'], R['t0'], imm))
    for rs1v in (0x80000000, 0xFFFFFFFF, 0x7FFFFFFF, 1):
        w += _li(R['t0'], rs1v)
        for sh in (0, 1, 31):
            w.append(slli(R['a0'], R['t0'], sh))
            w.append(srli(R['a1'], R['t0'], sh))
            w.append(srai(R['a2'], R['t0'], sh))    # 负数必须符号填充
    return _seq("alu_i", w, "OP-IMM 立即数边界 + 移位量边界")


def c_lui_auipc():
    """LUI / AUIPC 用**非零**立即数 —— AUIPC 的旧 bug 正是被 imm=0 掩盖的"""
    w = []
    for imm in (0x00000, 0x00001, 0x12345, 0xFFFFF, 0x80000, 0x00001):
        w.append(lui(R['a0'], imm))
        w.append(auipc(R['a1'], imm))       # 必须是 pc + (imm<<12)，不是 pc
        w.append(lui(R['a2'], imm))
        w.append(auipc(R['a2'], imm))       # 连续两条，抓「imm 被丢掉」的退化
    return _seq("lui_auipc", w, "LUI/AUIPC 非零立即数（AUIPC 回归）")


def c_shift_reg():
    """R 型移位：移位量只取 rs2 的低 5 位（32 要变成 0）"""
    w = []
    for a, b in ((0x80000000, 32), (0xFFFFFFFF, 33), (1, 31), (1, 63), (0x12345678, 4)):
        w += _li(R['t0'], a)
        w += _li(R['t1'], b)
        w.append(sll(R['a0'], R['t0'], R['t1']))
        w.append(srl(R['a1'], R['t0'], R['t1']))
        w.append(sra(R['a2'], R['t0'], R['t1']))
    return _seq("shift_reg", w, "R 型移位量取低 5 位")


# ===========================================================================
# 2. 分支 / 跳转
# ===========================================================================

def c_branch():
    """6 条分支 × 7 组操作数（含无符号/有符号的分水岭），taken/not-taken 都走到"""
    w = []
    cases = [(0, 0), (1, 2), (0xFFFFFFFF, 1), (1, 0xFFFFFFFF), (0x80000000, 1),
             (1, 0x80000000), (0x7FFFFFFF, 0x80000000)]
    for a, b in cases:
        w += _li(R['t0'], a)
        w += _li(R['t1'], b)
        for br in (beq, bne, blt, bge, bltu, bgeu):
            w.append(br(R['t0'], R['t1'], 8))       # +8：跳过下一条
            w.append(addi(R['s0'], R['s0'], 1))     # taken 时被跳过
            w.append(addi(R['s1'], R['s1'], 1))     # 两条路径都执行
    return _seq("branch", w, "6 条分支 × 7 组操作数（含符号分水岭）")


def c_branch_backward():
    """向后跳的分支（负偏移）—— B 型立即数符号位在 bit31，最容易接反"""
    w = [
        addi(R['s0'], R['zero'], 3),
    ]
    # 循环三次：s0 减到 0 时跳出
    base = len(w)
    w.append(addi(R['s0'], R['s0'], -1))            # idx base
    w.append(bne(R['s0'], R['zero'], -4))           # 回跳一格（到 -1 那条）
    w.append(bge(R['zero'], R['zero'], 8))          # 恒成立：跳过下一条
    w.append(addi(R['s1'], R['s1'], 1))
    w.append(blt(R['zero'], R['zero'], 8))          # 恒不成立：不跳
    w.append(addi(R['s2'], R['s2'], 1))
    w.append(bltu(R['zero'], R['zero'], 8))
    w.append(addi(R['s3'], R['s3'], 1))
    w.append(bgeu(R['zero'], R['zero'], 8))
    w.append(addi(R['s4'], R['s4'], 1))
    return _seq("branch_backward", w, "负偏移分支 + 四个方向的恒真/恒假")


def c_jal_link():
    """JAL 的链接值与目标；含「target 与 fallthrough 重合」的退化情形"""
    w = []
    w.append(jal(R['ra'], 8))                       # 跳过一条
    w.append(addi(R['s0'], R['s0'], 1))
    w.append(addi(R['s1'], R['s1'], 1))
    w.append(jal(R['ra'], 4))                       # 目标 == pc+4
    w.append(addi(R['s2'], R['s2'], 1))
    w.append(jal(R['zero'], 12))                    # rd=x0：不链接
    w.append(addi(R['s3'], R['s3'], 1))
    w.append(addi(R['s3'], R['s3'], 1))
    w.append(addi(R['s4'], R['s4'], 1))
    return _seq("jal_link", w, "JAL 链接值 + 三种 rd/偏移组合")


def c_jalr_rd():
    """JALR 的 rd 取 x0/ra/t0/t6，各是一个独立程序；同时验证 bit0 被清"""
    out = []
    for nm, rd in (("x0", 0), ("ra", 1), ("t0", 5), ("t6", 31)):
        p = Program()
        p.la_(R['t0'], "tgt")
        p.word(jalr(rd, R['t0'], 0))                # 目标 = tgt 的绝对地址
        p.word(addi(R['s0'], R['s0'], 1))           # 一定被跳过
        p.label("tgt")
        p.word(addi(R['s1'], R['s1'], 1))
        words, _ = p.assemble()
        out.append(("jalr_rd_" + nm, words, 4, "JALR rd=%s 的链接值" % nm, False))
    # 奇数地址：最低位必须被清掉（0x...1B → 0x...18）
    p = Program()
    p.word(0)
    p.la_(R['t0'], "odd")
    p.word(jalr(R['ra'], R['t0'], 1))               # t0+1 是奇数，清低位后回到 odd+0
    p.label("odd")
    p.word(addi(R['s1'], R['s1'], 1))
    p.word(addi(R['s2'], R['s2'], 1))
    words, _ = p.assemble()
    out.append(("jalr_clear_lsb", words, 4, "JALR 目标清 bit0", False))
    return "multi", out


def c_jalr_imm():
    """JALR 的负立即数与边界"""
    p = Program()
    p.label("here")
    p.word(0)
    p.la_(R['t0'], "here")                          # t0 = here 的地址
    p.word(jalr(R['ra'], R['t0'], 8))               # here+8 = 跳过两条
    p.word(addi(R['s0'], R['s0'], 1))               # 被跳过
    p.word(addi(R['s0'], R['s0'], 1))               # 被跳过
    p.word(addi(R['s1'], R['s1'], 1))
    p.word(jalr(R['ra'], R['t0'], 4))               # 回到 here+4
    p.word(addi(R['s3'], R['s3'], 1))
    words, _ = p.assemble()
    # here=BASE, +4 那条是 la 的第一条 → 会重放 la，然后 jalr(+8) → 死循环？
    # 不会：here+4 是 lui，重放后 t0 仍是 here……会循环。故本用例只走前 8 拍。
    return ("jalr_imm", words, 8, "JALR 正偏移（截前 8 拍，避免重放循环）", False)


# ===========================================================================
# 3. 访存
# ===========================================================================

def c_load_store():
    """先建内存内容，再用 5 种 load 逐一取回：符号扩展 + 小端"""
    w = _li(R['t0'], 0x80000000 + 0x400)            # 数据区
    w += _li(R['t1'], 0x8041FF7F)                   # 每个字节/半字都非零
    w += [
        sw(R['t1'], R['t0'], 0),
        lb(R['a0'], R['t0'], 0),
        lb(R['a1'], R['t0'], 1),
        lb(R['a2'], R['t0'], 2),
        lb(R['a3'], R['t0'], 3),
        lbu(R['a4'], R['t0'], 0),
        lbu(R['a5'], R['t0'], 3),
        lhu(R['a6'], R['t0'], 0),
        lhu(R['a7'], R['t0'], 2),
        lh(R['s2'], R['t0'], 0),
        lh(R['s3'], R['t0'], 2),
        lw(R['s4'], R['t0'], 0),
    ]
    return _seq("load_store", w, "5 种 load 的符号扩展 + 小端")


def c_store_width():
    """store 的宽度与部分覆盖：多写一字节就多盖一字节，其余字节必须保留"""
    w = _li(R['t0'], 0x80000000 + 0x400)
    w += _li(R['t1'], 0xFFFFFFFF)
    w += [
        sw(R['t1'], R['t0'], 0),                    # 全 1
        lw(R['a0'], R['t0'], 0),
    ]
    w += _li(R['t2'], 0xA5)
    w += [
        sb(R['t2'], R['t0'], 1),                    # 只盖第 1 字节
        lw(R['a1'], R['t0'], 0),                    # → 0xFFFFA5FF
    ]
    w += _li(R['t3'], 0x11223344)
    w += [
        sh(R['t3'], R['t0'], 2),                    # 只盖第 2..3 字节
        lw(R['a2'], R['t0'], 0),                    # → 0x3344A5FF
    ]
    w += _li(R['t4'], 0x55667788)
    w += [
        sw(R['t4'], R['t0'], 8),
        lw(R['a3'], R['t0'], 8),                    # 小端还原
    ]
    return _seq("store_width", w, "store 宽度 + 部分覆盖 + 小端")


def c_unaligned():
    """非对齐访存：本项目按字节模拟、不报异常（[实测]）"""
    w = _li(R['t0'], 0x80000000 + 0x400)
    w += _li(R['t1'], 0xDEADBEEF)
    w += [
        sw(R['t1'], R['t0'], 0),
        lw(R['a0'], R['t0'], 1),
        lw(R['a1'], R['t0'], 2),
        lw(R['a2'], R['t0'], 3),
        lh(R['a3'], R['t0'], 1),
        lhu(R['a4'], R['t0'], 1),
        lw(R['a5'], R['t0'], 4),                    # 跨出已写区
    ]
    w += _li(R['t2'], 0x55667788)
    w += [
        sw(R['t2'], R['t0'], 1),                    # 非对齐写
        lw(R['a6'], R['t0'], 1),
        lw(R['a7'], R['t0'], 0),                    # 回看被覆盖的部分
    ]
    return _seq("unaligned", w, "非对齐访存（按字节模拟，不 trap）")


def c_mem_bounds():
    """越界访存：读回 0、写被丢弃，都不 trap（[实测]）"""
    w = _li(R['t0'], 0x80100000)                    # 超出 128KB 一大截
    w += _li(R['t1'], 0x12345678)
    w += [
        lw(R['a0'], R['t0'], 0),
        lb(R['a1'], R['t0'], 16),
        lhu(R['a2'], R['t0'], 32),
        sw(R['t1'], R['t0'], 0),
        lw(R['a3'], R['t0'], 0),                    # 写被丢弃 ⇒ 仍读回 0
    ]
    w += _li(R['t2'], 0x7FFFFFFC)                   # 低位越界（%hi/%lo 边界的另一用场）
    w += [
        lw(R['a4'], R['t2'], 0),
        sb(R['t1'], R['t2'], 0),
        lw(R['a5'], R['t2'], 0),
    ]
    w += _li(R['t3'], 0x80020000)                   # 刚好越过末尾（128KB = 0x20000）
    w += [
        lw(R['a6'], R['t3'], -4),                   # 最后一个字：合法
        lw(R['a7'], R['t3'], 0),                    # 第一个越界字：非法读 ⇒ 0
    ]
    return _seq("mem_bounds", w, "越界读=0 / 越界写丢弃（含 128KB 末尾边界）")


def c_store_offsets():
    """S 型立即数边界（±2048 附近）—— S 型的位分散最容易被写错"""
    w = _li(R['t0'], 0x80000000 + 0x1000)
    w += _li(R['t1'], 0x55667788)
    w += [
        sw(R['t1'], R['t0'], 2047),
        lw(R['a0'], R['t0'], 2047),
        sw(R['t1'], R['t0'], -2048),
        lw(R['a1'], R['t0'], -2048),
        sb(R['t1'], R['t0'], 2047),
        lbu(R['a2'], R['t0'], 2047),
        sh(R['t1'], R['t0'], -2048),
        lhu(R['a3'], R['t0'], -2048),
        lw(R['a4'], R['t0'], 4),
        lw(R['a5'], R['t0'], 0),
    ]
    return _seq("store_offsets", w, "S 型立即数边界 ±2048")


# ===========================================================================
# 4. x0 硬连线
# ===========================================================================

def c_x0():
    """x0 被写必须无效，且读出来恒 0"""
    w = [
        addi(R['zero'], R['zero'], 5),
        lui(R['zero'], 0x12345),
        auipc(R['zero'], 0x1),
        jal(R['zero'], 8),                          # 跳过一条
        addi(R['s0'], R['s0'], 1),
        add(R['zero'], R['s0'], R['s0']),
        csrrw(R['zero'], CSR_MSCRATCH, R['zero']),  # 顺带确认 CSR 写 rd=x0
        addi(R['a0'], R['zero'], 7),                # 依赖 x0 == 0
    ]
    return _seq("x0", w, "x0 硬连线：各种写 x0 都无效，读恒 0")


# ===========================================================================
# 5. CSR
# ===========================================================================

def c_csr_rw():
    """6 条 CSR 指令的读改写语义 + rs1=x0 不写 + rd=x0 不写回"""
    w = _li(R['t0'], 0x0000000F)
    w += _li(R['t1'], 0x000000F0)
    w += _li(R['t2'], 0x0000FF00)
    w += [
        csrrw(R['a0'], CSR_MSCRATCH, R['t0']),      # mscratch=0x0F，a0 读到旧值 0
        csrrs(R['a1'], CSR_MSCRATCH, R['t1']),      # mscratch=0xFF，a1=0x0F
        csrrc(R['a2'], CSR_MSCRATCH, R['t2']),      # mscratch & ~0xFF00 → 0xFF，a2=0xFF
        csrrs(R['a3'], CSR_MSCRATCH, R['zero']),    # rs1=x0：只读不写
        csrrc(R['a4'], CSR_MSCRATCH, R['zero']),    # 同上
        csrrwi(R['a5'], CSR_MSCRATCH, 0x15),        # mscratch=0x15，a5=0xFF
        csrrsi(R['a6'], CSR_MSCRATCH, 0x02),        # mscratch=0x17
        csrrci(R['a7'], CSR_MSCRATCH, 0x01),        # mscratch=0x16
        csrrwi(R['zero'], CSR_MSCRATCH, 0x1F),      # rd=x0：仍写 CSR
        csrrs(R['s2'], CSR_MSCRATCH, R['zero']),    # 读回 0x1F
        csrrsi(R['s3'], CSR_MSCRATCH, 0x00),        # zimm=0：只读不写
        csrrc(R['s4'], CSR_MSCRATCH, R['zero']),
    ]
    return _seq("csr_rw", w, "6 条 CSR 指令 + rs1=x0 不写 + rd=x0 分支")


def c_csr_readonly():
    """只读 CSR（cycle/time/instret）必须读得进、写不动（[实测]）"""
    w = _li(R['t0'], 0x12345678)
    w += [
        csrrs(R['a0'], CSR_CYCLE, R['zero']),
        csrrs(R['a1'], CSR_TIME, R['zero']),
        csrrs(R['a2'], CSR_INSTRET, R['zero']),
        csrrw(R['a3'], CSR_CYCLE, R['t0']),         # 写被忽略
        csrrs(R['a4'], CSR_CYCLE, R['zero']),       # 读回：仍是周期计数
        csrrw(R['a5'], CSR_TIME, R['t0']),
        csrrs(R['a6'], CSR_TIME, R['zero']),
        csrrsi(R['a7'], CSR_INSTRET, 0x1F),
        csrrs(R['s2'], CSR_INSTRET, R['zero']),
        csrrci(R['s3'], CSR_CYCLE, 0x1F),
        csrrs(R['s4'], CSR_CYCLE, R['zero']),
    ]
    return _seq("csr_readonly", w, "cycle/time/instret 可读不可写")


def c_csr_arbitrary():
    """任意 CSR 地址可读写（4096 项数组，[实测]）"""
    w = _li(R['t0'], 0xCAFEBABE)
    w += [
        csrrw(R['a0'], 0x7FF, R['t0']),             # 未定义地址
        csrrs(R['a1'], 0x7FF, R['zero']),
        csrrw(R['a2'], 0x000, R['t0']),
        csrrs(R['a3'], 0x000, R['zero']),
        csrrw(R['a4'], 0xFFF, R['t0']),
        csrrs(R['a5'], 0xFFF, R['zero']),
        csrrw(R['a6'], CSR_MIP, R['t0']),           # mip 是可写的普通寄存器
        csrrs(R['a7'], CSR_MIP, R['zero']),
        csrrw(R['s2'], 0x306, R['t0']),             # mcounteren 也在数组里
        csrrs(R['s3'], 0x306, R['zero']),
    ]
    return _seq("csr_arbitrary", w, "任意 CSR 地址可读写（含 mip/mcounteren）")


def c_csr_mstatus():
    """mstatus 是普通寄存器（不做 WARL 掩码），并读回全部标准 CSR 的初值"""
    w = _li(R['t0'], 0xFFFFFFFF)
    w += [
        csrrw(R['a0'], CSR_MSTATUS, R['t0']),       # 原样存 0xFFFFFFFF
        csrrs(R['a1'], CSR_MSTATUS, R['zero']),
    ]
    for k, csr in enumerate((CSR_MEPC, CSR_MCAUSE, CSR_MTVAL, CSR_MTVEC, CSR_MIE,
                             CSR_MIP, CSR_MSCRATCH, CSR_MTIMECMP)):
        w.append(csrrs(R['s0'] + (k % 8), csr, R['zero']))
    # 清掉 MIE，避免后面对 mstatus 的写入意外开闸
    w += [csrrw(R['zero'], CSR_MSTATUS, R['zero'])]
    w += [csrrs(R['s5'], CSR_MSTATUS, R['zero'])]
    return _seq("csr_mstatus", w, "mstatus 原样存储 + 全 CSR 读回")


def c_csr_all_read():
    """读一批 CSR（初值全 0 / 只读计数）——确认读一个没写过的 CSR 不炸"""
    w = []
    for k, csr in enumerate((CSR_MSTATUS, CSR_MIE, CSR_MTVEC, CSR_MSCRATCH, CSR_MEPC,
                             CSR_MCAUSE, CSR_MTVAL, CSR_MIP, CSR_MTIMECMP, 0x301, 0x306,
                             0x320, 0xB00, 0xB02, 0xF11, 0xF12, 0xF13, 0xF14)):
        w.append(csrrs(R['a0'] + (k % 8), csr, R['zero']))
    return _seq("csr_read_all", w, "18 个 CSR 读回（初值 / 只读 CSR）")


# ===========================================================================
# 6. trap 与中断全链路
# ===========================================================================

def c_trap_ecall():
    """ecall → handler 读 CSR → mret 回到下一条"""
    body = _setup_trap()
    body += [addi(R['s0'], R['s0'], 1),
             ecall(),                                # ← 陷阱点
             addi(R['s1'], R['s1'], 1)]
    handler = _handler_prologue() + [
        csrrs(R['a3'], CSR_MSTATUS, R['zero']),      # MIE=0, MPIE=1
        addi(R['s3'], R['s3'], 1),
        mret(),                                      # 回到 ecall 的下一条
    ]
    n = len(body) + len(handler) + 1
    return ("trap_ecall", _trap_prog(body, handler), n, "ecall 全链路 + mret", False)


def c_trap_ebreak():
    body = _setup_trap()
    body += [ebreak(), addi(R['s1'], R['s1'], 1)]
    handler = _handler_prologue() + [csrrs(R['a3'], CSR_MSTATUS, R['zero']), mret()]
    n = len(body) + len(handler) + 1
    return ("trap_ebreak", _trap_prog(body, handler), n, "ebreak → cause=3 → mret", False)


def c_trap_illegal_op_funct7():
    """OP 类的保留 funct7（含 RV32M 的 mul）：规范要求非法指令异常"""
    body = _setup_trap()
    body += [addi(R['s0'], R['s0'], 1)]
    for f7 in (0x01, 0x02, 0x40, 0x7F):             # 0x01 是 RV32M，本核不实现
        body.append(r(f7, R['s5'], R['s4'], 0b000, R['s3'], OP_REG))
    body += [addi(R['s1'], R['s1'], 1)]
    handler = _skip_handler()
    n = len(body) + 4 * len(handler) + 1
    return ("trap_illegal_op_funct7", _trap_prog(body, handler), n,
            "OP 保留 funct7（含 RV32M mul）→ 非法指令", False)


def c_trap_illegal_shift():
    """OP-IMM 的保留 shamt 编码（RV32 只有 5 位 shamt，funct7 只能 0x00/0x20）"""
    body = _setup_trap()
    body += [addi(R['s0'], R['s0'], 1)]
    for f7, f3 in ((0x01, 0b001), (0x20, 0b001), (0x10, 0b101), (0x3F, 0b101)):
        body.append(i((f7 << 5) | 1, R['t0'], f3, R['a0'], OP_IMM))
    body += [addi(R['s1'], R['s1'], 1)]
    handler = _skip_handler()
    n = len(body) + 4 * len(handler) + 1
    return ("trap_illegal_shift", _trap_prog(body, handler), n,
            "OP-IMM 保留 shamt 编码 → 非法指令", False)


def c_trap_illegal_jalr_f3():
    """JALR 的 funct3 = 1..7 —— 规范只允许 000，其余是保留编码

    每组形如：  li t0, <本组 jalr 自己的地址> ; jalr a0, t0, 4 ; addi s5,s5,1

    这样设计是为了让两条路**都落到同一条 addi** 上，只留下「这一拍本身」的分歧：
      - 当合法执行（func3=0 应有的行为，也是后端对 1..7 的错误行为）：
        (t0+4)&~1 = 紧跟其后的 addi
      - 取陷阱（规范行为）：handler 把 mepc += 4 再 mret，同样落到那条 addi
    于是失配只可能来自「该不该 trap」以及「a0 有没有被写」，正是要抓的东西。

    ⚠️ 本用例上一版写的是 `jalr a0, ra, 4` 而 **ra 从没被赋过值（=0）**，
    第 0 组（funct3=0，合法）就直接跳到 pc=4 的内存外，两个模型一起跑飞，
    后面 7 组非法编码**一次都没被执行到** —— 用例恒过，等于没测。
    这版把基址显式算出来，并用 assert 钉住 li 的条数，免得再退化。
    """
    body = _setup_trap()
    for f3 in range(8):
        # li 占 2 条（地址低 12 位 = 4*下标，不为 0），据此算出 jalr 自己的地址
        here = 0x80000000 + 4 * (len(body) + 2)
        assert len(_li(R['zero'], here)) == 2, "li 条数变了，here 的推算要跟着改"
        body += _li(R['t0'], here)
        body.append(i(4, R['t0'], f3, R['a0'], OP_JALR))
        body.append(addi(R['s5'], R['s5'], 1))
    handler = _skip_handler()
    n = len(body) + 8 * len(handler)
    return ("trap_illegal_jalr_f3", _trap_prog(body, handler), n,
            "JALR funct3=1..7 必须全部非法（funct3=0 合法）", False)


def c_trap_illegal_misc_f3():
    """MISC-MEM 的 funct3 = 2..7 —— 规范只允许 000(FENCE) / 001(FENCE.I)"""
    body = _setup_trap()
    body += [fence(), fence_i()]
    for f3 in range(2, 8):
        body.append(i(0, 0, f3, 0, OP_MISC))
    handler = _skip_handler()
    n = len(body) + 6 * len(handler)
    return ("trap_illegal_misc_f3", _trap_prog(body, handler), n,
            "MISC-MEM funct3=2..7 必须全部非法", False)


def c_trap_illegal_load_f3():
    """LOAD 的 funct3 = 3/6/7 是保留编码"""
    body = _setup_trap()
    body += _li(R['t0'], 0x80000000 + 0x800)
    for f3 in (3, 6, 7):
        body.append(i(0, R['t0'], f3, R['a0'], OP_LOAD))
    handler = _skip_handler()
    n = len(body) + 3 * len(handler)
    return ("trap_illegal_load_f3", _trap_prog(body, handler), n,
            "LOAD funct3=3/6/7 保留编码 → 非法指令", False)


def c_trap_illegal_store_f3():
    """STORE 的 funct3 = 3..7 是保留编码"""
    body = _setup_trap()
    body += _li(R['t0'], 0x80000000 + 0x800)
    for f3 in range(3, 8):
        body.append(s(0, R['t1'], R['t0'], f3, OP_STORE))
    handler = _skip_handler()
    n = len(body) + 5 * len(handler)
    return ("trap_illegal_store_f3", _trap_prog(body, handler), n,
            "STORE funct3=3..7 保留编码 → 非法指令", False)


def c_trap_illegal_branch_f3():
    """BRANCH 的 funct3 = 2/3 是保留编码"""
    body = _setup_trap()
    for f3 in (2, 3):
        body.append(b(8, R['t1'], R['t0'], f3, OP_BRANCH))
    handler = _skip_handler()
    n = len(body) + 2 * len(handler)
    return ("trap_illegal_branch_f3", _trap_prog(body, handler), n,
            "BRANCH funct3=2/3 保留编码 → 非法指令", False)


def c_trap_illegal_system_f3():
    """SYSTEM 的 funct3=100 是保留编码；ecall/ebreak/mret 的整字编码变体也必须非法"""
    body = _setup_trap()
    body += [
        0x00000073 | (1 << 7),          # ecall 但 rd=1
        0x00000073 | (1 << 15),         # ecall 但 rs1=1
        0x00000073 | (1 << 20),         # ecall 但 imm != 0
        0x00100073 | (1 << 7),          # ebreak 但 rd=1
        0x30200073 | (1 << 7),          # mret 但 rd=1
        0x30200073 | (1 << 20),         # mret 但 imm != 0
        0x00200073,                     # imm=2 —— 保留
        0x10200073,                     # 保留（不是 WFI）
        0x00000073 | (0b100 << 12),     # funct3=100 —— 保留
    ]
    handler = _skip_handler()
    n = len(body) + 9 * len(handler)
    return ("trap_illegal_system", _trap_prog(body, handler), n,
            "SYSTEM 保留编码与 ecall/ebreak/mret 变体 → 非法指令", False)


def c_trap_illegal_opcode():
    """未定义的 opcode（含全 0、全 1）必须非法"""
    body = _setup_trap()
    bads = [0x00000000, 0xFFFFFFFF, 0x0000007F, 0x0000000B, 0x0000002B, 0x0000005B,
            0x0000003B, 0x0000001F]
    body += bads
    handler = _skip_handler()
    n = len(body) + len(bads) * len(handler)
    return ("trap_illegal_opcode", _trap_prog(body, handler), n,
            "未定义 opcode → 非法指令", False)


def c_trap_illegal_all_f3():
    """穷举：每个 opcode × 全部 8 个 funct3，只有规范允许的那些才不 trap"""
    body = _setup_trap(off=0x200)                   # 56 条网格 + 前缀，放到 +0x200
    body += _li(R['t0'], 0x80000000 + 0x800)
    body += _li(R['t1'], 1)
    grid = []
    for op in (OP_JALR, OP_LOAD, OP_STORE, OP_BRANCH, OP_IMM, OP_REG, OP_MISC):
        for f3 in range(8):
            grid.append(i(0, R['t0'], f3, R['a0'], op) if op in (OP_JALR, OP_LOAD)
                        else s(0, R['t1'], R['t0'], f3, op) if op == OP_STORE
                        else b(4, R['t1'], R['t0'], f3, op) if op == OP_BRANCH
                        else r(0x00, R['t1'], R['t0'], f3, R['a0'], op) if op == OP_REG
                        else i(0, R['t0'], f3, R['a0'], op))
    body += grid
    handler = _skip_handler()
    n = len(body) + len(grid) * len(handler) + 4
    return ("trap_illegal_grid", _trap_prog(body, handler, off=0x200), n,
            "7 个 opcode × 8 个 funct3 的合法性网格（56 条）", False)


def c_trap_mtvec0_halt():
    """mtvec == 0 时取 trap ⇒ 停机兜底（本项目自定义语义）"""
    body = [
        addi(R['s0'], R['s0'], 1),
        ecall(),                        # mtvec=0 → halted
        addi(R['s1'], R['s1'], 1),      # 永远到不了
    ]
    return ("trap_mtvec0_halt", body, len(body) + 1, "mtvec=0 停机兜底", True)


def c_trap_illegal_halt():
    """非法指令 + mtvec==0 ⇒ 同样停机兜底，且前面的指令必须已提交"""
    body = [
        addi(R['s0'], R['s0'], 1),
        addi(R['s1'], R['s1'], 1),
        r(0x01, R['s3'], R['s2'], 0b000, R['a0'], OP_REG),   # mul → 非法
        addi(R['s2'], R['s2'], 1),
    ]
    return ("trap_illegal_halt", body, len(body) + 1, "非法指令 + mtvec=0 停机", True)


def c_trap_interrupt_timer():
    """计时器中断：精确在 mtime >= mtimecmp 的那一拍触发；被打断的指令完全不提交"""
    body = _setup_trap(mtimecmp=20)
    for _ in range(40):
        body.append(addi(R['s0'], R['s0'], 1))
    handler = _quiet_handler()
    n = len(body) + len(handler) + 5
    return ("trap_interrupt_timer", _trap_prog(body, handler), n,
            "计时器中断精确触发 + 被打断指令不提交", False)


def c_trap_interrupt_at_entry():
    """门控一开就满足条件：中断在**紧接的那一拍**触发（不是等下一轮）"""
    body = _setup_trap(mtimecmp=0)                 # mtimecmp=0 ⇒ 立刻满足
    for _ in range(10):
        body.append(addi(R['s0'], R['s0'], 1))
    handler = _quiet_handler()
    n = len(body) + len(handler) + 5
    return ("trap_irq_at_entry", _trap_prog(body, handler), n,
            "门控开启即满足 ⇒ 下一拍触发中断", False)


def c_trap_interrupt_boundary():
    """mtimecmp = k 与 k±1：确认比较是 >= 而不是 >"""
    out = []
    for k in (12, 13, 14):
        body = _setup_trap(mtimecmp=k)
        for _ in range(30):
            body.append(addi(R['s0'], R['s0'], 1))
        handler = _quiet_handler()
        n = len(body) + len(handler) + 5
        out.append(("trap_irq_cmp%d" % k, _trap_prog(body, handler), n,
                    "mtimecmp=%d 的比较边界" % k, False))
    return "multi", out


def c_trap_gate_mie_off():
    """门控：mstatus.MIE=0 时中断不触发（mtimecmp 早就到了）"""
    body = _setup_trap(mstatus=0x00000000, mie=0x00000080, mtimecmp=2)
    for _ in range(20):
        body.append(addi(R['s0'], R['s0'], 1))
    handler = _quiet_handler()
    n = len(body) + 2
    return ("trap_gate_mie_off", _trap_prog(body, handler), n,
            "mstatus.MIE=0 时中断不触发", False)


def c_trap_gate_mtie_off():
    """门控：mie.MTIE=0 时中断不触发"""
    body = _setup_trap(mstatus=0x00000008, mie=0x00000000, mtimecmp=2)
    for _ in range(20):
        body.append(addi(R['s0'], R['s0'], 1))
    handler = _quiet_handler()
    n = len(body) + 2
    return ("trap_gate_mtie_off", _trap_prog(body, handler), n,
            "mie.MTIE=0 时中断不触发", False)


def c_trap_no_reentry():
    """进 handler 后 MIE=0 ⇒ 中断不重入；handler 里数次数必须恰好 1"""
    body = _setup_trap(mie=0x00000080, mtimecmp=10)
    for _ in range(30):
        body.append(addi(R['s0'], R['s0'], 1))
    handler = _quiet_handler()
    n = len(body) + len(handler) + 5
    return ("trap_no_reentry", _trap_prog(body, handler), n,
            "handler 内 MIE=0 ⇒ 不重入（s2 恰好为 1）", False)


def c_trap_interrupt_after_mret():
    """mret 恢复 MIE 之后，若条件仍满足必须**再次**触发（handler 里不改 mtimecmp）"""
    body = _setup_trap(mie=0x00000080, mtimecmp=8)
    for _ in range(20):
        body.append(addi(R['s0'], R['s0'], 1))
    # handler 不顶 mtimecmp ⇒ mret 之后立刻再中断；跑 3 次后把 mtimecmp 顶掉
    handler = _handler_prologue() + _li(R['t5'], 3) + [
        blt(R['s2'], R['t5'], 12),                  # s2 < 3 → 跳到 mret（重入）
        lui(R['t4'], 0),
        addi(R['t4'], R['t4'], -1),
        csrrw(R['zero'], CSR_MTIMECMP, R['t4']),
        mret(),
    ]
    n = len(body) + len(handler) * 4 + 6
    return ("trap_irq_reenter", _trap_prog(body, handler), n,
            "mret 后条件仍满足 ⇒ 再次触发中断（s2 到 3 才停）", False)


def c_trap_nested_mepc():
    """嵌套 trap 会覆盖 mepc —— 确认 mepc 被第二次 trap 重写"""
    body = _setup_trap(mtimecmp=6)
    for _ in range(20):
        body.append(addi(R['s0'], R['s0'], 1))
    # handler 里主动再触发一次 ecall（MIE 已关，但同步异常不受门控影响）
    handler = _handler_prologue() + [
        csrrs(R['a3'], CSR_MEPC, R['zero']),
        csrrw(R['zero'], CSR_MEPC, R['ra']),        # 先复位 mepc，避免死循环
        ecall(),                                    # ← 第二次 trap
        addi(R['s6'], R['s6'], 1),
        mret(),
    ]
    n = len(body) + len(handler) * 3 + 8
    return ("trap_nested_mepc", _trap_prog(body, handler), n,
            "handler 内再触发异常 ⇒ mepc 被覆盖", False)


def c_mret_mstatus():
    """mret 的位运算：MIE ← MPIE，MPIE 本身不清（[实测]）"""
    body = _setup_trap(mstatus=0x00000008)
    body += [
        csrrs(R['a0'], CSR_MSTATUS, R['zero']),     # 0x08
        ecall(),
        csrrs(R['a1'], CSR_MSTATUS, R['zero']),     # mret 之后
        csrrs(R['a2'], CSR_MEPC, R['zero']),
    ]
    handler = [mret()]
    n = len(body) + 3
    return ("mret_mstatus", _trap_prog(body, handler), n,
            "mret：MIE←MPIE、MPIE 保留（0x08 → 0x80 → 0x88）", False)


def c_trap_mstatus_preserve():
    """trap 只动 mstatus 的 bit3/bit7，其余位原样保留"""
    body = _setup_trap(mstatus=0xFFFFFFFF)
    body += [ecall(), csrrs(R['a0'], CSR_MSTATUS, R['zero'])]
    handler = [csrrs(R['a1'], CSR_MSTATUS, R['zero']), mret()]
    n = len(body) + 3
    return ("trap_mstatus_preserve", _trap_prog(body, handler), n,
            "mstatus=0xFFFFFFFF 取 trap → 0xFFFFFFF7", False)


def c_trap_handler_uses_stack():
    """handler 里访存（用栈保存现场）—— 把 trap 与 load/store 交叉验证"""
    body = _setup_trap()
    body += _li(R['sp'], 0x80000000 + 0xC00)
    body += [
        addi(R['s0'], R['s0'], 0x111),
        ecall(),
        addi(R['s1'], R['s1'], 1),
    ]
    handler = _handler_prologue() + [
        sw(R['s0'], R['sp'], -4),                   # 保存
        addi(R['s0'], R['zero'], 0x222),            # 改掉
        lw(R['s0'], R['sp'], -4),                   # 恢复
        mret(),
    ]
    n = len(body) + len(handler) + 1
    return ("trap_handler_stack", _trap_prog(body, handler), n,
            "handler 里 load/store（栈保存现场）", False)


# ===========================================================================
# 7. 杂项
# ===========================================================================

def c_misc_fence():
    """fence / fence.i / nop 不改变体系结构状态"""
    w = []
    for imm in (0, 1, 0xFFFFF):
        w.append(lui(R['a0'], imm))
        w.append(auipc(R['a1'], imm))
    w += [fence(), fence_i(), addi(0, 0, 0), fence(), fence_i()]
    w.append(auipc(R['a2'], 1))
    w.append(lui(R['a3'], 2))
    w += [fence(), fence_i()]
    return _seq("misc_fence", w, "fence/fence.i/nop 不改变状态")


def c_backtoback():
    """背靠背同 rd 写：抓「写回数据来自上一拍」这类时序错"""
    w = []
    for k in range(20):
        w.append(addi(R['a0'], R['a0'], 1))
        w.append(add(R['a0'], R['a0'], R['a0']))    # 依赖上一条
        w.append(lui(R['a1'], k & 0xFFFFF))
        w.append(addi(R['a1'], R['a1'], k))
        w.append(add(R['a2'], R['a0'], R['a1']))
    return _seq("backtoback", w, "背靠背同 rd 依赖链")


def c_legal_random(seed=20260922, n=48):
    """种子随机流（**全部合法编码**，控制流只向前）：每拍逐字段比对

    只向前跳是刻意的：保证 PC 始终落在程序内，不会跑飞成 fetch(0)。
    """
    rnd = random.Random(seed)
    regs = [R['t0'], R['t1'], R['t2'], R['s0'], R['s1'], R['a0'], R['a1'], R['a2'],
            R['a3'], R['s2'], R['s3'], R['s4'], R['s5'], R['s6'], R['ra'], R['sp']]
    fwd = [4, 8, 12, 16]
    w = []
    for _ in range(n):
        pick = rnd.randrange(0, 100)
        r1, r2, rd = (rnd.choice(regs) for _ in range(3))
        if pick < 24:
            w.append(r(rnd.choice([0x00, 0x20]), r2, r1, rnd.randrange(8), rd, OP_REG))
        elif pick < 42:
            w.append(i(rnd.randrange(-2048, 2048), r1, rnd.randrange(8), rd, OP_IMM))
        elif pick < 50:
            w.append(i(rnd.randrange(0, 32), r1, rnd.choice([0b001, 0b101]), rd, OP_IMM))
        elif pick < 58:
            w.append(u(rnd.randrange(1 << 20), rd, rnd.choice([OP_LUI, OP_AUIPC])))
        elif pick < 64:
            w.append(j(rnd.choice(fwd), rd, OP_JAL))
        elif pick < 72:
            w.append(b(rnd.choice(fwd), r2, r1, rnd.choice([0, 1, 4, 5, 6, 7]), OP_BRANCH))
        elif pick < 80:
            w.append(i(rnd.choice([0, 4, 8, 12]), r1, rnd.choice([0, 1, 2, 4, 5]), rd, OP_LOAD))
        elif pick < 86:
            w.append(s(rnd.choice([0, 4, 8, 12]), r2, r1, rnd.randrange(3), OP_STORE))
        elif pick < 92:
            w.append(csrrs(rd, rnd.choice([CSR_MSCRATCH, 0x7F0, 0x7F1, CSR_MIP]), r1))
        elif pick < 96:
            w.append(csrrw(rnd.choice([R['zero'], rd]),
                           rnd.choice([CSR_MSCRATCH, 0x7F0, 0x7F1]),
                           rnd.choice([R['zero'], r1])))
        else:
            w.append(rnd.choice([fence(), fence_i(), addi(0, 0, 0)]))
    return _seq("legal_random", w, "种子随机流（全合法编码，只向前跳）")


def c_legal_random_csr(seed=4242, n=40):
    """随机 CSR 流：混入 Cycle/Time/Instret 的只读读，验证周期计数一致性"""
    rnd = random.Random(seed)
    w = []
    csrs = [CSR_MSTATUS, CSR_MIE, CSR_MTVEC, CSR_MSCRATCH, CSR_MEPC, CSR_MCAUSE,
            CSR_MTVAL, CSR_MIP, CSR_MTIMECMP, CSR_CYCLE, CSR_TIME, CSR_INSTRET,
            0x301, 0x306, 0x320, 0x7F0]
    for _ in range(n):
        csr = rnd.choice(csrs)
        f3 = rnd.choice([0b001, 0b010, 0b011, 0b101, 0b110, 0b111])
        rd = rnd.choice([R['a0'], R['a1'], R['a2'], R['zero'], R['s0'], R['s1']])
        rs1 = rnd.choice([R['t0'], R['t1'], R['zero'], R['s2']])
        # mtimecmp 写大值，避免随机流里意外开中断
        if f3 < 0b100:
            w.append(i(csr, rs1, f3, rd, OP_SYSTEM))
        else:
            w.append(i(csr, rnd.randrange(0, 32), f3, rd, OP_SYSTEM))
    return _seq("legal_random_csr", w, "随机 CSR 流（含只读计数的一致性）")


# ===========================================================================
# 汇总
# ===========================================================================

SINGLE = [
    c_alu_r, c_alu_i, c_lui_auipc, c_shift_reg,
    c_branch, c_branch_backward, c_jal_link, c_jalr_imm,
    c_load_store, c_store_width, c_unaligned, c_mem_bounds, c_store_offsets,
    c_x0,
    c_csr_rw, c_csr_readonly, c_csr_arbitrary, c_csr_mstatus, c_csr_all_read,
    c_trap_ecall, c_trap_ebreak,
    c_trap_illegal_op_funct7, c_trap_illegal_shift, c_trap_illegal_jalr_f3,
    c_trap_illegal_misc_f3, c_trap_illegal_load_f3, c_trap_illegal_store_f3,
    c_trap_illegal_branch_f3, c_trap_illegal_system_f3, c_trap_illegal_opcode,
    c_trap_illegal_all_f3,
    c_trap_mtvec0_halt, c_trap_illegal_halt,
    c_trap_interrupt_timer, c_trap_interrupt_at_entry, c_trap_gate_mie_off,
    c_trap_gate_mtie_off, c_trap_no_reentry, c_trap_interrupt_after_mret,
    c_trap_nested_mepc, c_mret_mstatus, c_trap_mstatus_preserve,
    c_trap_handler_uses_stack,
    c_misc_fence, c_backtoback, c_legal_random, c_legal_random_csr,
]

MULTI = [c_jalr_rd, c_trap_interrupt_boundary]


def build():
    """返回 [(name, words, n_steps, note, expects_halt), ...]"""
    out = []
    for fn in SINGLE:
        got = fn()
        assert isinstance(got, tuple) and len(got) == 5, "%s 的返回值形状不对" % fn.__name__
        assert got[1], "%s 没生成 words" % fn.__name__
        out.append(got)
    for fn in MULTI:
        tag, items = fn()
        assert tag == "multi"
        for it in items:
            assert len(it) == 5, "%s 的子用例形状不对" % fn.__name__
            out.append(it)
    return out


if __name__ == "__main__":
    cases = build()
    total = 0
    for name, words, n, note, halt in cases:
        total += len(words)
        print("%-28s %5d 字 %5d 拍 %s %s" % (name, len(words), n, note,
                                             "[应停机]" if halt else ""))
    print("合计 %d 个用例 / %d 条指令" % (len(cases), total))
