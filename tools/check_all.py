#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_all.py —— 一条命令跑完全部离线断言

为什么需要它：断言散在好几个独立脚本里，得有人记得挨个跑。`_csr_test.s` 的状态流
（out/_csr_states.jsonl）早就生成过，但两个 check 脚本缺省只吃 _hl_states.jsonl，
于是 _wave_check.mjs 里那几条 CSR 反向断言长期**等于没跑**——脚本是绿的，
因为它压根没看那个文件。这个脚本把「生成状态流 + 逐个校验」串成一条链，
谁漏跑都会在这里露出来。

步骤：
  1. 每份夹具 → cycle_state 流（每次都重新生成，避免验到过期的 JSONL）
  2. check_dangling.py   悬空端口扫描
  3. check_layout.py     几何自检（间距/重叠/端口位置）
  4. preview.mjs         场景树能不能建出来（datapathScene.ts 的绘制规则）
  5. test_branch_visual.mjs  条件分支的图上接口：taken 用通用 branch_in 进、
                         通用 branch.taken 出，没有 BEQ 专用端口/连线的残留
  6. _hl_check.mjs   ×N  高亮语义：连线/网络/部件
  7. _wave_check.mjs ×N  波次划分 + MUX 互斥 + 切片回归
  8. _lang_check.mjs     前端关键字表 ↔ asm.py 实际能力
  9. _glossary_check.mjs 术语表：字数 / 互链层级 / 别名冲突 / 图上映射覆盖率
 10. _palette_check.mjs  连线配色标准：CSS 高亮色 ↔ 调色板 ↔ 每条线的 kind，
                         以及线色之间、线色与部件描边色之间够不够分得开

用法：python tools/check_all.py [--no-regen]   （--no-regen 跳过第 1 步，用现成的 JSONL）
退出码：0 = 没有失败（可能有跳过），1 = 有失败（哪一步失败会在结尾列出来）

关于「跳过」：子脚本用退出码 3 表示「这次环境跑不了，不是断言失败」。目前有两个会这样：
_lang_check.mjs 要读 riscvLang.ts，而那份文件依赖 @codemirror/language；
_palette_check.mjs 要动态 import datapathPalette.ts。交付包故意不带
frontend/node_modules，这两个就可能跳过。跳过**不算通过**，所以会在结尾单列出来，
免得「没跑」被当成「跑过了」。
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# 夹具 → 状态流。改夹具就得重新生成，所以这里写死对应关系而不是扫目录。
FIXTURES = [
    ("_hl_test.s", "_hl_states.jsonl"),
    ("_hl_ecall.s", "_hl_ecall_states.jsonl"),
    ("_csr_test.s", "_csr_states.jsonl"),
    ("_hl_branch.s", "_hl_branch_states.jsonl"),
]

# 子脚本约定：退出码 3 = 跳过（环境缺失，非断言失败）。见文件头说明。
SKIP = 3

# 中文 Windows 上 Python 3.14 的 stdout 默认是 GBK，而下面「语法高亮表 ↔ asm.py 对账」
# 这一行的描述里有 U+2194，print 时直接抛 UnicodeEncodeError 把整个脚本崩掉——
# 表现成「跑不完」，看着像断言失败，其实只是打印失败。子进程由 run() 设了
# PYTHONIOENCODING，父进程自己也得设：改成 UTF-8，编不出的字符退化成 ? 而不是崩。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass


def run(desc, argv, cwd=None):
    """跑一条命令，返回 (描述, 退出码, 输出尾部)。"""
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    p = subprocess.run(argv, cwd=cwd or ROOT, env=env,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    tail = "\n".join(out.strip().splitlines()[-2:]) if out.strip() else "(无输出)"
    return desc, p.returncode, tail


def main():
    regen = "--no-regen" not in sys.argv
    results = []

    if regen:
        for src, out in FIXTURES:
            results.append(run(
                f"生成状态流 {out}",
                [sys.executable, os.path.join(HERE, "_states.py"),
                 os.path.join(HERE, src), os.path.join(HERE, "out", out)],
            ))
    else:
        print("（--no-regen：沿用现有 JSONL，不重新生成）")

    results.append(run("悬空端口扫描", [sys.executable, os.path.join(HERE, "check_dangling.py")]))
    results.append(run("几何自检", [sys.executable, os.path.join(HERE, "check_layout.py")]))
    results.append(run("场景树渲染（preview.mjs）", ["node", os.path.join(HERE, "preview.mjs")]))
    # 条件分支的图上接口。datapathHighlight.ts 按 'state.branch.taken' 这套通用名字
    # 找线，而名字写在 JSON 里、类型系统管不到；改错了是**静默**失效（分支永远不亮），
    # 所以用断言钉住。脚本自己用 process.cwd() 找仓库根，run() 默认 cwd=ROOT 正好对上。
    results.append(run("条件分支图上接口", ["node", os.path.join(HERE, "test_branch_visual.mjs")]))

    for _, out in FIXTURES:
        jl = os.path.join(HERE, "out", out)
        if not os.path.exists(jl):
            results.append((f"高亮检查 {out}", 1, "状态流不存在（去掉 --no-regen 再跑一次以生成它）"))
            results.append((f"波次检查 {out}", 1, "状态流不存在"))
            continue
        results.append(run(f"高亮检查 {out}", ["node", os.path.join(HERE, "_hl_check.mjs"), jl]))
        results.append(run(f"波次检查 {out}", ["node", os.path.join(HERE, "_wave_check.mjs"), jl]))

    results.append(run("语法高亮表 ↔ asm.py 对账", ["node", os.path.join(HERE, "_lang_check.mjs")]))
    # --strict：MODULE_GLOSSARY / LABEL_GLOSSARY 映射的目标词条必须真存在。
    # 图上 28 个部件现已全部有词条，映射表不该再有悬空项——再出现就是漏了。
    results.append(run("术语表自检", ["node", os.path.join(HERE, "_glossary_check.mjs"), "--strict"]))
    # 配色标准：CSS 的 --dp-hl-* ↔ 调色板的 HILITE ↔ 布局里每条线的 kind。
    # 这三处跨了 CSS / TS / JSON 三种载体，编译器一个都管不到，且全都是**静默**
    # 失效（线悄悄变蓝、控制线通电后虚线消失），只有断言抓得住。
    results.append(run("连线配色标准", ["node", os.path.join(HERE, "_palette_check.mjs")]))

    print("")
    print("=" * 72)
    failed, skipped = [], []
    for desc, code, tail in results:
        if code == 0:
            print(f"[通过] {desc}")
            continue
        if code == SKIP:
            print(f"[跳过] {desc}")
            skipped.append(desc)
        else:
            print(f"[失败] {desc}")
            failed.append(desc)
        for line in tail.splitlines():
            print(f"        {line}")
    print("=" * 72)
    if failed or skipped:
        parts = []
        if failed:
            parts.append(f"失败 {len(failed)} 步：{'、'.join(failed)}")
        if skipped:
            parts.append(f"跳过 {len(skipped)} 步（环境缺失，没跑就等于没验）：{'、'.join(skipped)}")
        print(f"共 {len(results)} 步，" + "；".join(parts))
        return 1 if failed else 0
    print(f"共 {len(results)} 步，全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
