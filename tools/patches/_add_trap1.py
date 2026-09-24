# -*- coding: utf-8 -*-
"""中断异常模块 · 第一批：PC 链末端插两级（trap / mret）。

后端 rv_core.cpp 里 trap 和 mret 都是算完 PC 目标之后**提前 return** 的：
    if (中断条件) { raise_trap(...); return; }   // m_pc = mtvec
    if (INVALID)  { raise_trap(...); return; }   // m_pc = mtvec
    ...正常路径算 target...
    if (ecall/ebreak) { raise_trap(...); return; }  // m_pc = mtvec
    if (mret) { m_pc = mepc; return; }
    m_pc = target;
所以这两级必须串在**最靠近 PC 的地方**（优先级最高），不能塞进 pcmux1 的输入侧。

位置：pcmux1 左壁在 x=212，PC 左壁在 x=106，中间 106 单位本来是空的，
正好放两个胶囊：pcmux5(100..130) / pcmux6(152..182)，间隙 22 / 30。
四个数据引脚全部落在 off=44，与 pcmux1.m1_out 等高，连线全是水平直线。
pcmux5.m5_out 绕到 x=66 再南下进 PC.pc_next（沿用原来 w_m1_pc 的走法）。
"""
import io
import json

P = 'frontend/src/data/datapathLayout.json'
L = json.load(io.open(P, encoding='utf-8'))

Y, H, W = 152, 88, 30
OUT_OFF = H / 2.0          # 44，胶囊正中，也是数据引脚高度

NEW_MODS = [
    {'id': 'pcmux5', 'label': 'MUX', 'shape': 'mux', 'group': 'TRAP',
     'x': 100, 'y': Y, 'w': W, 'h': H,
     'tip': 'PC 源 5 选 1 的第 5 级：trap 发生时 PC 强制跳到 mtvec。'
            '优先级最高，串在最靠近 PC 的位置，对应后端 raise_trap() 后立刻 return。'},
    {'id': 'pcmux6', 'label': 'MUX', 'shape': 'mux', 'group': 'TRAP',
     'x': 152, 'y': Y, 'w': W, 'h': H,
     'tip': 'PC 源的第 4 级：mret 执行时 PC 跳回 mepc。与 trap 互斥，串在 trap 级的下一级。'},
]

NEW_PORTS = [
    # pcmux6：0 = 正常四选一链（pcmux1 的输出），1 = mepc
    {'id': 'pcmux6.m6_0', 'module': 'pcmux6', 'side': 'right', 'offset': OUT_OFF, 'label': '0'},
    {'id': 'pcmux6.m6_1', 'module': 'pcmux6', 'side': 'right', 'offset': 74, 'label': '1',
     'net': 'mepc'},
    {'id': 'pcmux6.m6_out', 'module': 'pcmux6', 'side': 'left', 'offset': OUT_OFF, 'label': ''},
    {'id': 'pcmux6.m6_sel', 'module': 'pcmux6', 'side': 'bottom', 'offset': W / 2.0, 'label': '',
     'net': 'is_mret'},
    # pcmux5：0 = pcmux6 的输出，1 = mtvec
    {'id': 'pcmux5.m5_0', 'module': 'pcmux5', 'side': 'right', 'offset': OUT_OFF, 'label': '0'},
    {'id': 'pcmux5.m5_1', 'module': 'pcmux5', 'side': 'right', 'offset': 74, 'label': '1',
     'net': 'mtvec'},
    {'id': 'pcmux5.m5_out', 'module': 'pcmux5', 'side': 'left', 'offset': OUT_OFF, 'label': ''},
    {'id': 'pcmux5.m5_sel', 'module': 'pcmux5', 'side': 'bottom', 'offset': W / 2.0, 'label': '',
     'net': 'trap_taken'},
]

# pcmux1.m1_out 不再直连 PC，改为接 pcmux6 的 0 输入
REWIRE = {
    'w_m1_pc': {'id': 'w_m1_m6', 'from': 'pcmux1.m1_out', 'to': 'pcmux6.m6_0',
                'points': [[212, 196], [182, 196]], 'kind': 'data'},
}
NEW_WIRES = [
    {'id': 'w_m6_m5', 'from': 'pcmux6.m6_out', 'to': 'pcmux5.m5_0',
     'points': [[152, 196], [130, 196]], 'kind': 'data', 'label': ''},
    {'id': 'w_m5_pc', 'from': 'pcmux5.m5_out', 'to': 'PC.pc_next',
     'points': [[100, 196], [66, 196], [66, 482], [106, 482]], 'kind': 'data', 'label': 'pc_next'},
]

L['modules'].extend(NEW_MODS)
L['ports'].extend(NEW_PORTS)

by_id = {w['id']: w for w in L['wires']}
old = by_id['w_m1_pc']
L['wires'].remove(old)
L['wires'].append(REWIRE['w_m1_pc'])
L['wires'].extend(NEW_WIRES)

json.dump(L, io.open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('部件 %d | 端口 %d | 连线 %d' % (len(L['modules']), len(L['ports']), len(L['wires'])))
