// ============================================================================
// datapathLayout.ts —— 单周期数据通路静态布局（第二次调整）
//
// 形状参照 docs/rv32cpu.png（图1）：
//   ADD / ALU = 等边梯形挖去三角；MUX(0/1 部件) = 跑道形（capsule），0/1 居中对齐；
//   其余器件为矩形；所有非 0/1 部件整体缩小。
// 连线以图1布线优先；配色沿用图2（黑=数据 红=跳转分支 青=高亮 橙=中断 紫=mret）。
// 中断/异常部件与基础器件同款式（蓝色），只保留接口（端口 + 连线旁文字）。
// ============================================================================

import type { ActiveWire, ModuleId, ModuleLayout, ValueSlot, WireKind } from '@/types/datapath'
import type { CycleState } from '@/types/simulation'

export const CANVAS_W = 1560
export const CANVAS_H = 1260

/** 模块布局 */
export const MODULES: ModuleLayout[] = [
  {
    id: 'pc', label: 'PC', shape: 'rect',
    x: 210, y: 560, width: 56, height: 100, nameSize: 16,
    description: '程序计数器：每个时钟上升沿载入下一个指令地址',
  },
  {
    id: 'adder-pc4', label: 'ADD', shape: 'adder',
    x: 355, y: 350, width: 80, height: 176, nameSize: 15,
    description: 'PC+4 加法器：计算 pc_add4',
  },
  {
    id: 'adder-branch', label: 'ADD', shape: 'adder',
    x: 960, y: 300, width: 80, height: 176, nameSize: 15,
    description: '分支目标加法器：pc_add4 + imm',
  },
  {
    id: 'imem', label: '指令存储器', sublabel: '（异步）', shape: 'rect',
    x: 370, y: 560, width: 160, height: 210, nameSize: 17,
    description: 'IMEM：按地址 a 取出 32 位指令（inst / spo）',
    ports: [
      { text: 'a', x: 378, y: 589 }, { text: 'd', x: 378, y: 624 },
      { text: 'we', x: 378, y: 659 }, { text: 'clk', x: 378, y: 694 },
      { text: 'spo', x: 522, y: 589, anchor: 'end' },
    ],
  },
  {
    id: 'decoder', label: '译码器', shape: 'rect',
    x: 645, y: 300, width: 44, height: 480, nameSize: 17,
    description: '译码器：产生各控制信号',
    ports: [
      { text: '译', x: 667, y: 460, anchor: 'middle' },
      { text: '码', x: 667, y: 540, anchor: 'middle' },
      { text: '器', x: 667, y: 620, anchor: 'middle' },
    ],
  },
  {
    id: 'regfile', label: '寄存器堆', shape: 'rect',
    x: 760, y: 500, width: 240, height: 230, nameSize: 17,
    description: '寄存器堆：32×32 位通用寄存器，x0 恒为 0',
    ports: [
      { text: 'src1_raddr', x: 768, y: 544 }, { text: 'src2_raddr', x: 768, y: 649 },
      { text: 'reg_wen', x: 768, y: 676 }, { text: 'reg_waddr', x: 768, y: 703 },
      { text: 'reset', x: 834, y: 724, anchor: 'middle' },
      { text: 'clock', x: 882, y: 724, anchor: 'middle' },
      { text: 'src1_rdata', x: 992, y: 569, anchor: 'end' },
      { text: 'src2_rdata', x: 992, y: 677, anchor: 'end' },
      { text: 'reg_wdata', x: 952, y: 726, anchor: 'middle' },
    ],
  },
  {
    id: 'alu', label: 'ALU', shape: 'alu',
    x: 1245, y: 470, width: 100, height: 220, nameSize: 22,
    description: 'ALU：算术逻辑运算，输出结果 F 与零标志 ZF',
    ports: [
      { text: 'a', x: 1254, y: 544 }, { text: 'b', x: 1254, y: 644 },
      { text: 'F', x: 1336, y: 604, anchor: 'end' },
    ],
  },
  {
    id: 'dmem', label: '数据存储器', sublabel: '（异步）', shape: 'rect',
    x: 1440, y: 580, width: 120, height: 240, nameSize: 16,
    description: 'DMEM：is_lw 读 / is_sw 写，小端字节寻址',
    ports: [
      { text: 'a', x: 1448, y: 604 }, { text: 'we', x: 1448, y: 674 },
      { text: 'spo', x: 1448, y: 744 }, { text: 'd', x: 1448, y: 799 },
      { text: 'clk', x: 1500, y: 836, anchor: 'middle' },
    ],
  },
  // ---- 0/1 部件（跑道形 capsule，0/1 居中对齐） ----
  {
    id: 'mux-pc-next', label: '', shape: 'stadium',
    x: 283, y: 200, width: 36, height: 90, nameSize: 10,
    description: 'pc_next 选择：pc_add4 / 跳转目标',
    muxPorts: [{ text: '0', x: 301, y: 227 }, { text: '1', x: 301, y: 263 }],
  },
  {
    id: 'mux-jump', label: '', shape: 'stadium',
    x: 540, y: 150, width: 36, height: 84, nameSize: 10,
    description: 'is_jump 选择：分支目标 / jal 目标',
    muxPorts: [{ text: '0', x: 558, y: 175 }, { text: '1', x: 558, y: 209 }],
  },
  {
    id: 'mux-jalr', label: '', shape: 'stadium',
    x: 540, y: 250, width: 36, height: 70, nameSize: 10,
    description: 'is_jalr 选择：上级目标 / ALU 结果',
    muxPorts: [{ text: '0', x: 558, y: 271 }, { text: '1', x: 558, y: 299 }],
  },
  {
    id: 'mux-branch', label: '', shape: 'stadium',
    x: 770, y: 170, width: 36, height: 84, nameSize: 10,
    description: 'is_beq/taken 选择：pc_add4 / 分支目标',
    muxPorts: [{ text: '0', x: 788, y: 195 }, { text: '1', x: 788, y: 229 }],
  },
  {
    id: 'oval-taken', label: 'taken', shape: 'ellipse',
    x: 748, y: 70, width: 80, height: 36, nameSize: 13,
    description: '分支成立：由 ZF 与 is_beq 决定',
  },
  {
    id: 'mux-lui', label: '', shape: 'stadium',
    x: 1014, y: 500, width: 36, height: 90, nameSize: 10,
    description: 'is_lui 选择：0 / PC',
    muxPorts: [{ text: '0', x: 1032, y: 527 }, { text: '1', x: 1032, y: 563 }],
  },
  {
    id: 'mux-src1', label: '', shape: 'stadium',
    x: 1057, y: 540, width: 36, height: 84, nameSize: 10,
    description: 'src1_ren 选择：src1_rdata / LUI 通路',
    muxPorts: [{ text: '0', x: 1075, y: 565 }, { text: '1', x: 1075, y: 599 }],
  },
  {
    id: 'mux-src2', label: '', shape: 'stadium',
    x: 1057, y: 648, width: 36, height: 84, nameSize: 10,
    description: 'src2_ren 选择：src2_rdata / imm',
    muxPorts: [{ text: '0', x: 1075, y: 673 }, { text: '1', x: 1075, y: 707 }],
  },
  {
    id: 'mux-lw', label: '', shape: 'stadium',
    x: 1330, y: 758, width: 36, height: 80, nameSize: 10,
    description: 'is_lw 选择：ALU 结果 / 内存读数',
    muxPorts: [{ text: '0', x: 1348, y: 782 }, { text: '1', x: 1348, y: 814 }],
  },
  {
    id: 'mux-link', label: '', shape: 'stadium',
    x: 1156, y: 838, width: 36, height: 80, nameSize: 10,
    description: 'is_link 选择：上级 / pc_add4',
    muxPorts: [{ text: '0', x: 1174, y: 862 }, { text: '1', x: 1174, y: 894 }],
  },
  {
    id: 'mux-trap', label: '', shape: 'stadium',
    x: 150, y: 550, width: 36, height: 120, nameSize: 10,
    description: 'trap 选择：0=pc_next，1=mtvec，2=mepc（mret）',
    muxPorts: [
      { text: '0', x: 168, y: 580 }, { text: '1', x: 168, y: 610 }, { text: '2', x: 168, y: 640 },
    ],
  },
  {
    id: 'gate-andnot', label: '&~1', shape: 'gate',
    x: 770, y: 950, width: 64, height: 40, nameSize: 13,
    description: '写使能门控：停机/异常时封锁寄存器堆写',
  },
  // ---- 中断/异常部件（与基础器件同款式，只保留接口） ----
  {
    id: 'int-ctrl', label: '中断控制器', shape: 'rect',
    x: 230, y: 910, width: 250, height: 80, nameSize: 14,
    description: '汇总计时器/外部中断，做使能、优先级与待决',
    ports: [
      { text: 'timer_irq', x: 238, y: 942 }, { text: 'ext_irq', x: 238, y: 966 },
    ],
  },
  {
    id: 'trap-logic', label: 'Trap 控制逻辑', shape: 'rect',
    x: 230, y: 1045, width: 250, height: 80, nameSize: 14,
    description: '异常/中断判优，产生 trap_taken、mret 与 CSR 写入',
  },
  {
    id: 'csr', label: 'CSR 寄存器组', shape: 'rect',
    x: 1210, y: 970, width: 190, height: 130, nameSize: 14,
    description: '机器模式 CSR：mepc / mtvec / mcause / mstatus',
    ports: [
      { text: 'mtvec', x: 1214, y: 998 }, { text: 'mepc', x: 1214, y: 1022 },
      { text: 'mcause', x: 1214, y: 1046 }, { text: 'mstatus', x: 1214, y: 1070 },
      { text: 'clock', x: 1305, y: 1092, anchor: 'middle' },
    ],
  },
]

// ---------------------------------------------------------------------------
// 连线路径（图1布线优先）。
//   虚线 = 数据流动（统一 dash/gap/流速）；实线 = 控制信号（0.6 倍宽）
// ---------------------------------------------------------------------------
export const W: Record<string, { d: string; kind: WireKind }> = {
  // ---- 取指 / PC 重定向 ----
  'pc-imem':        { d: 'M 266 585 H 370', kind: 'data' },
  'pc-pc4':         { d: 'M 320 585 V 860 H 590 V 1060 H 1030 V 563 H 1014', kind: 'data' },
  'pc-mepc':        { d: 'M 320 860 V 1150 H 1140 V 1018 H 1210', kind: 'interrupt' },
  'pc4-main':       { d: 'M 435 438 H 455 V 270 H 1140 V 894 H 1156', kind: 'data' },
  'pc4-pcmux':      { d: 'M 455 300 H 340 V 227 H 283', kind: 'data' },
  'pc4-branchmux':  { d: 'M 760 270 V 195 H 770', kind: 'data' },
  'pc4-branchadder':{ d: 'M 940 270 V 340 H 960', kind: 'data' },
  'branch-jump':    { d: 'M 806 212 H 826 V 120 H 520 V 175 H 540', kind: 'data' },
  'jump-jalr':      { d: 'M 558 234 V 250', kind: 'data' },
  'jalr-pcmux':     { d: 'M 576 285 H 350 V 263 H 283', kind: 'data' },
  'pcnext-trapmux': { d: 'M 319 245 H 335 V 180 H 140 V 580 H 150', kind: 'data' },
  'trapmux-pc':     { d: 'M 186 610 H 210', kind: 'data' },
  'const4':         { d: 'M 325 386 H 355', kind: 'control' },
  'pc-pc4adder':    { d: 'M 320 585 V 490 H 355', kind: 'data' },
  'inst-dec':       { d: 'M 530 600 H 645', kind: 'data' },
  // ---- 译码 → 数据 ----
  'reg-src1':       { d: 'M 992 565 H 1057', kind: 'data' },
  'reg-src2':       { d: 'M 992 673 H 1057', kind: 'data' },
  'reg-dmem':       { d: 'M 1010 673 V 930 H 1410 V 795 H 1440', kind: 'data' },
  'imm-branchadder':{ d: 'M 689 430 H 960', kind: 'zf' },
  'imm-src2':       { d: 'M 689 760 H 1040 V 707 H 1057', kind: 'zf' },
  'imm-jump':       { d: 'M 689 330 H 712 V 209 H 540', kind: 'zf' },
  'branch-target':  { d: 'M 1040 388 H 1060 V 260 H 740 V 229 H 770', kind: 'zf' },
  // ---- ALU / 访存 / 写回 ----
  'alu-a':          { d: 'M 1093 582 H 1230 V 540 H 1245', kind: 'data' },
  'alu-b':          { d: 'M 1093 690 H 1230 V 640 H 1245', kind: 'data' },
  'lui-src1':       { d: 'M 1050 545 H 1044 V 599 H 1057', kind: 'data' },
  'const0-lui':     { d: 'M 1000 527 H 1014', kind: 'control' },
  'alu-f':          { d: 'M 1345 600 H 1440', kind: 'data' },
  'aluf-jalr':      { d: 'M 1355 600 V 860 H 620 V 302 H 576', kind: 'zf' },
  'aluf-lw':        { d: 'M 1368 600 V 782 H 1330', kind: 'data' },
  'zf-taken':       { d: 'M 1345 530 H 1370 V 88 H 828', kind: 'zf' },
  'dmem-spo':       { d: 'M 1440 740 H 1300 V 814 H 1330', kind: 'data' },
  'lw-link':        { d: 'M 1366 798 H 1390 V 730 H 1200 V 862 H 1156', kind: 'data' },
  'link-wb':        { d: 'M 1192 878 H 1210 V 752 H 940 V 730', kind: 'zf' },
  // ---- 控制信号（实线） ----
  'dec-src1addr':   { d: 'M 689 540 H 760', kind: 'control' },
  'dec-src2addr':   { d: 'M 689 645 H 760', kind: 'control' },
  'dec-regwen':     { d: 'M 689 672 H 760', kind: 'control' },
  'dec-regwaddr':   { d: 'M 689 699 H 760', kind: 'control' },
  'dec-alusrc1':    { d: 'M 689 470 H 1075 V 540', kind: 'control' },
  'dec-alusrc2':    { d: 'M 689 790 H 1075 V 732', kind: 'control' },
  'dec-isluisel':   { d: 'M 689 450 H 950 V 490 H 1032 V 500', kind: 'control' },
  'dec-aluop':      { d: 'M 689 400 H 1200 V 470', kind: 'control' },
  'dec-issw':       { d: 'M 689 320 H 1408 V 670 H 1440', kind: 'control' },
  'dec-islink':     { d: 'M 656 780 V 940 H 1130 V 920 H 1156', kind: 'control' },
  'dec-islw':       { d: 'M 678 780 V 955 H 1348 V 838', kind: 'control' },
  'dec-gate':       { d: 'M 689 780 H 710 V 970 H 770', kind: 'control' },
  'gate-out':       { d: 'M 802 950 V 900 H 730 V 672', kind: 'control' },
  // ---- 时钟 / 复位（实线，参照图1） ----
  'clk-rail':       { d: 'M 180 870 H 1520', kind: 'control' },
  'clk-pc':         { d: 'M 238 870 V 660', kind: 'control' },
  'clk-imem':       { d: 'M 450 870 V 770', kind: 'control' },
  'clk-regfile':    { d: 'M 880 870 V 730', kind: 'control' },
  'clk-dmem':       { d: 'M 1500 870 V 836', kind: 'control' },
  'reset-pc':       { d: 'M 120 700 H 195 V 645 H 210', kind: 'control' },
  'reset-regfile':  { d: 'M 160 700 V 790 H 840 V 730', kind: 'control' },
  // ---- 跳转/分支控制（红） ----
  'is-jump-branch': { d: 'M 667 300 V 105 H 301 V 200', kind: 'branch' },
  'is-jump':        { d: 'M 689 315 H 700 V 130 H 558 V 150', kind: 'branch' },
  'is-jalr':        { d: 'M 689 335 H 610 V 285 H 540', kind: 'branch' },
  'is-beq':         { d: 'M 689 350 H 730 V 88 H 748', kind: 'branch' },
  'taken-out':      { d: 'M 788 106 V 170', kind: 'branch' },
  // ---- 中断/异常（橙） ----
  'irq-timer':      { d: 'M 150 938 H 230', kind: 'interrupt' },
  'irq-ext':        { d: 'M 150 962 H 230', kind: 'interrupt' },
  'irq-pending':    { d: 'M 355 990 V 1045', kind: 'interrupt' },
  'dec-exc':        { d: 'M 667 780 V 905 H 540 V 1060 H 480', kind: 'interrupt' },
  'trap-sel':       { d: 'M 230 1085 H 168 V 670', kind: 'interrupt' },
  'csr-we':         { d: 'M 480 1085 H 1190 V 1066 H 1210', kind: 'interrupt' },
  'mtvec':          { d: 'M 1210 994 H 1120 V 1200 H 100 V 610 H 150', kind: 'interrupt' },
  // ---- mret 返回（紫） ----
  'mepc':           { d: 'M 1210 1042 H 1130 V 1215 H 80 V 640 H 150', kind: 'mret' },
  'mie':            { d: 'M 1210 1090 H 1160 V 1110 H 480', kind: 'mret' },
}

/** 连线旁文字（加深加大；位置贴近所指路径，已去重） */
export const WIRE_LABELS: Record<string, string> = {
  'pc-imem': 'PC', 'pc-pc4': 'PC', 'pc4-main': 'pc_add4', 'const4': '4',
  'pc4-pcmux': 'pc_add4', 'branch-target': '分支目标',
  'pcnext-trapmux': 'pc_next', 'trapmux-pc': 'PC',
  'mtvec': 'mtvec', 'mepc': 'mepc',
  'pc-mepc': 'PC→mepc', 'trap-sel': 'trap_taken/mret_sel',
  'irq-timer': 'timer_irq', 'irq-ext': 'ext_irq', 'irq-pending': 'irq_pending',
  'dec-exc': 'ecall/ebreak/非法指令', 'csr-we': '写CSR',
  'mie': 'mstatus.MIE',
  'link-wb': 'reg_wdata',
  'imm-branchadder': 'imm', 'imm-src2': 'imm', 'imm-jump': 'imm',
  'zf-taken': 'ZF', 'aluf-jalr': 'F',
  'dec-issw': 'is_sw', 'dec-aluop': 'ALU_OP',
  'dec-isluisel': 'is_lui', 'dec-alusrc1': 'src1_ren', 'dec-alusrc2': 'src2_ren',
  'dec-islw': 'is_lw', 'dec-islink': 'is_link',
  'alu-a': 'a', 'alu-b': 'b', 'alu-f': 'F', 'inst-dec': 'inst 32',
  'clk-rail': 'clock', 'reset-pc': 'reset',
}

/** 连线文字锚点 */
export const WIRE_LABEL_POINTS: Record<string, { x: number; y: number }> = {
  'pc-imem': { x: 318, y: 576 }, 'pc-pc4': { x: 450, y: 850 },
  'pc4-main': { x: 600, y: 262 }, 'const4': { x: 312, y: 378 },
  'pc4-pcmux': { x: 367, y: 281 },
  'branch-jump': { x: 660, y: 112 }, 'jalr-pcmux': { x: 450, y: 297 },
  'pcnext-trapmux': { x: 108, y: 320 }, 'trapmux-pc': { x: 198, y: 600 },
  'mtvec': { x: 66, y: 820 }, 'mepc': { x: 46, y: 1000 },
  'pc-mepc': { x: 700, y: 1142 }, 'trap-sel': { x: 148, y: 854 },
  'irq-timer': { x: 185, y: 930 }, 'irq-ext': { x: 185, y: 954 },
  'irq-pending': { x: 398, y: 1020 }, 'dec-exc': { x: 618, y: 845 },
  'csr-we': { x: 700, y: 1076 }, 'mie': { x: 690, y: 1106 },
  'reg-dmem': { x: 1210, y: 922 },
  'imm-branchadder': { x: 800, y: 422 }, 'imm-src2': { x: 860, y: 752 },
  'imm-jump': { x: 630, y: 201 }, 'branch-target': { x: 900, y: 252 },
  'zf-taken': { x: 1000, y: 80 }, 'aluf-jalr': { x: 760, y: 852 },
  'dec-issw': { x: 1150, y: 312 }, 'dec-aluop': { x: 880, y: 392 },
  'dec-isluisel': { x: 840, y: 442 }, 'dec-alusrc1': { x: 860, y: 462 },
  'dec-alusrc2': { x: 860, y: 782 },
  'dec-islw': { x: 740, y: 946 }, 'dec-islink': { x: 780, y: 932 },
  'alu-a': { x: 1150, y: 574 }, 'alu-b': { x: 1120, y: 702 },
  'alu-f': { x: 1420, y: 592 }, 'inst-dec': { x: 588, y: 590 },
  'link-wb': { x: 1150, y: 744 },
  'clk-rail': { x: 146, y: 874 }, 'reset-pc': { x: 134, y: 712 },
}

/** 结点（T 型连接处画圆点，与交叉区分） */
export const JUNCTION_DOTS: Array<{ x: number; y: number }> = [
  { x: 320, y: 585 }, { x: 320, y: 860 }, { x: 395, y: 290 },
  { x: 760, y: 270 }, { x: 1000, y: 270 }, { x: 1010, y: 673 },
  { x: 1355, y: 600 }, { x: 1368, y: 600 }, { x: 730, y: 672 },
  { x: 238, y: 870 }, { x: 450, y: 870 }, { x: 880, y: 870 }, { x: 1500, y: 870 },
  { x: 160, y: 700 }, { x: 940, y: 270 }, { x: 455, y: 300 },
]

/** MUX 选择端标注 */
export const MUX_SEL_LABELS: Array<{ text: string; x: number; y: number; color: string }> = [
  { text: 'is_beq', x: 700, y: 80, color: '#e02020' },
  { text: 'is_jump_branch', x: 450, y: 97, color: '#e02020' },
  { text: 'is_jump', x: 630, y: 122, color: '#e02020' },
  { text: 'is_jalr', x: 605, y: 335, color: '#e02020' },
  { text: 'trap/mret', x: 126, y: 686, color: '#e06000' },
]

/** 动态值槽位（静态锚点） */
export const VALUE_SLOTS = [
  { id: 'value-pc', label: 'PC', x: 238, y: 548 },
  { id: 'value-inst', label: 'inst', x: 587, y: 606 },
  { id: 'value-imm', label: 'imm', x: 940, y: 430 },
  { id: 'value-op1', label: 'a', x: 1170, y: 572 },
  { id: 'value-op2', label: 'b', x: 1160, y: 672 },
  { id: 'value-alu', label: 'ALU', x: 1400, y: 655 },
  { id: 'value-wb', label: '写回', x: 1055, y: 742 },
  { id: 'value-next-pc', label: 'pc_next', x: 240, y: 180 },
  { id: 'value-mtvec', label: 'mtvec', x: 1262, y: 910 },
  { id: 'value-mepc', label: 'mepc', x: 1362, y: 910 },
  { id: 'value-mcause', label: 'mcause', x: 1262, y: 936 },
  { id: 'value-mstatus', label: 'mstatus', x: 1362, y: 936 },
] as const

/** 连线颜色族 */
export function wireKindOf(id: string): WireKind {
  return W[id]?.kind ?? 'data'
}

export interface ControlSignalChip {
  key: string
  label: string
  on: boolean
  isBool: boolean
  value?: string
}

// ---------------------------------------------------------------------------
// 根据周期状态计算：活跃模块、活跃连线、动态值槽位、译码器信号
// ---------------------------------------------------------------------------
export function computeDatapath(state: CycleState | null): {
  activeModules: Set<ModuleId>
  activeWires: ActiveWire[]
  valueSlots: ValueSlot[]
  decoderSignals: ControlSignalChip[]
} {
  const activeModules = new Set<ModuleId>()
  const activeWires: ActiveWire[] = []
  const valueSlots: ValueSlot[] = []
  const decoderSignals: ControlSignalChip[] = []

  if (!state) return { activeModules, activeWires, valueSlots, decoderSignals }

  const cs = state.control_signals
  const hex = (v: number) => '0x' + (v >>> 0).toString(16)
  const addModule = (id: ModuleId) => activeModules.add(id)
  const added = new Set<string>()
  const addWire = (id: string, value?: string) => {
    if (added.has(id)) return
    const w = W[id]
    if (!w) return
    added.add(id)
    activeWires.push({ id, path: w.d, kind: w.kind, label: WIRE_LABELS[id], value })
  }

  const branchTaken = !!state.branch?.taken
  const trapTaken = !!state.trap?.taken
  const trapCause = state.trap?.cause ?? 0
  const isIntTrap = trapTaken && trapCause >= 0x80000000
  const isMret = (state.disassembly ?? '').startsWith('mret')
  const csr = state.csr
  const mtimeVal = parseInt(csr.mtime ?? '0x0', 16)
  const mtimecmpVal = parseInt(csr.mtimecmp ?? '0x0', 16)
  const mstatusVal = parseInt(csr.mstatus ?? '0x0', 16)
  const mieVal = parseInt(csr.mie ?? '0x0', 16)
  const irqPending = mtimeVal >= mtimecmpVal && (mieVal & 0x80) !== 0

  // ============ IF 取指 ============
  addModule('pc'); addModule('imem'); addModule('adder-pc4'); addModule('mux-pc-next')
  addModule('mux-trap')
  addWire('pc-imem', state.pc)
  addWire('pc-pc4')
  addWire('pc4-main')
  addWire('pc4-pcmux')
  addWire('const4')
  addWire('inst-dec', state.instruction)
  addWire('pcnext-trapmux')
  addWire('trapmux-pc')

  if (cs.branch && branchTaken) {
    addModule('adder-branch'); addModule('mux-branch'); addModule('oval-taken')
    addWire('pc4-branchadder')
    addWire('imm-branchadder')
    addWire('branch-target')
    addWire('branch-jump')
    addWire('jump-jalr')
  }
  if (cs.jump) {
    addModule('mux-jump')
    addWire('imm-jump')
    addWire('branch-jump'); addWire('jump-jalr')
  }
  if (cs.is_jalr) {
    addModule('mux-jalr')
    addWire('aluf-jalr')
    addWire('jalr-pcmux')
  }
  if (cs.branch) {
    addModule('oval-taken'); addModule('mux-branch')
    addWire('zf-taken'); addWire('is-beq'); addWire('taken-out')
  }

  // ============ 译码 ============
  addModule('decoder'); addModule('regfile')
  addWire('dec-src1addr'); addWire('reg-src1')
  if (cs.mem_write || (!cs.alu_src && !cs.is_lui && !cs.is_auipc && !cs.jump)) {
    addWire('dec-src2addr'); addWire('reg-src2')
  }
  const hasImm = cs.alu_src || cs.branch || cs.jump || cs.is_jalr || cs.is_lui || cs.is_auipc
  if (hasImm) addWire('imm-src2')
  addWire('dec-alusrc1'); addWire('dec-alusrc2'); addWire('dec-aluop')
  if (cs.is_lui) {
    addModule('mux-lui')
    addWire('dec-isluisel'); addWire('const0-lui'); addWire('lui-src1')
  }

  // ============ EX 执行 ============
  addModule('alu'); addModule('mux-src1'); addModule('mux-src2')
  addWire('alu-a'); addWire('alu-b')

  // ============ MEM 访存 ============
  if (cs.mem_read || cs.mem_write) {
    addModule('dmem'); addModule('mux-lw')
    addWire('alu-f'); addWire('aluf-lw'); addWire('dec-islw')
    if (cs.mem_write) {
      addWire('dec-issw'); addWire('reg-dmem')
    }
    if (cs.mem_read) addWire('dmem-spo')
    addWire('lw-link')
  }

  // ============ WB 写回 ============
  if (cs.reg_write) {
    addModule('mux-link'); addModule('regfile')
    addWire('dec-islink'); addWire('link-wb')
  }
  if (cs.reg_write && !cs.mem_read && !cs.mem_write && !cs.jump && !cs.is_jalr && !cs.is_lui && !cs.is_auipc) {
    addWire('alu-f'); addWire('lw-link')
  }

  // ============ 中断 / 异常 ============
  addModule('int-ctrl'); addModule('trap-logic'); addModule('csr')
  addWire('irq-timer'); addWire('irq-ext')
  if (irqPending) addWire('irq-pending')
  if ((mstatusVal & 0x8) !== 0) addWire('mie')
  if (trapTaken) {
    addWire('trap-sel')
    addWire('csr-we')
    addWire('pc-mepc')
    if (!isIntTrap) addWire('dec-exc')
  }
  if (isMret) {
    addWire('mepc', csr.mepc)
    addWire('trap-sel')
  }

  // ============ 写使能门控 ============
  addWire('dec-gate'); addWire('gate-out')

  // ============ 译码器输出信号 ============
  decoderSignals.push(
    { key: 'is_lui', label: 'is_lui', on: cs.is_lui, isBool: true },
    { key: 'is_jump', label: 'is_jump', on: cs.jump || cs.is_jalr, isBool: true },
    { key: 'is_link', label: 'is_link', on: state.writeback.source === 'PC_PLUS_4', isBool: true },
    { key: 'is_lw', label: 'is_lw', on: cs.mem_read, isBool: true },
    { key: 'is_sw', label: 'is_sw', on: cs.mem_write, isBool: true },
    { key: 'is_beq', label: 'is_beq', on: cs.branch, isBool: true },
    { key: 'taken', label: 'taken', on: branchTaken, isBool: true },
    { key: 'ZF', label: 'ZF', on: state.alu.zero, isBool: true },
    { key: 'trap', label: 'TRAP', on: trapTaken, isBool: true },
    { key: 'mret', label: 'mret', on: isMret, isBool: true },
    { key: 'alu_op', label: 'ALU_OP', on: true, isBool: false, value: cs.alu_op },
  )

  // ============ 动态值槽位 ============
  valueSlots.push({ ...VALUE_SLOTS[0], value: state.pc, format: 'hex', changed: false })
  valueSlots.push({ ...VALUE_SLOTS[1], value: state.instruction, format: 'hex', changed: false })
  valueSlots.push({ ...VALUE_SLOTS[2], value: hex(state.immediate), format: 'hex', changed: false })
  valueSlots.push({ ...VALUE_SLOTS[3], value: String(state.alu.op1), format: 'dec', changed: false })
  valueSlots.push({ ...VALUE_SLOTS[4], value: String(state.alu.op2), format: 'dec', changed: false })
  valueSlots.push({ ...VALUE_SLOTS[5], value: hex(state.alu.result), format: 'hex', changed: false })
  valueSlots.push({ ...VALUE_SLOTS[6], value: hex(state.writeback.data), format: 'hex', changed: false })
  valueSlots.push({ ...VALUE_SLOTS[7], value: state.next_pc, format: 'hex', changed: false })
  valueSlots.push({ ...VALUE_SLOTS[8], value: csr.mtvec ?? '-', format: 'hex', changed: false })
  valueSlots.push({ ...VALUE_SLOTS[9], value: csr.mepc ?? '-', format: 'hex', changed: false })
  valueSlots.push({ ...VALUE_SLOTS[10], value: csr.mcause ?? '-', format: 'hex', changed: false })
  valueSlots.push({ ...VALUE_SLOTS[11], value: csr.mstatus ?? '-', format: 'hex', changed: false })

  return { activeModules, activeWires, valueSlots, decoderSignals }
}
