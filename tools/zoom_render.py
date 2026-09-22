#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
zoom_render.py —— 把预览图裁成几块放大，逐块肉眼核对布线

几何自检（check_layout.py）只管"有没有违规"，管不了"看起来对不对"，
所以每轮改完都要裁开自己看一遍。

用法：
  python tools/zoom_render.py                  按预设的 4 个区域各出一张
  python tools/zoom_render.py muxa0 alu muxb   裁这几个部件周围并放大
  python tools/zoom_render.py --list           列出所有部件 id

前置：先跑 node tools/preview.mjs 生成 tools/out/datapath-preview.png

坐标说明：JSON 里存的是示意图原始像素，乘以 scale 才是渲染像素，
本脚本按渲染像素裁剪。
"""

import io
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "out", "datapath-preview.png")
LAYOUT = os.path.join(HERE, "..", "frontend", "src", "data", "datapathLayout.json")

TARGET_W = 1600.0   # 放大后的目标长边
MAX_K = 2.5         # 最大放大倍数
PAD = 60.0          # 指定部件时，向外扩这么多渲染像素

# 预设区域（渲染像素 x1,y1,x2,y2），覆盖四块容易出问题的布线区
PRESETS = {
    "pcmux": (140, 20, 1080, 560),      # 左上：三个 PC-MUX + pc4adder + taken
    "muxa0": (900, 130, 1900, 780),     # 右上：pcimmadder + muxa0 + ALU 入口
    "wb":    (900, 600, 2100, 1260),    # 右下：两级写回 MUX + 写回链
    "ctl":   (500, 620, 1900, 1450),    # 中下：译码器控制信号 + 时钟复位
}


def main():
    with io.open(LAYOUT, encoding="utf-8") as f:
        L = json.load(f)
    SC = float(L.get("scale", 1.0))
    mods = {m["id"]: m for m in L.get("modules", [])}

    args = sys.argv[1:]

    if args == ["--list"]:
        print("部件 id（%d 个）：" % len(mods))
        for mid, m in mods.items():
            print("  %-12s shape=%-6s label=%r" % (mid, m.get("shape", ""), m.get("label", "")))
        return 0

    if not os.path.exists(SRC):
        print("[FAIL] 找不到预览图：%s" % SRC)
        print("       先跑 node tools/preview.mjs")
        return 1

    img = Image.open(SRC)
    print("原图 %dx%d" % img.size)

    if not args:
        jobs = list(PRESETS.items())
    else:
        jobs = []
        for mid in args:
            m = mods.get(mid)
            if m is None:
                print("[WARN] 没有部件 %s，跳过（用 --list 看全部 id）" % mid)
                continue
            jobs.append((mid, (
                m["x"] * SC - PAD,
                m["y"] * SC - PAD,
                (m["x"] + m["w"]) * SC + PAD,
                (m["y"] + m["h"]) * SC + PAD,
            )))
        if not jobs:
            return 1

    W, H = img.size
    for name, box in jobs:
        x1 = max(0.0, box[0])
        y1 = max(0.0, box[1])
        x2 = min(float(W), box[2])
        y2 = min(float(H), box[3])
        if x2 - x1 < 2 or y2 - y1 < 2:
            print("[WARN] %s 的裁剪框为空，跳过" % name)
            continue

        crop = img.crop((int(x1), int(y1), int(x2), int(y2)))
        w, h = crop.size
        k = min(MAX_K, TARGET_W / max(w, h))
        if k > 1.0:
            crop = crop.resize((int(w * k), int(h * k)), Image.LANCZOS)
        else:
            k = 1.0

        out = os.path.join(HERE, "out", "zoom_%s.png" % name)
        crop.save(out)
        print("  %-10s (%d,%d)-(%d,%d) -> %s  放大 %.1fx"
              % (name, x1, y1, x2, y2, crop.size, k))

    print("\n输出目录：tools/out/zoom_*.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
