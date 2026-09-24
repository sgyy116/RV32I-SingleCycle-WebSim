#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_dangling.py —— 悬空端口扫描

列出所有"既没有连线指过来、也没有网络标签"的端口。这类端口在图上就是
一个不接任何东西的悬空输入，几乎总是漏画。

本轮就是靠它抓出来的：pcmux1/2/3 三个 MUX 的 sel 全没接线，
pcimmadder 的两个输入（a_pc / a_imm）也全悬空。

带 net 字段的端口不算悬空 —— 那是故意用网络标签代替长线的画法。

用法：python tools/check_dangling.py
退出码：0 = 无悬空端口，1 = 有悬空端口
"""

import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LAYOUT = os.path.join(HERE, "..", "frontend", "src", "data", "datapathLayout.json")


def main():
    if not os.path.exists(LAYOUT):
        print("[FAIL] 找不到布局文件：%s" % LAYOUT)
        return 1

    with io.open(LAYOUT, encoding="utf-8") as f:
        L = json.load(f)

    # 被任何一条连线引用的端口
    used = set()
    for w in L.get("wires", []):
        used.add(w.get("from"))
        used.add(w.get("to"))

    by_mod = {}
    for p in L.get("ports", []):
        by_mod.setdefault(p["module"], []).append(p)

    label_of = {m["id"]: m.get("label", "") for m in L.get("modules", [])}

    dangling = []
    for mid, ps in by_mod.items():
        for p in ps:
            if p["id"] in used:
                continue
            if p.get("net"):
                continue        # 用网络标签代替长线，不算悬空
            dangling.append((mid, p))

    print("=" * 60)
    print("悬空端口扫描：%s" % os.path.relpath(LAYOUT, os.path.join(HERE, "..")))
    print("=" * 60)

    if dangling:
        print("\n悬空端口 %d 个：" % len(dangling))
        cur = None
        for mid, p in dangling:
            if mid != cur:
                cur = mid
                print("  %s（%s）" % (mid, label_of.get(mid, "")))
            print("      %-26s side=%-6s off=%-6.1f label=%r"
                  % (p["id"], p["side"], p["offset"], p.get("label", "")))
        print("\n结果：不通过（%d 个悬空端口）" % len(dangling))
        return 1

    print("\n结果：全部通过（无悬空端口）")
    print("\n各部件接线率：")
    for mid, ps in by_mod.items():
        k = sum(1 for p in ps if p["id"] in used or p.get("net"))
        flag = "" if k == len(ps) else "   <-- 有未接端口"
        print("  %-12s %2d/%2d%s" % (mid, k, len(ps), flag))
    return 0


if __name__ == "__main__":
    sys.exit(main())
