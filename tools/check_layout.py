#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_layout.py —— 数据通路布局几何自检

校验 datapathLayout.json，抓这几类错误：
  1. 部件矩形互相重叠
  2. 部件超出画布
  3. 连线端点与它声称连接的端口位置不符（±TOL 容差）—— 上一轮图的致命伤
  4. 连线线段穿过它不该穿过的部件内部
  5. 连线端点引用了不存在的端口 / 部件
  6. 线段不是水平或垂直（排版歪斜）
  7. 端口位置不在其部件的边框上

用法：python tools/check_layout.py
退出码：0 = 全部通过，1 = 有错误
"""

import json
import os
import sys

TOL = 2.0          # 坐标容差（像素）
INSET = 1.0        # 判断"穿框"时把部件内缩这么多，避免端点在边框上被误判
MIN_GAP = 20.0     # 两条平行线段的最小间距；0 表示完全重合（分叉共用一段），允许
CLEARANCE = 18.0   # 线段到部件框的最小净距（渲染像素）
# 注：INSET 只内缩 1px，"擦边而过"抓不到，所以单列一项净距检查。
# shape=text 的部件只是文字标签，没有实体边框，不参与净距比较。

HERE = os.path.dirname(os.path.abspath(__file__))
LAYOUT = os.path.join(HERE, "..", "frontend", "src", "data", "datapathLayout.json")

errors = []
warnings = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


# ---------- 几何工具 ----------
def rect_of(m):
    return (m["x"], m["y"], m["x"] + m["w"], m["y"] + m["h"])


def rects_overlap(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    return not (ax2 <= bx1 or bx2 <= ax1 or ay2 <= by1 or by2 <= ay1)


def port_pos(module, side, offset):
    """端口坐标：side 决定贴哪条边，offset 是沿该边从左上角起的距离"""
    x, y, w, h = module["x"], module["y"], module["w"], module["h"]
    if side == "left":
        return (x, y + offset)
    if side == "right":
        return (x + w, y + offset)
    if side == "top":
        return (x + offset, y)
    if side == "bottom":
        return (x + offset, y + h)
    raise ValueError(f"未知 side: {side}")


def seg_intersects_rect(p1, p2, rect):
    """线段是否穿过矩形内部（矩形已内缩 INSET）"""
    rx1, ry1, rx2, ry2 = rect
    rx1 += INSET; ry1 += INSET; rx2 -= INSET; ry2 -= INSET
    if rx1 >= rx2 or ry1 >= ry2:
        return False
    (x1, y1), (x2, y2) = p1, p2
    # 水平段
    if abs(y1 - y2) < 0.5:
        if not (ry1 < y1 < ry2):
            return False
        lo, hi = min(x1, x2), max(x1, x2)
        return min(hi, rx2) - max(lo, rx1) > 0.5
    # 垂直段
    if abs(x1 - x2) < 0.5:
        if not (rx1 < x1 < rx2):
            return False
        lo, hi = min(y1, y2), max(y1, y2)
        return min(hi, ry2) - max(lo, ry1) > 0.5
    # 非正交段：用采样近似（正常布局不该出现）
    for t in range(1, 40):
        f = t / 40.0
        px, py = x1 + (x2 - x1) * f, y1 + (y2 - y1) * f
        if rx1 < px < rx2 and ry1 < py < ry2:
            return True
    return False


def main():
    if not os.path.exists(LAYOUT):
        print(f"[FAIL] 找不到布局文件：{LAYOUT}")
        return 1

    with open(LAYOUT, "r", encoding="utf-8") as f:
        L = json.load(f)

    # ---- 统一缩放 ----
    # 布局文件里存的是示意图原始坐标（1415x953），这里按 scale 放大成渲染坐标，
    # 之后再当普通坐标校验。TOL / MIN_GAP 都是"渲染后像素"，不随 scale 变。
    SC = float(L.get("scale", 1.0))
    if SC != 1.0:
        for m in L.get("modules", []):
            for k in ("x", "y", "w", "h"):
                m[k] = round(m[k] * SC, 4)
        for p in L.get("ports", []):
            p["offset"] = round(p["offset"] * SC, 4)
        for w in L.get("wires", []):
            w["points"] = [[round(a * SC, 4), round(b * SC, 4)] for a, b in w["points"]]

    canvas = L["canvas"]
    W, H = canvas["width"], canvas["height"]
    modules = L.get("modules", [])
    ports = L.get("ports", [])
    wires = L.get("wires", [])

    mod_by_id = {}
    for m in modules:
        if m["id"] in mod_by_id:
            err(f"部件 ID 重复：{m['id']}")
        mod_by_id[m["id"]] = m

    # ---- 1. 部件重叠 ----
    for i in range(len(modules)):
        for j in range(i + 1, len(modules)):
            a, b = modules[i], modules[j]
            if rects_overlap(rect_of(a), rect_of(b)):
                err(f"部件重叠：{a['id']} 与 {b['id']}")

    # ---- 2. 越界 ----
    for m in modules:
        x1, y1, x2, y2 = rect_of(m)
        if x1 < 0 or y1 < 0 or x2 > W or y2 > H:
            err(f"部件越界：{m['id']} ({x1},{y1})-({x2},{y2}) 超出 {W}x{H}")
        if m["w"] <= 0 or m["h"] <= 0:
            err(f"部件尺寸非法：{m['id']} w={m['w']} h={m['h']}")

    # ---- 3. 端口合法性 ----
    port_by_id = {}
    for p in ports:
        pid = p["id"]
        if pid in port_by_id:
            err(f"端口 ID 重复：{pid}")
        if p["module"] not in mod_by_id:
            err(f"端口 {pid} 指向不存在的部件 {p['module']}")
            continue
        mod = mod_by_id[p["module"]]
        off, side = p["offset"], p["side"]
        span = mod["w"] if side in ("top", "bottom") else mod["h"]
        if not (0 <= off <= span):
            err(f"端口 {pid} 的 offset={off} 越出部件 {p['module']} 该边长度 {span}")
        px, py = port_pos(mod, side, off)
        if not (0 <= px <= W and 0 <= py <= H):
            err(f"端口 {pid} 坐标越界：({px},{py})")
        port_by_id[pid] = {"spec": p, "pos": (px, py), "module": p["module"]}

    # ---- 4/5/6/7. 连线 ----
    for w in wires:
        wid = w["id"]
        pts = w.get("points") or []
        if len(pts) < 2:
            err(f"连线 {wid} 至少需要 2 个点，当前 {len(pts)}")
            continue

        # 端点引用的端口必须存在
        f_id, t_id = w.get("from"), w.get("to")
        if f_id not in port_by_id:
            err(f"连线 {wid} 的起端端口不存在：{f_id}")
        if t_id not in port_by_id:
            err(f"连线 {wid} 的终端端口不存在：{t_id}")

        # 端点点位必须与端口几何位置一致
        if f_id in port_by_id:
            px, py = port_by_id[f_id]["pos"]
            dx, dy = abs(pts[0][0] - px), abs(pts[0][1] - py)
            if dx > TOL or dy > TOL:
                err(f"连线 {wid} 起点 ({pts[0][0]},{pts[0][1]}) 与端口 {f_id} 位置 ({px:.0f},{py:.0f}) 不符，偏差 {dx:.0f},{dy:.0f}")
        if t_id in port_by_id:
            px, py = port_by_id[t_id]["pos"]
            dx, dy = abs(pts[-1][0] - px), abs(pts[-1][1] - py)
            if dx > TOL or dy > TOL:
                err(f"连线 {wid} 终点 ({pts[-1][0]},{pts[-1][1]}) 与端口 {t_id} 位置 ({px:.0f},{py:.0f}) 不符，偏差 {dx:.0f},{dy:.0f}")

        # 线段：正交 + 不穿框
        own_modules = set()
        for pid in (f_id, t_id):
            if pid in port_by_id:
                own_modules.add(port_by_id[pid]["module"])

        for k in range(len(pts) - 1):
            p1, p2 = pts[k], pts[k + 1]
            if abs(p1[0] - p2[0]) > 0.5 and abs(p1[1] - p2[1]) > 0.5:
                err(f"连线 {wid} 第 {k} 段不是水平/垂直线段：{p1} -> {p2}")
            for m in modules:
                if m["id"] in own_modules:
                    continue
                if seg_intersects_rect(p1, p2, rect_of(m)):
                    err(f"连线 {wid} 第 {k} 段 {p1}->{p2} 穿过部件 {m['id']}")

        # 点位越界
        for (px, py) in pts:
            if not (0 <= px <= W and 0 <= py <= H):
                err(f"连线 {wid} 有点位越界：({px},{py})")

    # ---- 8. 平行线最小间距 ----
    # 收集所有线段：(p1, p2, 属于哪条线)
    segs = []
    for w in wires:
        pts = w.get("points") or []
        for k in range(len(pts) - 1):
            segs.append((pts[k], pts[k + 1], w["id"]))

    def is_vert(s):
        return abs(s[0][0] - s[1][0]) < 0.5

    def is_horz(s):
        return abs(s[0][1] - s[1][1]) < 0.5

    # ---- 9. 线段到部件框的最小净距 ----
    # 检查 4 只能抓"真的穿过去"，抓不到"贴着边框走"。而贴着边框走视觉上
    # 和穿过去一样糟，所以这里单独量：轴对齐线段到矩形四条边的最近距离。
    def seg_rect_gap(p1, p2, r):
        rx1, ry1, rx2, ry2 = r
        (x1, y1), (x2, y2) = p1, p2
        if abs(y1 - y2) < 0.5:                          # 水平段
            lo, hi = min(x1, x2), max(x1, x2)
            dx = max(rx1 - hi, lo - rx2, 0.0)
            dy = max(ry1 - y1, y1 - ry2, 0.0)
            return max(dx, dy)
        if abs(x1 - x2) < 0.5:                          # 垂直段
            lo, hi = min(y1, y2), max(y1, y2)
            dy = max(ry1 - hi, lo - ry2, 0.0)
            dx = max(rx1 - x1, x1 - rx2, 0.0)
            return max(dx, dy)
        return 999.0

    wire_by_id = {w["id"]: w for w in wires}
    for p1, p2, wid in segs:
        w = wire_by_id[wid]
        own = set()
        for pid in (w.get("from"), w.get("to")):
            if pid in port_by_id:
                own.add(port_by_id[pid]["module"])
        for m in modules:
            if m["id"] in own or m.get("shape") == "text":
                continue
            g = seg_rect_gap(p1, p2, rect_of(m))
            if g < CLEARANCE:
                err(f"线段贴部件框：{wid} 段 {p1}->{p2} 距 {m['id']} 仅 {g:.1f}px"
                    f"（要求 ≥{CLEARANCE:.0f}）")

    for i in range(len(segs)):
        for j in range(i + 1, len(segs)):
            a, b = segs[i], segs[j]
            if a[2] == b[2]:
                continue    # 同一条线的段不互相比较（拐角/U 形回绕不算）
            if is_vert(a) and is_vert(b):
                gap = abs(a[0][0] - b[0][0])
                if gap < 0.5:
                    continue    # 完全重合：多条线从同一端口分叉，允许
                ay1, ay2 = sorted((a[0][1], a[1][1]))
                by1, by2 = sorted((b[0][1], b[1][1]))
                if min(ay2, by2) - max(ay1, by1) > 0.5 and gap < MIN_GAP:
                    err(f"平行竖线过近：{a[2]} 与 {b[2]} 相距 {gap:.0f}px（要求 ≥{MIN_GAP:.0f}）"
                        f"，位置 x={a[0][0]:.0f} / x={b[0][0]:.0f}")
            elif is_horz(a) and is_horz(b):
                gap = abs(a[0][1] - b[0][1])
                if gap < 0.5:
                    continue
                ax1, ax2 = sorted((a[0][0], a[1][0]))
                bx1, bx2 = sorted((b[0][0], b[1][0]))
                if min(ax2, bx2) - max(ax1, bx1) > 0.5 and gap < MIN_GAP:
                    err(f"平行横线过近：{a[2]} 与 {b[2]} 相距 {gap:.0f}px（要求 ≥{MIN_GAP:.0f}）"
                        f"，位置 y={a[0][1]:.0f} / y={b[0][1]:.0f}")

    # ---- 检查 10：胶囊形 MUX 的顶/底端口必须落在该边正中 ----
    # 胶囊的顶边和底边就是中心对称轴的两个端点，从那里进出的线只有落在
    # off == w/2 时才和对称轴重合。偏一点看起来就是"箭头插歪了"。
    # 顺带：数据输入 0/1 必须在同一条边上、且是输出边的对边。
    # circle（椭圆）同理：底边中点 (x+w/2, y+h) 就是椭圆最低点，端口偏一点
    # 箭头看着就是插歪了。taken.out 原来在 off=47（正中是 49），这里一并管住。
    mux_mods = {m["id"]: m for m in modules if m.get("shape") in ("mux", "circle")}
    for p in ports:
        m = mux_mods.get(p["module"])
        if not m:
            continue
        if p["side"] in ("top", "bottom") and abs(p["offset"] - m["w"] / 2.0) > 0.01:
            err(f"端口 {p['id']} 在 {p['module']} 的{p['side']}边 off={p['offset']:g}，"
                f"该边正中是 {m['w'] / 2.0:g}（部件宽 w={m['w']:g}），未与中心对称轴重合")
    for mid, m in mux_mods.items():
        outs = [p for p in ports if p["module"] == mid and "out" in p["id"]]
        ins = [p for p in ports if p["module"] == mid and p["id"].endswith(("_0", "_1"))]
        if len(outs) == 1 and len(ins) >= 2:
            osd = outs[0]["side"]
            opposite = {"left": "right", "right": "left", "top": "bottom", "bottom": "top"}[osd]
            bad = [p["id"] for p in ins if p["side"] != opposite]
            if bad:
                err(f"胶囊 {mid} 输出在{osd}边，数据输入应全在{opposite}边，"
                    f"但 {', '.join(bad)} 不在")

    # ---- 附加提示：最长连线 ----
    # 不算错误，只是给人看：跨图长线（动辄绕大半张图）通常说明该改用
    # 端口网络标签（wire 上的 net 字段）而不是真拉一根线过去。
    lens = []
    for w in wires:
        p = w.get("points") or []
        ln = sum(abs(p[k + 1][0] - p[k][0]) + abs(p[k + 1][1] - p[k][1])
                 for k in range(len(p) - 1))
        lens.append((ln, w["id"], w.get("net") or ""))
    lens.sort(reverse=True)
    longest = lens[:8]

    # ---- 报告 ----
    print("=" * 60)
    print(f"布局自检：{os.path.relpath(LAYOUT, os.path.join(HERE, '..'))}")
    print(f"  画布 {W}x{H} | 部件 {len(modules)} | 端口 {len(ports)} | 连线 {len(wires)}")
    print("=" * 60)

    print("\n最长连线 Top 8（跨大半张图的线，考虑改用端口网络标签 net）：")
    for ln, wid, net in longest:
        tag = f"   [已有 net={net}]" if net else ""
        print(f"  {ln:6.0f}px  {wid}{tag}")

    if warnings:
        print(f"\n警告 {len(warnings)} 条：")
        for m in warnings:
            print(f"  [WARN] {m}")

    if errors:
        print(f"\n错误 {len(errors)} 条：")
        for m in errors:
            print(f"  [FAIL] {m}")
        print(f"\n结果：不通过（{len(errors)} 个错误）")
        return 1

    print("\n结果：全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
