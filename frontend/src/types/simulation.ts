// ============================================================================
// simulation.ts —— 仿真状态类型（与后端 cycle_state JSON 协议一一对应）
// ============================================================================

export interface InstructionFields {
  opcode: string
  opcode_name: string
  rd: number
  funct3: string
  rs1: number
  rs2: number
  funct7: string
  format: string
}

export interface ControlSignals {
  reg_write: boolean
  alu_src: boolean
  mem_write: boolean
  mem_read: boolean
  mem_to_reg: boolean
  branch: boolean
  jump: boolean
  is_auipc: boolean
  is_lui: boolean
  is_jalr: boolean
  alu_op: string
}

export interface RegRead {
  index: number
  value: number
}

export interface AluInfo {
  op1: number
  op2: number
  result: number
  zero: boolean
}

export interface MemoryInfo {
  addr: string
  read_data: string
  write_data: string
  access_type: 'NONE' | 'READ' | 'WRITE'
  access_size: number
}

export interface WritebackInfo {
  active: boolean
  reg_index: number
  data: number
  source: 'ALU' | 'MEM' | 'PC_PLUS_4' | 'CSR'
}

export interface BranchInfo {
  taken: boolean
  target_addr: string
}

/** 中断/异常相关 CSR 快照（后端每周期都发，都是 16 进制字符串） */
export interface CsrSnapshot {
  mtvec: string
  mepc: string
  mcause: string
  mstatus: string
  mie: string
  mip: string
  mtime: string
  mtimecmp: string
}

/** 本周期是否发生了 trap（中断/异常） */
export interface TrapInfo {
  taken: boolean
  cause: number   // 原因（含中断标志位，如计时器中断 = 0x80000007）
  mepc: string
  mtval: string
}

/** 单周期数据通路完整状态 */
export interface CycleState {
  pc: string
  next_pc: string
  instruction: string
  disassembly: string
  instruction_fields: InstructionFields
  immediate: number
  control_signals: ControlSignals
  reg_reads: {
    rs1: RegRead
    rs2: RegRead
  }
  alu: AluInfo
  memory: MemoryInfo
  writeback: WritebackInfo
  branch: BranchInfo
  csr: CsrSnapshot
  trap: TrapInfo
  regfile: number[]
  halted: boolean
}

/** 反汇编指令条目 */
export interface DisassemblyEntry {
  pc: string
  bytes: string
  text: string
}

/** 前端历史记录：CPU 状态 + WebSocket 消息外层的周期号 */
export interface CycleSnapshot extends CycleState {
  cycle: number
}

/** 后端推送到前端的公开 WebSocket 消息 */
export type WsMessage =
  | { type: 'ready'; version: string }
  | { type: 'loaded'; entry: string; arch: string; disassembly?: DisassemblyEntry[] }
  | { type: 'cycle_state'; cycle: number; state: CycleState }
  | { type: 'halted'; cycle: number; exit_code: number }
  | { type: 'breakpoint_hit'; addr: string; cycle: number }
  | { type: 'paused' }
  | { type: 'paused_ack' }
  | { type: 'reset_done' }
  | { type: 'breakpoint_set'; addr?: string }
  | { type: 'breakpoint_cleared'; addr?: string }
  | { type: 'error'; message: string }
  | { type: 'memory_dump'; addr: string; bytes: number[] }
  | { type: 'disassembly'; start: string; instructions: DisassemblyEntry[] }

export type SimStatus = 'idle' | 'running' | 'paused' | 'halted' | 'error'
