// ============================================================================
// datapathLayout.ts —— 单周期数据通路静态布局（模块坐标 + 连线路径 + 值槽位）
//
// 采用经典单周期数据通路布局。坐标单位为 SVG 画布坐标（1200 × 700）。
// ============================================================================

import type { ActiveWire, ModuleId, ModuleLayout, ValueSlot } from '@/types/datapath'
import type { CycleState } from '@/types/simulation'

export const CANVAS_W = 1200
export const CANVAS_H = 700

/** 各阶段标注 */
export const STAGE_LABELS: Array<{ label: string; x: number; y: number }> = [
  { label: 'IF 取指', x: 120, y: 16 },
  { label: 'ID 译码', x: 420, y: 16 },
  { label: 'ID 译码', x: 420, y: 206 },
  { label: 'EX 执行', x: 760, y: 236 },
  { label: 'MEM 访存', x: 520, y: 416 },
  { label: 'WB 写回', x: 700, y: 586 },
]

/** 模块布局（参照原理图：PC → 指令存储器 → 译码器/寄存器堆 → ALU → 数据存储器） */
export const MODULES: ModuleLayout[] = [
  { id: 'pc', label: 'PC', x: 30, y: 340, width: 100, height: 60, description: '程序计数器：保存当前指令地址' },
  { id: 'pc-adder', label: 'PC+4', x: 30, y: 130, width: 100, height: 44, description: 'PC+4 加法器：计算 pc_add4' },
  { id: 'branch-adder', label: '分支加法器', x: 220, y: 180, width: 150, height: 44, description: '分支地址加法器：PC + 偏移' },
  { id: 'mux-pc', label: 'PC MUX', x: 30, y: 480, width: 100, height: 52, description: 'PC 源选择：pc_add4 / 分支目标 / ALU 结果' },
  { id: 'imem', label: '指令存储器', x: 220, y: 30, width: 150, height: 70, description: 'IMEM：按 PC 取出 32 位指令 inst' },
  { id: 'decoder', label: '译码器', x: 700, y: 30, width: 210, height: 90, description: '译码器：按 opcode 生成 is_lui/is_jal/is_link/is_lw/is_sw/is_beq' },
  { id: 'immgen', label: '立即数生成器', x: 450, y: 30, width: 110, height: 60, description: 'ImmGen：提取并符号扩展立即数 imm' },
  { id: 'regfile', label: '寄存器堆', x: 430, y: 220, width: 180, height: 170, description: '寄存器堆：32×32 位通用寄存器' },
  { id: 'mux-alu-src', label: 'ALUSrc', x: 690, y: 250, width: 90, height: 56, description: 'ALU 源选择 MUX：src2_rdata / imm' },
  { id: 'alu', label: 'ALU', x: 850, y: 430, width: 140, height: 76, description: 'ALU：算术逻辑运算，输出结果 d 与零标志 ZF' },
  { id: 'dmem', label: '数据存储器', x: 520, y: 430, width: 150, height: 76, description: 'DMEM：is_lw 读 / is_sw 写' },
  { id: 'mux-mem-to-reg', label: 'MemtoReg', x: 700, y: 600, width: 90, height: 56, description: '写回选择：ALU 结果 / 内存数据 / pc_add4' },
]

/** 值槽位静态坐标（动态值覆盖层锚点，位于模块端口附近） */
export const VALUE_SLOTS = [
  { id: 'value-pc', label: 'PC', x: 80, y: 325 },
  { id: 'value-instruction', label: 'inst', x: 330, y: 108 },
  { id: 'value-imm', label: 'imm', x: 505, y: 20 },
  { id: 'value-op1', label: 'a', x: 870, y: 420 },
  { id: 'value-op2', label: 'b', x: 950, y: 420 },
  { id: 'value-alu-result', label: 'd', x: 920, y: 516 },
  { id: 'value-wb-data', label: 'reg_wdata', x: 745, y: 666 },
  { id: 'value-next-pc', label: 'pc_next', x: 80, y: 540 },
] as const

/** 基础连线（静态展示，浅色底衬）—— 与活跃连线共用同一套几何路径 */
export const BASE_WIRE_PATHS: Record<string, string> = {
  'pc-imem': 'M 130 370 L 170 370 L 170 65 L 220 65',
  'pc-pc4': 'M 80 340 L 80 174',
  'pc-branch': 'M 130 380 L 180 380 L 180 202 L 220 202',
  'pc4-pcmux': 'M 80 174 L 80 480',
  'branch-pcmux': 'M 295 224 L 295 506 L 130 506',
  'alu-pcmux': 'M 900 506 L 900 700 L 80 700 L 80 532',
  'muxpc-pc': 'M 80 532 L 80 400',
  'imem-reg': 'M 295 100 L 295 305 L 430 305',
  'imem-imm': 'M 370 60 L 450 60',
  'imem-dec': 'M 370 40 L 700 40',
  'reg-alu': 'M 610 260 L 610 360 L 870 360 L 870 430',
  'reg-mux': 'M 530 390 L 530 480 L 735 480 L 735 306',
  'imm-mux': 'M 505 90 L 505 160 L 735 160 L 735 250',
  'mux-alu': 'M 735 306 L 735 400 L 920 400 L 920 430',
  'alu-dmem': 'M 850 468 L 670 468',
  'reg-dmem': 'M 580 390 L 580 430',
  'dmem-mux': 'M 595 506 L 595 628 L 700 628',
  'pc4-mux': 'M 30 152 L 30 620 L 700 620',
  'mux-reg': 'M 745 656 L 745 690 L 520 690 L 520 390',
  'alu-wb': 'M 950 506 L 950 628 L 790 628',
  'dec-reg': 'M 700 120 L 700 240 L 610 240',
  'dec-mux': 'M 740 120 L 740 250 L 780 250',
  'dec-dmem': 'M 780 120 L 780 468 L 670 468',
  'dec-wb': 'M 820 120 L 820 628 L 790 628',
}

// ---------------------------------------------------------------------------
// 连线路径（SVG path d）。方向：源 → 目的。
// 数据线蓝色、地址线绿色、控制线灰色、ALU 线橙色（见 ActiveWire.kind）。
// ---------------------------------------------------------------------------
export const W = {
  // ---- IF：取指 ----
  'pc-to-imem': 'M 130 370 L 170 370 L 170 65 L 220 65',                 // PC → IMEM 地址
  'pc-to-pc4': 'M 80 340 L 80 174',                                       // PC → PC+4
  'pc-to-branch': 'M 130 380 L 180 380 L 180 202 L 220 202',              // PC → 分支加法器
  'pc4-to-pcmux': 'M 80 174 L 80 480',                                     // pc_add4 → PC MUX
  'branch-to-pcmux': 'M 295 224 L 295 506 L 130 506',                      // 分支目标 → PC MUX
  'alu-to-pcmux': 'M 900 506 L 900 700 L 80 700 L 80 532',                 // ALU 结果 → PC MUX (JALR)
  'mux-pc-to-pc': 'M 80 532 L 80 400',                                     // PC MUX 输出 → PC
  // ---- ID：译码 ----
  'imem-to-inst': 'M 295 100 L 295 305 L 430 305',                         // inst → 寄存器堆
  'imem-to-immgen': 'M 370 60 L 450 60',                                   // inst → 立即数生成器
  'imem-to-decoder': 'M 370 40 L 700 40',                                  // opcode → 译码器
  // ---- EX：执行 ----
  'regfile-to-alu': 'M 610 260 L 610 360 L 870 360 L 870 430',             // src1_rdata → ALU(a)
  'regfile-rs2-to-mux': 'M 530 390 L 530 480 L 735 480 L 735 306',         // src2_rdata → ALUSrc MUX
  'immgen-to-mux': 'M 505 90 L 505 160 L 735 160 L 735 250',               // imm → ALUSrc MUX
  'mux-to-alu': 'M 735 306 L 735 400 L 920 400 L 920 430',                 // ALUSrc MUX → ALU(b)
  'alu-to-wbmux': 'M 950 506 L 950 628 L 790 628',                         // ALU 结果 d → MemtoReg MUX
  // ---- MEM：访存 ----
  'alu-to-dmem': 'M 850 468 L 670 468',                                    // 地址 → DMEM
  'regfile-to-dmem': 'M 580 390 L 580 430',                                // 写数据 → DMEM
  'dmem-to-wbmux': 'M 595 506 L 595 628 L 700 628',                        // 读数据 → MemtoReg MUX
  // ---- WB：写回 ----
  'pc4-to-wbmux': 'M 30 152 L 30 620 L 700 620',                           // pc_add4 → MemtoReg MUX (is_link)
  'wbmux-to-regfile': 'M 745 656 L 745 690 L 520 690 L 520 390',           // reg_wdata → 寄存器堆
  // ---- 控制信号（虚线） ----
  'decoder-to-regfile': 'M 700 120 L 700 240 L 610 240',                   // reg_wen → 寄存器堆
  'decoder-to-mux': 'M 740 120 L 740 250 L 780 250',                       // ALUSrc → MUX
  'decoder-to-dmem': 'M 780 120 L 780 468 L 670 468',                      // is_lw/is_sw → DMEM
  'decoder-to-wbmux': 'M 820 120 L 820 628 L 790 628',                     // MemtoReg → MUX
} as const

export type WireId = keyof typeof W

/** 每条数据通路线的信号名（参考图：连线带名字） */
export const WIRE_LABELS: Record<WireId, string> = {
  'pc-to-imem': 'PC/地址',
  'pc-to-pc4': 'PC',
  'pc-to-branch': 'PC',
  'pc4-to-pcmux': 'PC+4',
  'branch-to-pcmux': '分支目标',
  'alu-to-pcmux': 'JALR 目标',
  'mux-pc-to-pc': 'PC',
  'imem-to-inst': 'inst',
  'imem-to-immgen': 'imm 字段',
  'imem-to-decoder': 'opcode[6:0]',
  'regfile-to-alu': 'src1_rdata',
  'regfile-rs2-to-mux': 'src2_rdata',
  'immgen-to-mux': 'imm',
  'mux-to-alu': 'b',
  'alu-to-wbmux': 'ALU 结果',
  'alu-to-dmem': 'addr',
  'regfile-to-dmem': '写数据',
  'dmem-to-wbmux': '读数据',
  'pc4-to-wbmux': 'pc_add4',
  'wbmux-to-regfile': 'reg_wdata',
  'decoder-to-regfile': 'reg_wen',
  'decoder-to-mux': 'ALUSrc',
  'decoder-to-dmem': 'is_lw/is_sw',
  'decoder-to-wbmux': 'MemtoReg',
}

/** 连线信号名的标注锚点（坐标在 SVG 画布空间） */
export const WIRE_LABEL_POINTS: Partial<Record<WireId, { x: number; y: number }>> = {
  'pc-to-imem': { x: 184, y: 56 },
  'pc-to-pc4': { x: 6, y: 260 },
  'pc-to-branch': { x: 184, y: 196 },
  'pc4-to-pcmux': { x: 6, y: 330 },
  'branch-to-pcmux': { x: 300, y: 250 },
  'alu-to-pcmux': { x: 902, y: 540 },
  'mux-pc-to-pc': { x: 6, y: 470 },
  'imem-to-inst': { x: 300, y: 300 },
  'imem-to-immgen': { x: 406, y: 52 },
  'imem-to-decoder': { x: 520, y: 32 },
  'regfile-to-alu': { x: 750, y: 352 },
  'regfile-rs2-to-mux': { x: 620, y: 472 },
  'immgen-to-mux': { x: 615, y: 152 },
  'mux-to-alu': { x: 820, y: 392 },
  'alu-to-wbmux': { x: 860, y: 620 },
  'alu-to-dmem': { x: 755, y: 460 },
  'regfile-to-dmem': { x: 556, y: 408 },
  'dmem-to-wbmux': { x: 620, y: 620 },
  'pc4-to-wbmux': { x: 350, y: 612 },
  'wbmux-to-regfile': { x: 630, y: 682 },
  'decoder-to-regfile': { x: 660, y: 232 },
  'decoder-to-mux': { x: 742, y: 242 },
  'decoder-to-dmem': { x: 786, y: 300 },
  'decoder-to-wbmux': { x: 826, y: 380 },
}

/** MUX 输入端口 0/1 标注（参考图：MUX 输入侧标 0/1） */
export const MUX_LABELS: Record<'mux-pc' | 'mux-alu-src' | 'mux-mem-to-reg', { zero: { x: number; y: number }; one: { x: number; y: number } }> = {
  'mux-pc': { zero: { x: 42, y: 495 }, one: { x: 42, y: 522 } },
  'mux-alu-src': { zero: { x: 700, y: 272 }, one: { x: 700, y: 296 } },
  'mux-mem-to-reg': { zero: { x: 710, y: 622 }, one: { x: 710, y: 646 } },
}

/** 判断一条线默认属于哪个颜色族（用于静态基线的淡色着色） */
export function wireKindOf(id: WireId): ActiveWire['kind'] {
  if (id.startsWith('decoder-to-')) return 'control'
  if (id === 'branch-to-pcmux') return 'state'
  if (id === 'mux-to-alu' || id === 'alu-to-wbmux' || id === 'alu-to-pcmux') return 'alu'
  return 'data'
}

/** 译码器输出的控制信号（可视化层使用原理图命名） */
export interface ControlSignalChip {
  key: string
  label: string
  on: boolean
  isBool: boolean
  value?: string
}

// ---------------------------------------------------------------------------
// 根据周期状态计算：活跃模块、活跃连线、动态值槽位、译码器信号
//
// 关键原则：只高亮「当前指令真正经过的数据路径」，让动画与实际数据流一致。
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
  const addedWireIds = new Set<string>()
  const addWire = (id: WireId, kind: ActiveWire['kind'], value?: string) => {
    if (addedWireIds.has(id)) return   // 避免同一条线被多条规则重复添加
    addedWireIds.add(id)
    const path = W[id]
    if (!path) return
    activeWires.push({ id, path, kind, label: WIRE_LABELS[id], value })
  }

  const isPcFromBranch = (cs.branch && state.branch.taken) || cs.jump
  const isPcFromAlu = cs.is_jalr

  // ============ IF 取指 ============
  addModule('pc'); addModule('pc-adder'); addModule('imem'); addModule('mux-pc')
  addWire('pc-to-imem', 'data', state.pc)
  addWire('pc-to-pc4', 'data')
  // PC MUX 只有一个输入被选中
  if (isPcFromBranch) {
    addModule('branch-adder')
    addWire('pc-to-branch', 'data', state.pc)
    addWire('branch-to-pcmux', 'state', state.branch.target_addr)
  }
  if (isPcFromAlu) {
    addWire('alu-to-pcmux', 'alu', hex(state.alu.result))
  }
  if (!isPcFromBranch && !isPcFromAlu) {
    addWire('pc4-to-pcmux', 'data', state.next_pc)
  }
  addWire('mux-pc-to-pc', 'data')

  // ============ ID 译码 ============
  addModule('decoder'); addModule('regfile')
  addWire('imem-to-inst', 'data', state.instruction)
  addWire('imem-to-decoder', 'control', state.instruction_fields?.opcode ?? '')
  const hasImm = cs.alu_src || cs.branch || cs.jump || cs.is_jalr || cs.is_lui || cs.is_auipc
  if (hasImm) {
    addModule('immgen')
    addWire('imem-to-immgen', 'data')
  }

  // ============ EX 执行 ============
  addModule('mux-alu-src'); addModule('alu')
  const op1IsReg = !cs.is_lui && !cs.is_auipc
  if (op1IsReg) addWire('regfile-to-alu', 'data', hex(state.alu.op1))
  if (cs.alu_src || cs.is_lui || cs.is_auipc) addWire('immgen-to-mux', 'data', hex(state.immediate))
  const rs2Used = cs.mem_write || (!cs.alu_src && !cs.is_lui && !cs.is_auipc && !cs.jump)
  if (rs2Used) addWire('regfile-rs2-to-mux', 'data', hex(state.alu.op2))
  addWire('mux-to-alu', 'alu')

  // ============ MEM 访存 ============
  if (cs.mem_read || cs.mem_write) {
    addModule('dmem')
    addWire('alu-to-dmem', 'data', state.memory.addr)
    if (cs.mem_write) addWire('regfile-to-dmem', 'data', state.memory.write_data)
    if (cs.mem_read) addWire('dmem-to-wbmux', 'data', state.memory.read_data)
  }

  // ============ WB 写回 ============
  if (cs.reg_write) {
    addModule('mux-mem-to-reg')
    addModule('regfile')
    addWire('wbmux-to-regfile', 'data', hex(state.writeback.data))
    if (state.writeback.source === 'ALU') addWire('alu-to-wbmux', 'alu', hex(state.writeback.data))
    if (state.writeback.source === 'MEM') addWire('dmem-to-wbmux', 'data', state.memory.read_data)
    if (state.writeback.source === 'PC_PLUS_4') addWire('pc4-to-wbmux', 'data', state.next_pc)
  }

  // ============ 控制信号线 ============
  addWire('decoder-to-regfile', 'control')
  addWire('decoder-to-mux', 'control')
  if (cs.mem_read || cs.mem_write) addWire('decoder-to-dmem', 'control')
  addWire('decoder-to-wbmux', 'control')

  // ============ 译码器输出信号（原理图命名） ============
  decoderSignals.push(
    { key: 'is_lui', label: 'is_lui', on: cs.is_lui, isBool: true },
    { key: 'is_jal', label: 'is_jal', on: cs.jump || cs.is_jalr, isBool: true },
    { key: 'is_link', label: 'is_link', on: state.writeback.source === 'PC_PLUS_4', isBool: true },
    { key: 'is_lw', label: 'is_lw', on: cs.mem_read, isBool: true },
    { key: 'is_sw', label: 'is_sw', on: cs.mem_write, isBool: true },
    { key: 'is_beq', label: 'is_beq', on: cs.branch, isBool: true },
    { key: 'taken', label: 'taken', on: state.branch.taken, isBool: true },
    { key: 'ZF', label: 'ZF', on: state.alu.zero, isBool: true },
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

  return { activeModules, activeWires, valueSlots, decoderSignals }
}
