# -*- coding: utf-8 -*-
"""左下角 trap 模块布局修复。

渲染出来肉眼看到的两处错（几何自检管不到，因为 net 方框是渲染期画的）：

【1】csr 右壁的 csr_old / mtvec / mepc 三个方框被 w_jalr_m3 的竖线(x=452)横穿
     那条竖线不能挪：终点 pcmux3.m3_1 在胶囊右壁(x=473)，末段必须从右边水平切入，
     而译码器左壁又排满了 7 个标签方框(463.2..515.2)，所以竖线只能落在 x≈452。
     解法：csr 的三个输出端口从**右壁改到底壁**。底壁下方 y 890..905 这一带是空的
     （下面最近的横线是 w_clk_dmem 的 y=946，净距 41 单位），方框横排放得下。

【2】csr 左壁的 csr_addr / csr_we / src1_rdata 三个方框压在 trap 判据 的红色框上
     csr 在 x 290..440，左壁方框要往左吃掉 8.8+62.94=71.7，最远伸到 x=218.3；
     而 trap 判据 占 150..260 —— 直接叠住。
     解法：trap 判据 左移到 76..186（左壁方框 20.7..67.2，仍在画布内），
     csr 左移到 280..430。两者之间留 94 单位，方框之间留 22.3 单位。

【3】连带：w_clk_dmem 原本从 clkmod 往东到 x=135 再南下的长竖线(x=135, y612..946)
     正好把 x=76..186 这段切开了——trap 判据 挪过去就会撞上它；它的左壁方框
     (20.7..67.2) 也会被它穿过。而左下角只有 0..135 这么一块宽，塞不下
     "110 宽部件 + 47 宽方框"。
     解法：w_clk_dmem 的竖线改走 x=8（clkmod 出口先水平往西到 8 再南下）。
     代价是 y=612 这条横线会与 w_reset_rf 的竖线(x=60)相交一次——按绘图规则画隆起。

改完的净距核算（JSON 单位；自检要求 净距≥10.588、平行间距≥11.76）：
  trap 判据(76..186) ↔ w_clk_dmem 竖线 x=8        : 68
  trap 判据左壁方框左沿 20.7 ↔ 竖线 x=8           : 12.7  (=21.6 渲染像素)
  csr 左壁方框左沿 208.26 ↔ trap 判据 右壁 186    : 22.3
  csr 右壁 430 ↔ w_jalr_m3 竖线 x=452             : 22
  csr 上沿 782 ↔ w_reset_rf 横线 y=770            : 12    (=20.4 渲染像素)
  csr 底壁方框下沿 904.9 ↔ w_clk_dmem 横线 y=946  : 41.1
  w_csr_irq 竖线 x=200 ↔ trap 判据 右壁 186       : 14    (=23.8 渲染像素)
"""
import io
import json

P = 'frontend/src/data/datapathLayout.json'
L = json.load(io.open(P, encoding='utf-8'))

# ---- 1. 部件位置 ----
MOVES = {
    'trapunit': {'x': 76,  'y': 800},
    'csr':      {'x': 280, 'y': 782},
}

# ---- 2. csr 的端口：三个输出从右壁改到底壁；irq_out 从左壁改到底壁 ----
# 底壁上从左上角起 10 / 45 / 90 / 135
PORT_MOVE = {
    'csr.irq_out':    {'side': 'bottom', 'offset': 10},
    'csr.rdata_out':  {'side': 'bottom', 'offset': 45},
    'csr.mtvec_out':  {'side': 'bottom', 'offset': 90},
    'csr.mepc_out':   {'side': 'bottom', 'offset': 135},
}

# ---- 3. clkmod 加一个左壁出口 ----
# 原来 clkmod 只有一个右壁出口(128,612)，两条时钟线都从那儿分叉。
# 现在 w_clk_dmem 要往**西**走，如果还从右壁出去，那条横线会从
# clkmod 的文字标签框(66..128, 601..623)正中间穿过去，把 "clock" 划掉。
# 所以给它单独开一个左壁出口，两条时钟线各走各的。
NEW_PORTS = [
    {'id': 'clkmod.out_w', 'module': 'clkmod', 'side': 'left', 'offset': 11, 'label': ''},
]

# ---- 4. 连线 ----
# w_clk_dmem：竖线 135 -> 8（避开 trap 判据 和它的方框），出口改走左壁
# w_csr_irq ：改从 csr 底壁出来，从下方绕到 trap 判据 右壁
NEW_PTS = {
    'w_clk_dmem': [[66, 612], [8, 612], [8, 946], [1362, 946], [1362, 754]],
    'w_csr_irq':  [[290, 882], [290, 925], [200, 925], [200, 830], [186, 830]],
}
REWIRE = {'w_clk_dmem': 'clkmod.out_w'}

for m in L['modules']:
    if m['id'] in MOVES:
        m.update(MOVES[m['id']])
for p in L['ports']:
    if p['id'] in PORT_MOVE:
        p.update(PORT_MOVE[p['id']])
L['ports'].extend(NEW_PORTS)
for w in L['wires']:
    if w['id'] in NEW_PTS:
        w['points'] = NEW_PTS[w['id']]
    if w['id'] in REWIRE:
        w['from'] = REWIRE[w['id']]

json.dump(L, io.open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('部件 %d | 端口 %d | 连线 %d' % (len(L['modules']), len(L['ports']), len(L['wires'])))
