// ============================================================================
// datapathHighlight.ts —— 把后端 cycle_state 映射成图上的高亮
//
// 分工：datapathLayout.json 管几何，datapathScene.ts 管画法，这里管语义。
// 激活条件是代码不是坐标，所以放在 TS 里而不是 JSON 里——这样有类型检查，
// 也不用 eval 字符串表达式。
//
// 关键：后端 control_signals_t（rv_control.hpp:23-35）只有 11 个字段，图上却
// 有 is_csr / is_mret / illegal / ecall / ebreak / csr_we / csr_addr 这些网络名。
// 它们全部由已有字段精确推导，依据写在下面每个派生量的注释里（行号对应
// backend/cpp/src/rv_core.cpp）。推导口径与后端逐行对齐，不是猜的。
// ============================================================================

// 注意：值导入这里必须带 .ts 后缀。Vite 和 tsc（allowImportingTsExtensions）都认，
// 而且这样 tools/ 下的离线脚本才能用 Node 直接 import 这个文件做验证。
import type { CycleState } from '@/types/simulation'
import { portToModule, wireEndpoints, type DatapathLayout } from './datapathScene.ts'

// ---------------------------------------------------------------- 基础工具

/** "0x80000000" → 2147483648（无符号 32 位） */
function u32(v: string | number | undefined): number {
  if (v === undefined) return 0
  const n = typeof v === 'number' ? v : parseInt(v, 16)
  return Number.isNaN(n) ? 0 : n >>> 0
}

/**
 * "0b010" → 2。
 *
 * 必须先把 "0b" 前缀切掉再 parseInt：radix 为 2 时 "b" 不是合法数字，parseInt 读到
 * 它就当场停下，返回 0——**"0b001" / "0b010" / "0b111" 全都变成 0**。
 * 后端的 bin_str()（json_writer.hpp:50-56）发的正是带前缀的写法。
 * 与之对称的 u32() 不用切，因为 parseInt(v, 16) 本身就认 "0x" 前缀，这也是当初
 * 照着 u32() 写 bin() 时漏掉的地方。
 *
 * 曾经漏了这一步，后果是 csrWe() 恒为 false → 图上 csr_we 网络从来没亮过。
 */
function bin(v: string | undefined): number {
  if (!v) return 0
  const s = v.slice(0, 2).toLowerCase() === '0b' ? v.slice(2) : v
  const n = parseInt(s, 2)
  return Number.isNaN(n) ? 0 : n
}

/** 图上的紧凑十六进制（不补零，短线上放得下） */
export const hex = (n: number): string => '0x' + (n >>> 0).toString(16).toUpperCase()

// ---------------------------------------------------------------- 派生量
// 全部镜像 backend/cpp/src/rv_core.cpp 的实现，行号见注释。

/** 取当前指令的机器码 */
const inst = (s: CycleState): number => u32(s.instruction)

/** 图上的 is_csr 网络：rv_core.cpp:414 只在 CSR 指令那条分支里置 source="CSR" */
export const isCsr = (s: CycleState): boolean => s.writeback.source === 'CSR'

/**
 * 图上的 is_mret 网络。后端 control_signals_t 里没有这个字段，但 rv_disasm.cpp:192-197
 * 有一条精确判据：funct3==0 && rd==0 && rs1==0 && (inst>>20)==0x302。
 * 这四条合起来正好等于「整字 == 0x30200073」，所以直接比整字，与后端逐位一致。
 *
 * 注意别用常见的 0xFE007FFF 掩码——那个掩码会清掉 rs2 所在的 bit[24:20]，
 * 而 mret 的 rs2 恒为 2（正是这几位），一清就永远匹配不上。这里踩过坑。
 */
export const isMret = (s: CycleState): boolean => inst(s) === 0x30200073

/** 图上的 csr_addr 网络：SYSTEM 型的 [31:20] 就是 CSR 地址 */
export const csrAddr = (s: CycleState): number => (inst(s) >>> 20) & 0xfff

/** 后端的 OP_SYSTEM 操作码字段（rv_common.hpp:39）。CSR 那套派生量只对 SYSTEM 型有意义 */
const OP_SYSTEM = 0b1110011

/** 这条指令是不是 SYSTEM 型（对应后端 `in.op.opcode == OP_SYSTEM`） */
export const isSystem = (s: CycleState): boolean =>
  bin(s.instruction_fields?.opcode) === OP_SYSTEM

/**
 * 图上的 csr_we 网络。镜像 rv_core.cpp:400-412 的 do_write 判据：
 * 寄存器版(csrrw/s/c) 取 rs1 的值，立即数版(csrrwi/si/ci) 取 rs1 字段本身当 5 位立即数。
 *
 * 第一道门是「必须是 SYSTEM 型」——后端整张 do_write 表都套在
 * `if (in.op.opcode == OP_SYSTEM)` 里面（rv_core.cpp:379），漏了这道门就会误判：
 * funct3 只是指令的第 [14:12] 位，对非 SYSTEM 指令而言那三位纯属巧合，
 * lw / sw 的 funct3 正好是 0b010（CSRRS 的编码）、lui 0x80001 的 bits[14:12]
 * 正好是 0b001（CSRRW 的编码），于是「CSR 写使能」在一条 load 上亮了起来。
 */
export const csrWe = (s: CycleState): boolean => {
  if (!isSystem(s)) return false
  const f3 = bin(s.instruction_fields?.funct3)
  const regVariant = (f3 & 0b100) === 0
  const src = regVariant ? s.reg_reads.rs1.value >>> 0 : s.instruction_fields.rs1 >>> 0
  switch (f3) {
    case 0b001: case 0b101: return true          // CSRRW / CSRRWI：无条件写
    case 0b010: case 0b011:                      // CSRRS / CSRRC
    case 0b110: case 0b111: return src !== 0     // CSRRSI / CSRRCI
    default: return false
  }
}

/** 图上的 illegal / ecall / ebreak 网络：rv_core.cpp:275 / 381 / 385 的原因编号 */
export const isIllegal = (s: CycleState): boolean => s.trap.taken && s.trap.cause === 2
export const isEcall = (s: CycleState): boolean => s.trap.taken && s.trap.cause === 11
export const isEbreak = (s: CycleState): boolean => s.trap.taken && s.trap.cause === 3

/**
 * 图上的 csr_irq 网络：rv_core.cpp:265-268 的三道门
 * mtime >= mtimecmp && mie.MTIE(bit7) && mstatus.MIE(bit3)
 */
export const csrIrq = (s: CycleState): boolean =>
  u32(s.csr.mtime) >= u32(s.csr.mtimecmp) &&
  (u32(s.csr.mie) & (1 << 7)) !== 0 &&
  (u32(s.csr.mstatus) & (1 << 3)) !== 0

/** 图上的 pcsel / jump_or_jalr 网络：explained.md 记录的三个 PC-MUX sel 来源 */
export const pcSel = (s: CycleState): boolean =>
  s.control_signals.branch || s.control_signals.jump || s.control_signals.is_jalr
export const jumpOrJalr = (s: CycleState): boolean =>
  s.control_signals.jump || s.control_signals.is_jalr

/** muxa0 的输出：0=rs1, 1=imm, sel=is_lui */
const muxa0Out = (s: CycleState): number =>
  s.control_signals.is_lui ? s.immediate >>> 0 : s.reg_reads.rs1.value >>> 0

/** wbmux0 的输出：0=ALU 结果, 1=内存读数据, sel=mem_to_reg */
const wbmux0Out = (s: CycleState): number =>
  s.control_signals.mem_to_reg ? u32(s.memory.read_data) : s.alu.result >>> 0

/** wbmux1 的输出：0=wbmux0, 1=csr_old, sel=is_csr */
const wbmux1Out = (s: CycleState): number =>
  isCsr(s) ? s.writeback.data >>> 0 : wbmux0Out(s)

// ---------------------------------------------------------------- 表

export interface WireSignal {
  /** 本周期这条线上是否真的在传值 */
  active: (s: CycleState) => boolean
  /** 线上浮的小标签显示什么；不填就不显示 */
  value?: (s: CycleState) => string
}

const ALWAYS: WireSignal = { active: () => true }

/**
 * 电源性质的部件：时钟源、复位、常量 0、常量 4。
 * 它们发出的线（w_clk_* / w_reset_* / w_const0_* / w_c4_*）是**供电**，不是数据通路，
 * 所以只点亮电源自己，不点亮被供电的那个部件。详见 computeHighlight 里的说明。
 * 与 datapathWave.ts 的 ALWAYS_LIT 是同一组，两处都在说「这几块不算数据流」。
 */
const SUPPLY_MODULES = new Set(['clkmod', 'reset', 'const0', 'const4'])

/**
 * 连线 id → 高亮规则。57 条全在这里。
 * 没写进来的走「恒亮、不显值」的默认（见 DEFAULT_WIRE_SIGNAL）。
 */
export const WIRE_SIGNAL: Record<string, WireSignal> = {
  // ---- IF 取指 ----
  'w_pc_imem': { active: () => true, value: (s) => hex(u32(s.pc)) },
  'w_pc_add4': { active: () => true, value: (s) => hex(u32(s.pc)) },
  'w_c4_add4': ALWAYS,
  'w_clk_pc': ALWAYS, 'w_clk_imem': ALWAYS, 'w_clk_rf': ALWAYS, 'w_clk_dmem': ALWAYS,
  'w_reset_pc': ALWAYS, 'w_reset_rf': ALWAYS,

  // ---- PC 目标选择链 ----
  'w_add4_m1': { active: () => true, value: (s) => hex(u32(s.pc) + 4) },
  'w_add4_m4': { active: () => true, value: (s) => hex(u32(s.pc) + 4) },
  // pcimmadder 的 PC 输入（减法那一路由 pcimmadder 自己算，这里只标它通了）
  'w_immadd_m4': { active: (s) => s.branch.taken, value: (s) => hex(u32(s.branch.target_addr)) },
  'w_immadd_m3': { active: (s) => s.control_signals.is_jalr },
  'w_taken_m4': { active: (s) => s.branch.taken },
  'w_sel_m1': { active: pcSel },
  'w_sel_m2': { active: jumpOrJalr },
  'w_sel_m3': { active: (s) => s.control_signals.is_jalr },
  'w_dec_beq': { active: (s) => s.control_signals.branch },
  'w_alu_zf': { active: () => true, value: (s) => (s.alu.zero ? 'ZF=1' : 'ZF=0') },
  // pcmux2 → pcmux1：这条线传的是「选中的 PC 目标」，只有真发生了跳转才有值。
  // 注意 jumpOrJalr 是个函数，必须调用——写成 `jumpOrJalr || ...` 是拿函数对象
  // 当真值判断，恒为真，这条线会常亮（vue-tsc 会报 TS2322）。
  'w_m2_m1': { active: (s) => s.branch.taken || jumpOrJalr(s) },
  'w_m3_m2': { active: (s) => s.control_signals.is_jalr },
  'w_m4_m2': { active: (s) => s.branch.taken },
  'w_m1_m6': { active: () => true },
  'w_m6_m5': { active: (s) => !s.trap.taken },
  'w_m5_pc': { active: () => true, value: (s) => hex(u32(s.next_pc)) },
  'w_alu_jalr': { active: (s) => s.control_signals.is_jalr, value: (s) => hex(s.alu.result) },
  'w_jalr_m3': { active: (s) => s.control_signals.is_jalr, value: (s) => hex(s.alu.result & ~1) },

  // ---- IF/ID ----
  'w_imem_dec': { active: () => true, value: (s) => hex(inst(s)) },

  // ---- ID 译码 ----
  'w_dec_ra1': { active: () => true, value: (s) => `x${s.instruction_fields.rs1}` },
  'w_dec_ra2': { active: () => true, value: (s) => `x${s.instruction_fields.rs2}` },
  'w_dec_wen': { active: (s) => s.control_signals.reg_write },
  'w_dec_waddr': { active: (s) => s.control_signals.reg_write, value: (s) => `x${s.writeback.reg_index}` },

  // ---- 立即数 ----
  'w_imm_immadd': { active: () => true, value: (s) => hex(s.immediate) },
  'w_imm_muxa0': { active: (s) => s.control_signals.is_lui, value: (s) => hex(s.immediate) },
  'w_imm_muxb': { active: (s) => s.control_signals.alu_src, value: (s) => hex(s.immediate) },

  // ---- 寄存器读 ----
  'w_rf_ma0': { active: (s) => !s.control_signals.is_lui, value: (s) => hex(s.reg_reads.rs1.value) },
  'w_rf_mb1': { active: (s) => !s.control_signals.alu_src, value: (s) => hex(s.reg_reads.rs2.value) },
  'w_rf_dmem': { active: (s) => s.control_signals.mem_write, value: (s) => hex(u32(s.memory.write_data)) },

  // ---- EX ----
  'w_muxa0_muxa': { active: (s) => !s.control_signals.is_auipc, value: (s) => hex(muxa0Out(s)) },
  'w_ma_alu': { active: () => true, value: (s) => hex(s.alu.op1) },
  'w_mb_alu': { active: () => true, value: (s) => hex(s.alu.op2) },
  'w_alu_dmem': { active: (s) => s.control_signals.mem_read || s.control_signals.mem_write, value: (s) => hex(s.alu.result) },
  'w_alu_wb0': { active: (s) => !s.control_signals.mem_to_reg, value: (s) => hex(s.alu.result) },
  'w_ctl_alusrc': { active: (s) => s.control_signals.alu_src },
  'w_ctl_aluop': { active: () => true, value: (s) => s.control_signals.alu_op },
  'w_ctl_auipc': { active: (s) => s.control_signals.is_auipc },
  'w_ctl_islui': { active: (s) => s.control_signals.is_lui },

  // ---- MEM ----
  'w_ctl_sw': { active: (s) => s.control_signals.mem_write },
  'w_dmem_wb0': { active: (s) => s.control_signals.mem_to_reg, value: (s) => hex(u32(s.memory.read_data)) },
  'w_ctl_memtoreg': { active: (s) => s.control_signals.mem_to_reg },

  // ---- WB ----
  'w_wb0_wb': { active: (s) => !isCsr(s), value: (s) => hex(wbmux0Out(s)) },
  'w_wb1_wb': { active: (s) => !jumpOrJalr(s), value: (s) => hex(wbmux1Out(s)) },
  'w_wb_rf': { active: (s) => s.control_signals.reg_write, value: (s) => hex(s.writeback.data) },
  'w_ctl_link': { active: jumpOrJalr },

  // ---- 常量 0 ----
  'w_const0_d': ALWAYS,
  'w_const0_we': ALWAYS,

  // ---- trap / CSR ----
  'w_csr_irq': { active: csrIrq },
}

/** 表里没写的连线走这个：恒亮、不显值 */
export const DEFAULT_WIRE_SIGNAL: WireSignal = ALWAYS

/**
 * 网络标签名 → 高亮规则。同名即同网，所以按名字匹配，不按端口。
 * pc / pc+4 / src1_rdata 这三个是「名字也出现在线名上」的跨图信号。
 */
export const NET_SIGNAL: Record<string, WireSignal> = {
  'pc': { active: () => true, value: (s) => hex(u32(s.pc)) },
  'pc+4': { active: () => true, value: (s) => hex(u32(s.pc) + 4) },

  /**
   * 图上挂在 csr.wdata_in 端口的网络，表示「rs1 寄存器的值送进 CSR 写数据口」。
   *
   * 后端只在这两个条件同时成立时才真这么走（rv_core.cpp:403-412）：
   *   1. 寄存器版（funct3 的 bit2 为 0，即 csrrw / csrrs / csrrc）——
   *      src 取 m_regfile.read(rs1) 的**值**；
   *   2. 这一拍确实要写 CSR（do_write）。
   * csrWe() 就是那张 do_write 表的逐行镜像，直接复用，不另写一份判据。
   *
   * 立即数版（csrrwi / csrrsi / csrrci）虽然写到同一个端口，但 src 取的是 rs1
   * **字段**本身，寄存器堆根本没被读到这条路上；这条网络名字就叫 src1_rdata
   * （寄存器读出的数据），图上也没给它画第二根线，所以立即数版就该不亮，
   * 而不是拿寄存器堆的值冒充。
   *
   * 曾经这里写的是 active: () => true。后果不只是这条网络常亮——它挂在 csr 的
   * 端口上，而 computeHighlight 会把「激活网络所在的模块」一并点亮，于是
   * **CSR 寄存器组对每条指令（哪怕 addi）都是亮的**，跟 dmem 被时钟线点亮是同一类病。
   */
  'src1_rdata': {
    active: (s) => csrWe(s) && (bin(s.instruction_fields.funct3) & 0b100) === 0,
    value: (s) => hex(s.reg_reads.rs1.value),
  },

  'mtvec': { active: (s) => s.trap.taken, value: (s) => hex(u32(s.csr.mtvec)) },
  'mepc': { active: (s) => isMret(s), value: (s) => hex(u32(s.csr.mepc)) },
  'csr_old': { active: isCsr, value: (s) => hex(s.writeback.data) },
  'is_csr': { active: isCsr },
  'csr_addr': { active: isCsr, value: (s) => hex(csrAddr(s)) },
  'csr_we': { active: csrWe },
  'is_mret': { active: isMret },
  'trap_taken': { active: (s) => s.trap.taken },
  'illegal': { active: isIllegal, value: (s) => hex(u32(s.trap.mtval)) },
  'ecall': { active: isEcall },
  'ebreak': { active: isEbreak },
}

export const DEFAULT_NET_SIGNAL: WireSignal = { active: () => false }

// ---------------------------------------------------------------- 汇总

export interface HighlightResult {
  /** 激活的连线 id */
  wires: Set<string>
  /** 激活的网络标签名 */
  nets: Set<string>
  /** 被点亮的部件 id（推导：只要有一条相邻的线是激活的，部件就亮） */
  modules: Set<string>
  /** 连线 id → 线上显示的当前值 */
  values: Map<string, string>
  /** 本周期是否发生了 trap */
  trapActive: boolean
}

/** 每次返回新的空结果——里面的 Set/Map 是可变的，共用一个会被调用方改坏 */
const empty = (): HighlightResult => ({
  wires: new Set(), nets: new Set(), modules: new Set(), values: new Map(), trapActive: false,
})

/** 按当前周期状态算出整张图的高亮。state 为 null（还没跑）时返回空。 */
export function computeHighlight(
  state: CycleState | null | undefined,
  layout: DatapathLayout,
): HighlightResult {
  if (!state) return empty()

  const wires = new Set<string>()
  const values = new Map<string, string>()

  for (const w of layout.wires) {
    const rule = WIRE_SIGNAL[w.id] || DEFAULT_WIRE_SIGNAL
    if (!rule.active(state)) continue
    wires.add(w.id)
    if (rule.value) {
      const v = rule.value(state)
      if (v) values.set(w.id, v)
    }
  }

  const nets = new Set<string>()
  for (const p of layout.ports) {
    if (!p.net) continue
    if (nets.has(p.net)) continue
    const rule = NET_SIGNAL[p.net] || DEFAULT_NET_SIGNAL
    if (rule.active(state)) nets.add(p.net)
  }

  // 部件点亮：不硬编码，从「端口 → 部件」和「连线 → 两端端口」反查出来
  const p2m = portToModule(layout)
  const ep = wireEndpoints(layout)
  const modules = new Set<string>()
  for (const id of wires) {
    const e = ep[id]
    if (!e) continue
    const a = p2m[e.from]
    const b = p2m[e.to]
    if (a) modules.add(a)
    // 电源线的受驱端不算「本周期被用到」。
    // 时钟/复位/常量是**一直**通着电的，一根从它们出发的线只说明「这个部件接上了电源」，
    // 不说明这一拍真的在用它。不区分的话 dmem 会被 w_clk_dmem 点亮，结果每条指令
    // （哪怕 addi）存储器都亮着——它明明只有 lw/sw 才用得着。
    // 源端照常点亮：clkmod/reset/const0/const4 自己是电源，本来就该一直亮。
    // 判定用「源部件是不是电源」而不是列线名，以后加线不用回来改这张表。
    if (b && !SUPPLY_MODULES.has(a)) modules.add(b)
  }
  // 激活的网络标签也点亮它挂着的部件
  for (const p of layout.ports) {
    if (p.net && nets.has(p.net)) modules.add(p.module)
  }

  return { wires, nets, modules, values, trapActive: state.trap.taken }
}
