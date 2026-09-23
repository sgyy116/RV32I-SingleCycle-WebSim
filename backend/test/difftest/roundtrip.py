# -*- coding: utf-8 -*-
"""
roundtrip.py —— B4：汇编器 ↔ 反汇编器 双向一致性

    python difftest/roundtrip.py          # 跑全部用例
    python difftest/roundtrip.py -v       # 逐条打印每组的行数 / 归一化处数
    python difftest/roundtrip.py --raw    # 关掉归一化：看原始反汇编文本有多少条**不能直接**回汇

判据
----
    源码 --asm.assemble--> 机器码 W --C++ 反汇编--> 文本 T --归一化--> 源码' --asm.assemble--> W'
    断言 W' == W   （比的是**机器码逐字相等**，不是文本相等）

文本格式属于实现自由度（difftest/run.py 的 SKIP_KEYS 里也排除了 `disassembly`），
所以「文本长得不一样」不算失败；「文本换不回同一串机器码」才算失败。
这条判据不依赖任何外部参照 —— 两份实现互相验，就能抓出「编码位拼错」「译码位读错」
「同一个 funct3 编进 A 却解成 B」这一类错误。

--------------------------------------------------------------------------
归一化：反汇编文本与汇编器输入的两处**表达口径**差异（不是错误）
--------------------------------------------------------------------------
  1. U 型立即数（lui / auipc）
     反汇编打印的是 `imm_gen(Format::U)`，也就是**符号扩展后的 32 位值**
     （实测 `lui t0, 0x80000` 的反汇编文本是 `lui t0, -2147483648`）；
     而 asm.py 的 lui/auipc 收的是**20 位立即数**（`0x80000`）。
     同一个编码的两种写法：`v >> 12`（Python 算术右移，负值也正确）即可互转。

  2. 分支 / jal 的落点
     反汇编打印**相对本条的字节偏移**（`beq a0, a1, 8`），asm.py 的 beq/jal 只收**标签**。
     测试在目标地址处合成标签 `L%08x`，把偏移折回标签。

这两处之外的**任何**文本差异都判失败。`--raw` 关掉归一化后会立刻成片报错，
正是用来证明归一化确实只堵了这两处、而不是把失败掩盖过去的。

--------------------------------------------------------------------------
已知的能力边界（**不属于本测试能覆盖的范围**，在此声明以免误读成通过）
--------------------------------------------------------------------------
  - `fence` / `fence.i`：asm.py 不支持这两个助记符（前端高亮表同样没有），
    只能写成 `.word 0x0000000f`。本测试的语料因此不含它们。
    反汇编器把 funct3=000 与 001 都渲染成 `fence`，这一位信息在文本上不可逆
    —— 但既然汇编器两侧都不支持，往返本来就走不通，故不列入本测试，只在此备案。
  - 非法编码：反汇编一律给 `.word 0x…`，asm.py 的 `.word` 能原样编回 ⇒ 可往返，
    已包含在语料里（见「非法编码」组）。asm.py 自己产生不出非法编码，
    那一侧的覆盖靠 difftest/enc.py 的语料。
"""

import argparse
import os
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.join(_HERE, "..", "..", "python"))

import asm                                    # noqa: E402  被测产品的一部分（就是本项目的编译器）
from sim import Sim, SimError, write_bin      # noqa: E402

BASE = 0x80000000

U_TYPE = ("lui", "auipc")
BRANCH = ("beq", "bne", "blt", "bge", "bltu", "bgeu")


# ---------------------------------------------------------------------------
# 语料：按组给，分组只是为了失败时能一眼定位到「哪一类指令出了什么问题」
# ---------------------------------------------------------------------------

GROUPS = [
    ("R 型", """
add   a0, a1, a2
sub   s0, s1, s2
sll   t0, t1, t2
slt   a3, a4, a5
sltu  s3, s4, s5
xor   t3, t4, t5
srl   a6, a7, s6
sra   s7, s8, s9
or    s10, s11, t6
and   gp, tp, ra
"""),

    ("I 型（算术/逻辑/移位）", """
addi  sp, sp, -16
addi  a0, zero, 2047
slti  a0, a1, 7
sltiu a0, a1, -7
xori  a0, a1, 0x123
ori   a0, a1, -1
andi  a0, a1, -2048
slli  a0, a1, 31
srli  a0, a1, 0
srai  a0, a1, 5
"""),

    ("访存（偏移含 0 / 正 / 负 / 十六进制）", """
sw    a0, 0(sp)
sw    a0, 0x10(sp)
lb    a0, -4(sp)
lh    a0, 2(sp)
lw    a0, 2047(sp)
lbu   a0, 1(sp)
lhu   a0, 3(sp)
sb    a0, -1(sp)
sh    a0, 6(sp)
"""),

    ("分支（落点在前 / 在后 / 原地）", """
start:
beq   a0, a1, start
bne   a0, a1, fwd
blt   a0, a1, start
bge   a0, a1, fwd
bltu  a0, a1, start
bgeu  a0, a1, fwd
fwd:
nop
"""),

    ("跳转 jal / jalr", """
start2:
jal   ra, start2
jal   zero, fwd2
jalr  ra, t0, 0
jalr  a0, t1, -8
jalr  a0, t1, 0x7ff
fwd2:
nop
"""),

    ("U 型（含符号扩展的边界值）", """
lui   a0, 0
lui   a0, 0xfffff
lui   a0, 0x80000
auipc a0, 0x12345
auipc a0, -0x80000
"""),

    ("伪指令", """
start3:
nop
mv    a0, a1
li    a0, 10
li    a0, -1
li    a0, 0x12345678
li    a0, 0x80000000
la    a0, start3
ret
call  start3
beqz  a0, start3
bnez  a0, fwd3
j     start3
fwd3:
nop
"""),

    ("系统指令与 CSR", """
ecall
ebreak
mret
csrrw  a0, mstatus, a1
csrrs  zero, mepc, a1
csrrc  a0, mcause, a1
csrrwi a0, mtvec, 5
csrrsi a0, mscratch, 31
csrrci a0, mcause, 0
csrrw  a0, mtimecmp, a1
"""),

    ("非法编码（反汇编给 .word，汇编器原样编回）", """
.word 0xffffffff
.word 0x00000000
.word 0x0000007f
"""),
]


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------

def split_text(t):
    """`beq a0, a1, 8` -> ("beq", ["a0", "a1", "8"])；`fence` -> ("fence", [])"""
    m, _, rest = t.partition(" ")
    rest = rest.strip()
    return m, ([x.strip() for x in rest.split(",")] if rest else [])


def disassemble_all(words):
    """把 words 写盘、加载、从 BASE 反汇编 len(words) 条，返回 (texts, bytes)"""
    tmpdir = tempfile.mkdtemp(prefix="roundtrip_")
    path = os.path.join(tmpdir, "rt.bin")
    write_bin(words, path)
    try:
        with Sim(path) as sim:
            items = sim.disassemble(BASE, len(words))
    finally:
        try:
            os.remove(path)
            os.rmdir(tmpdir)
        except OSError:
            pass
    return ([d["text"] for d in items],
            [int(d["bytes"], 16) for d in items])


def raw_assemblable(text):
    """单独把一行反汇编文本喂给汇编器，看能不能吃下去。返回 None 表示可以，否则返回原因"""
    try:
        asm.assemble([text])
        return None
    except Exception as e:                      # noqa: BLE001  只用于报告，不改变控制流
        return str(e)


def normalize(texts, do_norm):
    """反汇编文本 -> 可汇编源码行。返回 (源码行, 归一化处数)"""
    items = [(BASE + 4 * i, split_text(t)) for i, t in enumerate(texts)]
    addrs = {a for a, _ in items}

    # 第一遍：把分支/jal 的落点收集成标签（落点在程序之外就没法用标签表达）
    want_label = set()
    if do_norm:
        for addr, (m, ops) in items:
            if (m in BRANCH or m == "jal") and ops:
                tgt = addr + int(ops[-1], 0)
                if tgt not in addrs:
                    raise ValueError(
                        "第 %d 条（%s）的落点 0x%08x 不在本段程序里，标签表达不了"
                        % ((addr - BASE) // 4, " ".join([m] + ops), tgt))
                want_label.add(tgt)

    # 第二遍：按地址顺序生成源码，需要标签的位置先落一个 `L%08x:`
    out, n_norm = [], 0
    for addr, (m, ops) in items:
        if addr in want_label:
            out.append("L%08x:" % addr)
        if do_norm and m in U_TYPE and len(ops) == 2:
            # 32 位符号扩展值 -> 20 位立即数（算术右移，负值照样对）
            out.append("%s %s, %d" % (m, ops[0], int(ops[1], 0) >> 12))
            n_norm += 1
        elif do_norm and (m in BRANCH or m == "jal") and ops:
            tgt = addr + int(ops[-1], 0)
            head = ", ".join([m] + ops[:-1])
            out.append("%s, L%08x" % (head, tgt))
            n_norm += 1
        else:
            out.append(m + (" " + ", ".join(ops) if ops else ""))
    return out, n_norm


def compare(want, got):
    """返回 [(下标, 期望字, 实得字), ...]"""
    bad = []
    for i in range(max(len(want), len(got))):
        a = want[i] if i < len(want) else None
        b = got[i] if i < len(got) else None
        if a != b:
            bad.append((i, a, b))
    return bad


def self_check():
    """变异自检：把 R 型组里 `sra s7, s8, s9` 的 rs2 改一位，往返**必须**精确报出这一条

    为什么非要有这一步：「往返全过」既可能是真的全过，也可能是比较逻辑压根没在工作。
    本项目的 P0-1（AUIPC 结果 = pc 而不是 pc+imm）正是「实现错 + 断言恒真」长期共存的
    标本，所以这里用一个**已知的单点变异**证明三点：
      ① 比较逻辑是活的；② 能精确到某一条而不是整组报错；③ 能抓到寄存器字段级别的差异。
    返回 (是否通过, 说明)。
    """
    want = asm.assemble(GROUPS[0][1].strip().splitlines())
    idx = 7                                   # R 型组第 8 条 = sra s7, s8, s9
    mutant = list(want)
    mutant[idx] ^= (1 << 20)                  # 翻 rs2 最低位：s9(x25) -> s8(x24)
    texts, _ = disassemble_all(mutant)
    got = asm.assemble(normalize(texts, do_norm=True)[0])
    bad = compare(want, got)
    hit = [i for i, _, _ in bad]
    if hit == [idx]:
        return True, "变异被精确捕获（第 %d 条 sra 的 rs2 改一位）" % idx
    if not hit:
        return False, "变异未被捕获 —— 比较逻辑是死的，「全过」不可信"
    return False, "变异被捕获了，但报错范围不对：%r（期望 [%d]）" % (hit, idx)


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="汇编器 ↔ 反汇编器 往返测试")
    ap.add_argument("-v", "--verbose", action="store_true", help="每组都打印一行")
    ap.add_argument("--raw", action="store_true",
                    help="关掉归一化，只统计「原样反汇编文本能不能直接喂回汇编器」")
    args = ap.parse_args()

    if not os.path.exists(os.path.join(_HERE, "..", "..", "cpp", "build",
                                       "rv32i_sim" + (".exe" if os.name == "nt" else ""))):
        print("[基础设施] 找不到模拟器可执行文件，先编译 C++ 后端")
        return 2

    if args.raw:
        return raw_report()

    n_ok, n_bad = 0, []
    try:
        for name, src in GROUPS:
            lines = src.strip().splitlines()
            want = asm.assemble(lines)
            texts, words_in_sim = disassemble_all(want)

            # 交叉检查：模拟器内存里读回的字节，应当与汇编器编出来的一模一样。
            # 这一步把「加载/取指」也纳进来了 —— 万一 load 有端序问题，先在这里炸。
            if words_in_sim != [(w & 0xFFFFFFFF) for w in want]:
                n_bad.append((name, "内存字节与汇编器输出不一致（加载或端序有问题）", []))
                continue

            try:
                back_src, n_norm = normalize(texts, do_norm=True)
            except ValueError as e:
                n_bad.append((name, str(e), []))
                continue

            got = asm.assemble(back_src)
            bad = compare(want, got)
            if bad:
                n_bad.append((name, "%d 条里 %d 条机器码对不上" % (len(want), len(bad)), bad))
                print("  失配  %-34s %d 行  %s" % (name, len(want),
                                                  "机器码对不上 %d 条" % len(bad)))
            else:
                n_ok += 1
                if args.verbose:
                    print("  通过  %-34s %4d 行   归一化 %2d 处"
                          % (name, len(want), n_norm))
    except SimError as e:
        print("[基础设施] %s" % e)
        return 2
    except ValueError as e:
        print("[基础设施] 汇编器报错：%s" % e)
        return 2

    total = len(GROUPS)
    print()
    print("=" * 78)
    print("往返测试：%d/%d 组通过" % (n_ok, total))
    print("=" * 78)

    # 变异自检：证明上面这些「通过」不是因为比较逻辑没在工作
    try:
        sc_ok, sc_note = self_check()
    except (SimError, ValueError) as e:
        sc_ok, sc_note = False, "自检自身报错：%s" % e
    print("变异自检：%s" % sc_note)
    if not sc_ok:
        n_bad.append(("<变异自检>", sc_note, []))

    if n_bad:
        print()
        for name, why, bad in n_bad:
            print("-" * 78)
            print("组 %s：%s" % (name, why))
            for i, a, b in bad[:12]:
                print("    第 %2d 条（地址 0x%08x）  汇编器=%s  往返后=%s"
                      % (i, BASE + 4 * i,
                         "无" if a is None else "0x%08x" % a,
                         "无" if b is None else "0x%08x" % b))
            if len(bad) > 12:
                print("    ... 另有 %d 条" % (len(bad) - 12))
        return 1

    return 0


def raw_report():
    """关掉归一化：逐条把反汇编文本原样喂给汇编器，统计直接回汇的成功率"""
    ok, fail, reasons = 0, 0, {}
    for name, src in GROUPS:
        want = asm.assemble(src.strip().splitlines())
        texts, _ = disassemble_all(want)
        for t in texts:
            why = raw_assemblable(t)
            if why is None:
                ok += 1
            else:
                fail += 1
                reasons.setdefault(why, []).append(t)

    print()
    print("=" * 78)
    print("原样回汇（不做任何归一化）：%d 条能 / %d 条不能" % (ok, ok + fail))
    print("=" * 78)
    print()
    for why, ts in sorted(reasons.items(), key=lambda kv: -len(kv[1])):
        print("-" * 78)
        print("%d 条：%s" % (len(ts), why))
        for t in ts[:4]:
            print("      %s" % t)
        if len(ts) > 4:
            print("      ... 另有 %d 条" % (len(ts) - 4))
    return 0


if __name__ == "__main__":
    sys.exit(main())
