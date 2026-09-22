# -*- coding: utf-8 -*-
"""写回链（wbmux → wbmux1 → wbmux0）标签方框挤在一起。

渲染出来看到的：wbmux1 插进 wbmux 和 wbmux0 之间后，走廊宽度不够了。
  wbmux 右壁 1024 → wbmux0 左壁 1150，只有 126 单位。
  里面要塞：
    pc+4 方框    = 引线 8.8 + 字宽 30.1        = 38.9
    间隙                                            10.6
    wbmux1 胶囊                                  30
    间隙                                            10.6
    csr_old 方框 = 引线 8.8 + 字宽 46.5        = 55.3
                                            合计 145.4  —— 差 19.4
  结果就是 pc+4 方框右沿压到 wbmux1 左壁、csr_old 方框右沿压到 wbmux0 左壁。

解法：把 wbmux 左移 15(995→980)、wbmux0 右移 10(1150→1160)，走廊扩到 151。
（字宽按渲染公式 字数×9.3+14 算，再除 1.7 换算回 JSON 单位。）

改完的净距（渲染像素 = JSON × 1.7）：
  pc+4 方框右沿 1047.9 ↔ wbmux1 左壁 1060 : 12.1 → 20.6 ✓
  csr_old 方框右沿 1145.3 ↔ wbmux0 左壁 1160 : 14.7 → 25.0 ✓
  wbmux1 右壁 1090 ↔ csr_old 方框左沿 1098.8 : 8.8 → 15.0（方框与胶囊，自检不管）
"""
import io
import json

P = 'frontend/src/data/datapathLayout.json'
L = json.load(io.open(P, encoding='utf-8'))

MOVES = {'wbmux': 980, 'wbmux0': 1160}

NEW_PTS = {
    # wbmux 左移 15
    'w_wb_rf':   [[980, 755], [812, 755], [812, 658]],
    'w_wb1_wb':  [[1060, 741], [1009, 741]],
    'w_ctl_link': [[534, 684], [534, 838], [994.5, 838], [994.5, 800]],
    # wbmux0 右移 10
    'w_wb0_wb':    [[1160, 775], [1090, 775]],
    'w_alu_wb0':   [[1172, 538], [1200, 538], [1200, 782], [1189, 782]],
    'w_dmem_wb0':  [[1258, 710], [1250, 710], [1250, 806], [1189, 806]],
    'w_ctl_memtoreg': [[574, 344], [626, 344], [626, 694], [1174.5, 694], [1174.5, 760]],
    # 连带：w_ctl_alusrc 的折点在 x=983，wbmux 左移到 980 后正好压住它，
    # 折点退到 x=965（距 wbmux 左壁 15 单位 = 25.5 渲染像素）
    'w_ctl_alusrc': [[558, 684], [558, 712], [965, 712], [965, 667], [1013, 667], [1013, 654]],
}

for m in L['modules']:
    if m['id'] in MOVES:
        m['x'] = MOVES[m['id']]
for w in L['wires']:
    if w['id'] in NEW_PTS:
        w['points'] = NEW_PTS[w['id']]

json.dump(L, io.open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('部件 %d | 端口 %d | 连线 %d' % (len(L['modules']), len(L['ports']), len(L['wires'])))
