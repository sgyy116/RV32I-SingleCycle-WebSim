# -*- coding: utf-8 -*-
"""
run.py —— 差分测试驱动：参照模型 vs C++ 后端，锁步逐字段比对

    python difftest/run.py                  # 全部用例
    python difftest/run.py -v               # 每个用例都打印一行
    python difftest/run.py -c alu_r         # 只跑一个用例
    python difftest/run.py -l               # 只列用例，不跑

退出码：0 = 全过 / 1 = 有失配 / 2 = 基础设施错误（编译产物缺失、协议不响应）

----------------------------------------------------------------------------
判读规则（很重要：失配不等于后端错）
----------------------------------------------------------------------------
参照模型自身也可能错。失配时先按这个顺序判：

  1. 失配字段是**呈现字段**（control_signals / alu / writeback.source / branch.*）？
     → 两边都可能对，只是呈现口径不同。查 refmodel.py 头部的 [B]/[C] 分档。
  2. 失配字段是**体系结构状态**（regfile / pc / next_pc / memory 数据 / CSR）？
     → 这是硬伤，至少一方违反规范。按 RISC-V 规范原文判谁错。
  3. 只差一拍（比如中断落在第 k 还是 k+1 拍）？
     → 先看 refmodel.py 里的 [实测] 条目是不是记错了，再改。

**比对字段的白名单是可论证的，不是「跑不过就删」**：本文件排除的项目只有
`disassembly`（文本格式属于实现自由度）与越界内存区（两边都定义为「读 0 / 写丢弃」，
不构成状态差异）；其余每一个字段都在比。任何新增排除都必须在此处写下理由。
"""

import argparse
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import corpus
from refmodel import RefModel, MASK32, hx
from sim import Sim, SimError, write_bin

# 只排除这一个字段：反汇编文本的格式由后端自选，不属于正确性
SKIP_KEYS = {"disassembly"}

MEM_BASE = 0x80000000


def diff(a, b, path=""):
    """递归比对，返回 [(路径, 参照值, 实现值), ...]

    注意 bool/int：JSON 里 true 与 1 在 Python 中 `==` 相等，但它们是**不同**的呈现，
    前端按布尔判断真假，所以类型不一致也要报出来。
    """
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k in SKIP_KEYS:
                continue
            p = "%s.%s" % (path, k) if path else k
            if k not in a:
                out.append((p, "<参照模型没有>", b[k]))
            elif k not in b:
                out.append((p, a[k], "<实现没有>"))
            else:
                out += diff(a[k], b[k], p)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append((path + ".长度", len(a), len(b)))
        for idx, (x, y) in enumerate(zip(a, b)):
            out += diff(x, y, "%s[%d]" % (path, idx))
    else:
        if isinstance(a, bool) != isinstance(b, bool):
            out.append((path, a, b))
        elif a != b:
            out.append((path, a, b))
    return out


def fmt(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v) if abs(v) < 1 << 31 else hx(v)
    return str(v)


def run_case(name, words, n_steps, note, expects_halt, verbose=False):
    """跑一个用例，返回 (通过?, 已走拍数, 失配列表, 备注)"""
    tmpdir = tempfile.mkdtemp(prefix="difftest_")
    binpath = os.path.join(tmpdir, name + ".bin")
    write_bin(words, binpath)

    ref = RefModel(words)
    mismatches = []
    steps_done = 0
    halted_at = None

    try:
        with Sim(binpath) as sim:
            for i in range(n_steps):
                resp = sim.step()
                if resp.get("type") != "cycle_state":
                    raise SimError("step 返回了非 cycle_state: %r" % (resp,))
                got = resp["state"]
                want = ref.step()
                steps_done = i + 1

                d = diff(want, got)
                if d:
                    mismatches.append((i, d))
                    if len(mismatches) >= 3:        # 每个用例最多留 3 拍现场
                        break

                if ref.halted or got.get("halted"):
                    if ref.halted != bool(got.get("halted")):
                        mismatches.append((i, [("halted", ref.halted,
                                                bool(got.get("halted")))]))
                    halted_at = i
                    break
            else:
                if expects_halt:
                    mismatches.append((n_steps, [("halted",
                                                  "应该停机但没有", False)]))

            # 逐字节比对整块内存：状态流里的 memory.* 只反映当拍访存，
            # 累积效果（小端、部分覆盖、越界丢弃）只有把内存整体拉回来才能验
            mem = sim.get_memory(hx(MEM_BASE), 0x2000)
            if isinstance(mem, str):
                mem = [int(x, 16) for x in mem.split()]
            for off, byte in enumerate(mem):
                if ref.read_byte(MEM_BASE + off) != byte:
                    mismatches.append((steps_done, [
                        ("memory[0x%05x]" % off,
                         ref.read_byte(MEM_BASE + off), byte)]))
                    break
    except SimError as e:
        raise
    finally:
        try:
            os.remove(binpath)
            os.rmdir(tmpdir)
        except OSError:
            pass

    return (not mismatches), steps_done, mismatches, halted_at


def main():
    ap = argparse.ArgumentParser(description="RV32I 差分测试")
    ap.add_argument("-c", "--case", help="只跑名字匹配的用例（子串匹配）")
    ap.add_argument("-v", "--verbose", action="store_true", help="每个用例打印一行")
    ap.add_argument("-l", "--list", action="store_true", help="只列用例")
    ap.add_argument("-m", "--max-report", type=int, default=12,
                    help="最多详细展开几个失败用例（默认 12）")
    args = ap.parse_args()

    cases = corpus.build()
    if args.case:
        cases = [c for c in cases if args.case in c[0]]
    if not cases:
        print("没有匹配的用例")
        return 2
    if args.list:
        for name, words, n, note, halt in cases:
            print("%-28s %5d 字 %5d 拍 %s" % (name, len(words), n, note))
        return 0

    if not os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                       "..", "..", "cpp", "build",
                                       "rv32i_sim" + (".exe" if os.name == "nt" else ""))):
        print("[基础设施] 找不到模拟器可执行文件，先编译 C++ 后端")
        return 2

    passed, failed = 0, []
    try:
        for name, words, n, note, halt in cases:
            ok, steps, mism, halted_at = run_case(name, words, n, note, halt,
                                                  args.verbose)
            if ok:
                passed += 1
                if args.verbose:
                    print("  通过  %-28s %4d 拍%s" % (name, steps,
                          "（第 %d 拍停机）" % halted_at if halted_at is not None else ""))
            else:
                failed.append((name, note, steps, mism, halted_at))
                print("  失配  %-28s %4d 拍  %s" % (name, steps, note))
    except SimError as e:
        print("[基础设施] %s" % e)
        return 2

    total = len(cases)
    print()
    print("=" * 78)
    print("差分测试：%d/%d 通过" % (passed, total))
    print("=" * 78)

    if failed:
        print()
        for name, note, steps, mism, halted_at in failed[:args.max_report]:
            print("-" * 78)
            print("用例 %s（%s）" % (name, note))
            for cyc, d in mism[:4]:
                print("  第 %d 拍，%d 处不一致：" % (cyc, len(d)))
                for path, want, got in d[:14]:
                    print("    %-42s 参照=%-14s 实现=%s"
                          % (path, fmt(want), fmt(got)))
                if len(d) > 14:
                    print("    ... 另有 %d 处" % (len(d) - 14))
        if len(failed) > args.max_report:
            print("-" * 78)
            print("另有 %d 个失败用例未展开（-m 调大）" % (len(failed) - args.max_report))
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
