# -*- coding: utf-8 -*-
"""网络标签打架修复。

两处问题（都是渲染出来肉眼看到的，几何自检管不到，因为 net 方框是渲染期画的）：

【左上角】pcmux5 / pcmux6 右壁的网络标签方框
  m5_1(net=mtvec) 的方框往右伸 8.8+30.1 就撞上 pcmux6 的左壁；
  m6_1(net=mepc) 的方框撞上 pcmux1 的左壁。
  方框宽度 = 字数×9.3+14（渲染像素），一个"胶囊+引线+方框"要吃掉 74.4 JSON。
  原来的间距只有 22 / 30，塞不下。所以把 pcmux5(100→46) 和 pcmux6(152→130) 整体左移，
  把三段空间重新分配成 74.4 / 84 / 82，方框之间留出 ≥22 渲染像素的净空。
  pcmux1 不动（它的 sel 引线 x=228 是贴着 pc4adder 左壁算出来的，动它会连带一串）。

【译码器左壁】竖线 w_jalr_m3（x=497，y 238..872）横穿 7 个标签方框
  这条线不能整条挪走：它的终点 pcmux3.m3_1 在胶囊**右**壁(x=473)，
  末段必须从右边水平切入，所以竖线只能落在 x∈(473,524)——正好是标签列。
  解法：让它**从标签列上方折进来**。长竖线改走 x=452（西边让开 imem 的 438，
  东边让开最宽的方框 csr_addr 的 463.2），到 y=293 再折回 x=497 上行到 y=238 进端口。
  同时把 7 个标签端口从"挤在 y 480..660 一段"改成两段：
    y 314/342/370/398（4 个）+ y 462/490/518（3 个）
  这样每个方框上下都留出 ≥23 渲染像素，也避开了 w_imem_dec(y=545) 和 w_sel_m1(y=440)
  这两条本来会从方框中间穿过去的横线。

x=452 的余量核算（渲染像素，要求 ≥18 净距 / ≥20 平行间距）：
  imem 右壁 438 → 23.8 ✓   csr 右壁 440 → 20.4 ✓
  csr_addr 方框左沿 463.2 → 19.1 ✓
  w_sel_m3 竖线 x=457.5 但 y 只到 280，本线从 293 起，y 不重叠 ✓
"""
import io
import json

P = 'frontend/src/data/datapathLayout.json'
L = json.load(io.open(P, encoding='utf-8'))

# ---- 1. 左上角：pcmux5 / pcmux6 左移，重接三条线 ----
MOVES = {'pcmux5': 46, 'pcmux6': 130}
NEW_PTS = {
    'w_m1_m6': [[212, 196], [160, 196]],          # pcmux1.m1_out -> pcmux6.m6_0
    'w_m6_m5': [[130, 196], [76, 196]],           # pcmux6.m6_out -> pcmux5.m5_0
    'w_m5_pc': [[46, 196], [20, 196], [20, 482], [106, 482]],
}

# ---- 2. 译码器左壁：7 个标签端口重排成两段 ----
# 原来的 offset 260/290/320/350/380/410/440（y 480..660）重排如下
NET_OFF = {
    'decoder.csr_addr_out': 94,    # y 314
    'decoder.csr_we_out': 122,     # y 342
    'decoder.is_csr_out': 150,     # y 370
    'decoder.illegal_out': 178,    # y 398
    'decoder.ecall_out': 242,      # y 462
    'decoder.ebreak_out': 270,     # y 490
    'decoder.mret_out': 298,       # y 518
}

# ---- 3. w_jalr_m3 绕开标签列 ----
JALR_PTS = [[655, 872], [452, 872], [452, 293], [497, 293], [497, 238], [473, 238]]

for m in L['modules']:
    if m['id'] in MOVES:
        m['x'] = MOVES[m['id']]
for p in L['ports']:
    if p['id'] in NET_OFF:
        p['offset'] = NET_OFF[p['id']]
for w in L['wires']:
    if w['id'] in NEW_PTS:
        w['points'] = NEW_PTS[w['id']]
    elif w['id'] == 'w_jalr_m3':
        w['points'] = JALR_PTS

json.dump(L, io.open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('部件 %d | 端口 %d | 连线 %d' % (len(L['modules']), len(L['ports']), len(L['wires'])))
