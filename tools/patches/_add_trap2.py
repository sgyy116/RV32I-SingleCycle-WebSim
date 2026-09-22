# -*- coding: utf-8 -*-
"""中断异常模块 · 第二批：CSR 寄存器组 + trap 判据单元 + 写回第三级。

后端 rv_core.cpp 的真实信号（全部核对过）：
  CSR  : mtvec(0x305) mepc(0x341) mcause(0x342) mtval(0x343) mstatus(0x300)
         mie(0x304) mip(0x344) mtime(0xC01) mtimecmp(0x780)
  触发 : ① 计时器中断 mtime>=mtimecmp && mie.MTIE && mstatus.MIE → cause 0x80000007
         ② 非法指令 → cause 2   ③ ecall → 11   ④ ebreak → 3
  写回 : wb.source 有第 4 种取值 "CSR"（读出的旧值），优先级最高（最后覆盖）

布局取舍（三处空白区，脚本扫出来的）：
  - trapunit / csr 放左下角 JSON(150..440, 780..880)，避开 imem 和 w_clk_dmem(x=135)
  - wbmux1 放在 wbmux0(1150) 与 wbmux(995) 之间，而不是 wbmux 左边——
    wbmux 左边那条 y 带被 680/712/755/838/872 五条横线切碎，塞不下 88 高的胶囊
  - 跨图信号一律用**端口网络标签** net（decoder 有 7 个新端口挂标签，不拉实体线），
    这样译码器四边已满的问题就不用解决了
"""
import io
import json

P = 'frontend/src/data/datapathLayout.json'
L = json.load(io.open(P, encoding='utf-8'))

NEW_MODS = [
    {'id': 'trapunit', 'label': 'trap 判据', 'shape': 'rect', 'group': 'TRAP',
     'x': 150, 'y': 800, 'w': 110, 'h': 80,
     'sub': '异常 / 中断',
     'tip': '四路触发源的汇合点：非法指令、ecall、ebreak 来自译码器，'
            '计时器中断来自 CSR（mtime>=mtimecmp 且 mie.MTIE 且 mstatus.MIE）。'
            '任一路成立就拉高 trap_taken，PC 立刻改跳 mtvec。'},
    {'id': 'csr', 'label': 'CSR 寄存器组', 'shape': 'rect', 'group': 'TRAP',
     'x': 290, 'y': 780, 'w': 150, 'h': 100,
     'sub': 'mtvec/mepc/mcause/mstatus/mie/mip',
     'tip': '机器模式控制状态寄存器。写数据来自 rs1，地址来自指令的 csr 字段；'
            '读出的旧值走 wb.source="CSR" 这一路写回 rd。'},
    {'id': 'wbmux1', 'label': 'MUX', 'shape': 'mux', 'group': 'WB',
     'x': 1060, 'y': 710, 'w': 30, 'h': 88,
     'tip': '写回源第 3 级：CSR 指令读出的旧值。后端里它是最后覆盖的，'
            '所以串在 pc+4 那级之后，但 CSR 指令不会同时是 jump/jalr，两者等价。'},
]

NEW_PORTS = [
    # ---- 译码器：7 个新端口全部挂网络标签，不拉实体线 ----
    # 译码器四条边原本就满了（上 2 / 右 10 / 下 2 / 左 2），左壁 off 250..464 还空着
    {'id': 'decoder.csr_addr_out', 'module': 'decoder', 'side': 'left', 'offset': 260,
     'label': '', 'net': 'csr_addr'},
    {'id': 'decoder.csr_we_out', 'module': 'decoder', 'side': 'left', 'offset': 290,
     'label': '', 'net': 'csr_we'},
    {'id': 'decoder.is_csr_out', 'module': 'decoder', 'side': 'left', 'offset': 320,
     'label': '', 'net': 'is_csr'},
    {'id': 'decoder.illegal_out', 'module': 'decoder', 'side': 'left', 'offset': 350,
     'label': '', 'net': 'illegal'},
    {'id': 'decoder.ecall_out', 'module': 'decoder', 'side': 'left', 'offset': 380,
     'label': '', 'net': 'ecall'},
    {'id': 'decoder.ebreak_out', 'module': 'decoder', 'side': 'left', 'offset': 410,
     'label': '', 'net': 'ebreak'},
    {'id': 'decoder.mret_out', 'module': 'decoder', 'side': 'left', 'offset': 440,
     'label': '', 'net': 'is_mret'},

    # ---- trap 判据单元 ----
    {'id': 'trapunit.illegal_in', 'module': 'trapunit', 'side': 'left', 'offset': 12,
     'label': '', 'net': 'illegal'},
    {'id': 'trapunit.ecall_in', 'module': 'trapunit', 'side': 'left', 'offset': 32,
     'label': '', 'net': 'ecall'},
    {'id': 'trapunit.ebreak_in', 'module': 'trapunit', 'side': 'left', 'offset': 52,
     'label': '', 'net': 'ebreak'},
    {'id': 'trapunit.irq_in', 'module': 'trapunit', 'side': 'right', 'offset': 30,
     'label': ''},
    {'id': 'trapunit.taken_out', 'module': 'trapunit', 'side': 'bottom', 'offset': 55,
     'label': '', 'net': 'trap_taken'},

    # ---- CSR 寄存器组 ----
    {'id': 'csr.addr_in', 'module': 'csr', 'side': 'left', 'offset': 15,
     'label': '', 'net': 'csr_addr'},
    {'id': 'csr.we_in', 'module': 'csr', 'side': 'left', 'offset': 40,
     'label': '', 'net': 'csr_we'},
    {'id': 'csr.wdata_in', 'module': 'csr', 'side': 'left', 'offset': 65,
     'label': '', 'net': 'src1_rdata'},
    {'id': 'csr.irq_out', 'module': 'csr', 'side': 'left', 'offset': 90, 'label': ''},
    {'id': 'csr.rdata_out', 'module': 'csr', 'side': 'right', 'offset': 20,
     'label': '', 'net': 'csr_old'},
    {'id': 'csr.mtvec_out', 'module': 'csr', 'side': 'right', 'offset': 50,
     'label': '', 'net': 'mtvec'},
    {'id': 'csr.mepc_out', 'module': 'csr', 'side': 'right', 'offset': 80,
     'label': '', 'net': 'mepc'},

    # ---- 写回第 3 级 ----
    {'id': 'wbmux1.wb1_1', 'module': 'wbmux1', 'side': 'right', 'offset': 48,
     'label': '1', 'net': 'csr_old'},
    {'id': 'wbmux1.wb1_0', 'module': 'wbmux1', 'side': 'right', 'offset': 65,
     'label': '0'},
    {'id': 'wbmux1.wb1_out', 'module': 'wbmux1', 'side': 'left', 'offset': 31, 'label': ''},
    {'id': 'wbmux1.wb1_sel', 'module': 'wbmux1', 'side': 'bottom', 'offset': 15,
     'label': '', 'net': 'is_csr'},
]

# w_wb0_wb 原来直连 wbmux.wb_0，现在改接 wbmux1 的 0 输入
REWIRE = {
    'w_wb0_wb': {'points': [[1150, 775], [1090, 775]]},
}

NEW_WIRES = [
    {'id': 'w_wb1_wb', 'from': 'wbmux1.wb1_out', 'to': 'wbmux.wb_0',
     'points': [[1060, 741], [1024, 741]], 'kind': 'data', 'label': ''},
    {'id': 'w_csr_irq', 'from': 'csr.irq_out', 'to': 'trapunit.irq_in',
     'points': [[290, 870], [275, 870], [275, 830], [260, 830]],
     'kind': 'control', 'label': ''},
]

L['modules'].extend(NEW_MODS)
L['ports'].extend(NEW_PORTS)
for w in L['wires']:
    if w['id'] in REWIRE:
        w['points'] = REWIRE[w['id']]['points']
        # wbmux0.wb0_out 的终点从 wbmux.wb_0 改成 wbmux1.wb1_0
        w['to'] = 'wbmux1.wb1_0'
L['wires'].extend(NEW_WIRES)

json.dump(L, io.open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('部件 %d | 端口 %d | 连线 %d' % (len(L['modules']), len(L['ports']), len(L['wires'])))
