// ============================================================================
// datapath.ts —— 数据通路可视化布局与状态类型
//
// 部件形状（参照 docs/rv32cpu.png 原理图）：
//   rect    矩形器件（存储器 / 寄存器堆 / 译码器 / PC / CSR / 控制逻辑）
//   ellipse 椭圆（taken / &~1 门）
//   stadium 跑道形（0/1 多选器 MUX，0/1 上下左右居中）
//   adder   左侧凹口加法器（ADD）
//   alu     尖角 ALU 形状
// ============================================================================

export type ModuleId =
  | 'pc'
  | 'adder-pc4'
  | 'adder-branch'
  | 'mux-pc-next'
  | 'mux-jump'
  | 'mux-jalr'
  | 'mux-branch'
  | 'oval-taken'
  | 'mux-lui'
  | 'mux-src1'
  | 'mux-src2'
  | 'mux-lw'
  | 'mux-link'
  | 'gate-andnot'
  | 'imem'
  | 'decoder'
  | 'regfile'
  | 'alu'
  | 'dmem'
  | 'mux-trap'
  | 'int-ctrl'
  | 'trap-logic'
  | 'csr'

/** 动态值槽位：某个 JSON 字段 → 数据通路图上某个位置 */
export interface ValueSlot {
  id: string
  label: string
  value: string
  format: 'hex' | 'dec' | 'bin'
  changed: boolean
  x: number
  y: number
}

/**
 * 连线类别：
 *   data      数据通路（虚线，参与数据流动，统一 dash 与流速）
 *   control   控制信号（实线，细，不参与数据流动）
 *   branch    跳转/分支控制（红）
 *   zf        数据高亮：ZF / imm / 写回（青）
 *   interrupt 中断/异常信号（橙）
 *   mret      mret 返回路径（紫）
 */
export type WireKind = 'data' | 'control' | 'branch' | 'zf' | 'interrupt' | 'mret'

/** 活跃连线（kind 决定颜色/动画语义） */
export interface ActiveWire {
  id: string
  path: string
  kind: WireKind
  label?: string
  value?: string
}

/** 部件端口说明文字（0.8 倍字号、深灰） */
export interface PortLabel {
  text: string
  x: number
  y: number
  anchor?: 'start' | 'middle' | 'end'
}

/** 模块布局（画布坐标） */
export interface ModuleLayout {
  id: ModuleId
  label: string
  /** 部件名下方的浅色小字（如“（异步）”） */
  sublabel?: string
  shape: 'rect' | 'ellipse' | 'stadium' | 'adder' | 'alu' | 'gate'
  x: number
  y: number
  width: number
  height: number
  description: string
  /** 部件名 1 倍字号（按部件大小指定） */
  nameSize: number
  /** 中断扩展模块（浅橙底色） */
  isNew?: boolean
  /** 端口/内部说明文字（0.8 倍字号、深灰） */
  ports?: PortLabel[]
  /** MUX 输入端 0/1/2 标注 */
  muxPorts?: Array<{ text: string; x: number; y: number }>
}
