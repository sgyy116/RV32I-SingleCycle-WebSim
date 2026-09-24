// ============================================================================
// datapath.ts —— 数据通路可视化布局与状态类型
// ============================================================================

export type ModuleId =
  | 'pc'
  | 'pc-adder'
  | 'branch-adder'
  | 'mux-pc'
  | 'imem'
  | 'decoder'
  | 'regfile'
  | 'immgen'
  | 'mux-alu-src'
  | 'alu'
  | 'dmem'
  | 'mux-mem-to-reg'

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

/** 活跃连线（kind 决定颜色/动画语义） */
export interface ActiveWire {
  id: string
  path: string
  kind: 'data' | 'control' | 'state' | 'alu'
  label?: string
  value?: string
}

/** 模块布局（画布坐标） */
export interface ModuleLayout {
  id: ModuleId
  label: string
  x: number
  y: number
  width: number
  height: number
  description: string
}
