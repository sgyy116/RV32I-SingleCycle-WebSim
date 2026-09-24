// ============================================================================
// datapathWave.ts —— 把「本周期的高亮」切成按传播顺序排列的若干波
//
// 为什么需要这一层：datapathHighlight.ts 只回答「这条线本周期通不通」，不回答
// 「谁先于谁通」。单周期 CPU 里一条指令 = 一个时钟周期，所以这里要建模的不是
// 指令周期，而是**一条指令内部组合逻辑的传播延迟**——信号从 PC 出发，经过译码器、
// 寄存器堆、ALU、写回多路器，一级一级传下去，最后在时钟沿写回。
//
// 分工同 datapathScene.ts：纯函数、不 import Vue、不产出 SVG 字符串。
// 这样 tools/hl_preview.mjs 能直接 import 本文件，网页和离线预览共用同一份波次划分。
//
// 本文件被 Node 直接 import（类型剥离），所以只能用可擦除语法：禁 enum / namespace /
// 构造器参数属性。值导入必须带 .ts 后缀。
//
// ---------------------------------------------------------------- 两个建模决策
//
// 【一】时钟沿切分。数据通路里有反馈环（wbmux → regfile.wdata、pcmux5 → PC.pc_next、
// csr → wbmux1 → csr），环上最长路径无定义。解法是把**时钟沿切开的写端口**当作汇点：
// 写到这些端口的信号属于「本周期末」，不参与组合传播的建边。读端口和地址端口是
// 组合的，一律不切——csr.addr_in 尤其不能切，地址一进去 rdata_out 就出来。
//
// 【二】网络标签也是连线。布局里有 14 个网络标签，其中 **11 个是真实连接但没画成
// wire**（见下面的 NET_LINK）。只拿 hl.wires 建边会丢掉一整块连通性，症状是
// csrrw 里 csr 永不点亮、csr_old/is_csr 全落空、wbmux1 跑到第 0 波跟 PC 一起亮。
// 方向不用猜端口坐标——端口名里的 _out / _in 就是驱动端和受驱端。
// ============================================================================

import type { HighlightResult } from './datapathHighlight.ts'
import { portToModule, wireEndpoints, type DatapathLayout } from './datapathScene.ts'

/** 节点名后缀：时钟沿切开的写端口节点。它不渲染成方块，只给线定位用 */
const IN = '#in'

/**
 * 时钟沿切开的写端口：模块 id → 该模块上的「汇点」端口名。
 * 只切真正的**时钟沿写入**端口：PC 的下一拍值、寄存器堆的写口、内存的写口、
 * CSR 的写口。读端口（regfile.ra1/rd1）、地址端口（csr.addr_in、dmem.a）都是组合的。
 */
const SINK: Record<string, string[]> = {
  PC: ['pc_next'],
  regfile: ['wdata', 'wen', 'waddr'],
  dmem: ['d', 'we'],
  csr: ['wdata_in', 'we_in'],
}

/**
 * 常备电源性质的模块：时钟、复位、常量 0、常量 4。
 * 它们不参与波次划分，全程保持点亮——波形从 PC 出发更干净。
 */
export const ALWAYS_LIT: Set<string> = new Set(['clkmod', 'const0', 'const4', 'reset'])

/**
 * 网络标签里的真实连接（生成端端口 → 接收端端口）。
 *
 * 这 11 条在布局里**没有对应的 wire**，只在两端端口上各写了一个 net 名。
 * 不算进来的话图是断的：csr 和 trapunit 整个算不出波次。
 *
 * 另外三个网络是纯注解，不是连接，故意不在此表：
 *   pc           → pcimmadder.a_pc 和 muxa.ma_1 都是消费者
 *   pc+4         → 只有 wbmux.wb_1 一个端口
 *   src1_rdata   → 只有 csr.wdata_in 一个端口
 */
export const NET_LINK: Record<string, [string, string]> = {
  csr_addr:   ['decoder.csr_addr_out',  'csr.addr_in'],
  csr_we:     ['decoder.csr_we_out',    'csr.we_in'],
  is_csr:     ['decoder.is_csr_out',    'wbmux1.wb1_sel'],
  illegal:    ['decoder.illegal_out',   'trapunit.illegal_in'],
  ecall:      ['decoder.ecall_out',     'trapunit.ecall_in'],
  ebreak:     ['decoder.ebreak_out',    'trapunit.ebreak_in'],
  is_mret:    ['decoder.mret_out',      'pcmux6.m6_sel'],
  trap_taken: ['trapunit.taken_out',    'pcmux5.m5_sel'],
  mtvec:      ['csr.mtvec_out',         'pcmux5.m5_1'],
  mepc:       ['csr.mepc_out',          'pcmux6.m6_1'],
  csr_old:    ['csr.rdata_out',         'wbmux1.wb1_1'],
}

/** 纯注解网络：只有一个端口，或两端都是消费者。不参与建边 */
export const ANNOTATION_NETS = ['pc', 'pc+4', 'src1_rdata']

/** 端口 id "PC.pc_next" → 端口名 "pc_next" */
function portName(portId: string): string {
  const i = portId.lastIndexOf('.')
  return i < 0 ? portId : portId.slice(i + 1)
}

/** 把「模块 + 端口」映射到节点：写到时钟沿写端口的是独立节点，其余归模块本身 */
function nodeOf(module: string, portId: string): string {
  return (SINK[module] || []).includes(portName(portId)) ? module + IN : module
}

export interface WavePlan {
  /** 总波数。0 表示本周期没有任何信号在传（比如停机态） */
  count: number
  /** 模块 id → 它在第几波点亮（0 基）。查不到 = 该模块常亮，不占波次 */
  frameOfModule: Map<string, number>
  /** 连线 id → 它在第几波点亮（0 基）。查不到 = 恒亮，不占波次 */
  frameOfWire: Map<string, number>
  /** 网络标签名 → 它在第几波出现（0 基）。只含 NET_LINK 里的真实连接 */
  frameOfNet: Map<string, number>
}

/** 空计划——state 为 null 时用，等价于「一波都没有」 */
export function emptyPlan(): WavePlan {
  return { count: 0, frameOfModule: new Map(), frameOfWire: new Map(), frameOfNet: new Map() }
}

// 布局自检只跑一次：所有「有两个以上端口」的网络，要么在 NET_LINK 里，要么是注解网络。
// 以后改布局多出一个网络时会立刻在控制台看到，而不是默默把图算断。
let linksChecked = false
function checkNetLinks(layout: DatapathLayout): void {
  if (linksChecked) return
  linksChecked = true
  const count: Record<string, number> = {}
  for (const p of layout.ports) if (p.net) count[p.net] = (count[p.net] || 0) + 1
  const missing = Object.keys(count).filter(
    (n) => count[n] >= 2 && !NET_LINK[n] && !ANNOTATION_NETS.includes(n),
  )
  if (missing.length && typeof console !== 'undefined') {
    console.warn('[datapathWave] 这些网络有两个以上端口却既不在 NET_LINK 也不在注解表里，图会被算断：', missing)
  }
}

/**
 * 按本周期激活的信号算出波次划分。
 *
 * 分层只在**激活子图**上做。这样每层都非空（最长路径的性质：存在深度 d 的节点就
 * 意味着存在长度 d 的链，链上每个深度都有节点），而且 lui / jal 这类短路径指令的
 * 波数天然更少，不会出现「这一波什么都没亮」的空转。
 *
 * 激活子图必然无环——它是全图的子集，删边不可能造出环，而全图已验证 0 环。
 */
export function computeWaves(hl: HighlightResult, layout: DatapathLayout): WavePlan {
  if (hl.wires.size === 0 && hl.nets.size === 0) return emptyPlan()
  checkNetLinks(layout)

  const p2m = portToModule(layout)
  const ep = wireEndpoints(layout)

  const edgeFrom: string[] = []
  const edgeTo: string[] = []
  const edgeWire: string[] = []   // 有对应连线 id 的边；网络引线边这里放空串
  const edgeNet: string[] = []
  const nodes = new Set<string>()

  function addEdge(fromNode: string, toNode: string, wire: string, net: string): void {
    edgeFrom.push(fromNode)
    edgeTo.push(toNode)
    edgeWire.push(wire)
    edgeNet.push(net)
    nodes.add(fromNode)
    nodes.add(toNode)
  }

  // ---- 1a) 激活的 wire → 边。从恒亮模块出发的线不建边：时钟/复位/常量不参与传播层次
  for (const id of hl.wires) {
    const e = ep[id]
    if (!e) continue
    const mf = p2m[e.from]
    const mt = p2m[e.to]
    if (!mf || !mt) continue
    if (ALWAYS_LIT.has(mf)) continue
    addEdge(nodeOf(mf, e.from), nodeOf(mt, e.to), id, '')
  }

  // ---- 1b) 激活的 net 引线 → 边（见文件头【二】）
  for (const n of hl.nets) {
    const link = NET_LINK[n]
    if (!link) continue
    const [fromPort, toPort] = link
    const mf = p2m[fromPort]
    const mt = p2m[toPort]
    if (!mf || !mt) continue
    addEdge(nodeOf(mf, fromPort), nodeOf(mt, toPort), '', n)
  }

  // ---- 1c) 下限边：csr 只要本周期被用到，它的地址就来自译码器，不可能早于译码器。
  // 少了这条，mret / ecall 这类指令里 csr 的 addr/we 网络不激活，csr 会掉到第 0 波
  // 跟 PC 一起亮，顺序就错了。
  if (hl.modules.has('decoder') && hl.modules.has('csr')) {
    addEdge('decoder', 'csr', '', '')
  }

  if (nodes.size === 0) return emptyPlan()

  // ---- 2) 拓扑排序 + 最长路径分层
  const adj = new Map<string, number[]>()   // 节点 → 出边下标
  const indeg = new Map<string, number>()
  for (const n of nodes) {
    adj.set(n, [])
    indeg.set(n, 0)
  }
  for (let i = 0; i < edgeFrom.length; i++) {
    adj.get(edgeFrom[i])!.push(i)
    indeg.set(edgeTo[i], (indeg.get(edgeTo[i]) || 0) + 1)
  }

  const depth = new Map<string, number>()
  for (const n of nodes) depth.set(n, 0)

  const queue: string[] = []
  for (const [n, d] of indeg) if (d === 0) queue.push(n)

  let visited = 0
  while (queue.length) {
    const n = queue.shift()!
    visited++
    const dn = depth.get(n) || 0
    for (const i of adj.get(n)!) {
      const m = edgeTo[i]
      if ((depth.get(m) || 0) < dn + 1) depth.set(m, dn + 1)
      const d = indeg.get(m)! - 1
      indeg.set(m, d)
      if (d === 0) queue.push(m)
    }
  }
  // 理论上到不了这里（激活子图无环）。真出现了也不能白屏，让没排到的节点留在第 0 波。
  if (visited !== nodes.size && typeof console !== 'undefined') {
    console.warn('[datapathWave] 激活子图出现环，波次可能不准：', nodes.size - visited, '个节点未排到')
  }

  // ---- 3) 模块的波次 = 它「组合节点」的深度
  // #in 是幻影节点，代表时钟沿的写入，不决定模块本身什么时候亮——
  // 否则 regfile 会被推到最后一波，而它明明早就在被读了。
  const frameOfModule = new Map<string, number>()
  for (const n of nodes) {
    if (n.endsWith(IN)) continue
    if (ALWAYS_LIT.has(n)) continue
    frameOfModule.set(n, depth.get(n) || 0)
  }

  // ---- 4) 连线的波次 = 它源节点的深度
  // 例外：指向 #in 的那根写回线，属于「它到达」的那一波，也就是最后一波。
  // 这条例外同时是**防空尾波**的手段：不做的话 regfile#in 的深度会大于所有模块的
  // 深度，那一波就只剩一个深度、没有任何东西可点亮。
  const frameOfWire = new Map<string, number>()
  for (let i = 0; i < edgeWire.length; i++) {
    if (!edgeWire[i]) continue
    const to = edgeTo[i]
    const f = to.endsWith(IN) ? depth.get(to) || 0 : depth.get(edgeFrom[i]) || 0
    frameOfWire.set(edgeWire[i], f)
  }

  // ---- 5) 网络标签的波次 = 它源节点的深度。注解网络不进这张表（永远保留）
  const frameOfNet = new Map<string, number>()
  for (let i = 0; i < edgeNet.length; i++) {
    if (!edgeNet[i]) continue
    frameOfNet.set(edgeNet[i], depth.get(edgeFrom[i]) || 0)
  }

  // ---- 6) 总波数
  let maxFrame = -1
  for (const f of frameOfModule.values()) if (f > maxFrame) maxFrame = f
  for (const f of frameOfWire.values()) if (f > maxFrame) maxFrame = f
  for (const f of frameOfNet.values()) if (f > maxFrame) maxFrame = f

  return { count: maxFrame + 1, frameOfModule, frameOfWire, frameOfNet }
}

/** 某模块在第几波。返回 -1 表示本周期没用到它（不等于「第 0 波」） */
export function moduleFrame(plan: WavePlan, id: string): number {
  return plan.frameOfModule.get(id) ?? -1
}

/**
 * 只保留前 k 波的高亮。k = 0 时除恒亮模块外什么都不亮；k >= plan.count 时结果与入参等价。
 *
 * 查不到波次的元素一律**保留**。这条兜底很关键：像 dmem（只被时钟线点亮）和 csr
 * （被恒亮网络 src1_rdata 点亮）这种模块算不出深度，保留它们才和改造前的观感一致；
 * 反过来，宁可多亮一个也不要因为漏标让图上少东西。
 */
export function sliceHighlight(hl: HighlightResult, plan: WavePlan, k: number): HighlightResult {
  const wires = new Set<string>()
  const modules = new Set<string>()
  const nets = new Set<string>()
  const values = new Map<string, string>()

  for (const id of hl.wires) {
    const f = plan.frameOfWire.get(id)
    if (f === undefined || f < k) wires.add(id)
  }
  for (const id of hl.modules) {
    if (ALWAYS_LIT.has(id)) { modules.add(id); continue }
    const f = plan.frameOfModule.get(id)
    if (f === undefined || f < k) modules.add(id)
  }
  for (const n of hl.nets) {
    const f = plan.frameOfNet.get(n)
    if (f === undefined || f < k) nets.add(n)
  }
  // 数值气泡跟着连线走：线没亮，线上的值也不该冒出来
  for (const [id, v] of hl.values) if (wires.has(id)) values.set(id, v)

  // 陷阱的红色也逐波出现——不然第 1 波就整组标红，等于提前剧透
  const tf = plan.frameOfModule.get('trapunit')
  const trapActive = hl.trapActive && (tf === undefined || tf < k)

  return { wires, nets, modules, values, trapActive }
}

/** 第 k 波「新生」的连线（上一波还没亮的那些），用来做虚线流动效果 */
export function freshWires(hl: HighlightResult, plan: WavePlan, k: number): Set<string> {
  const out = new Set<string>()
  if (k <= 0) return out
  const want = k - 1   // frame 是 0 基，k 是「已点亮波数」，所以第 k 波亮的是 frame = k-1
  for (const id of hl.wires) if (plan.frameOfWire.get(id) === want) out.add(id)
  return out
}

// ---------------------------------------------------------------- 面板门控

/** 右侧面板各卡片的显示开关。键名见实现里的对照 */
export interface PanelGates {
  fetch: boolean     // 当前指令（imem）
  decode: boolean    // 控制信号（decoder）
  regRead: boolean   // rs1 / rs2（regfile）
  alu: boolean       // ALU
  mem: boolean       // 访存（dmem）
  branch: boolean    // 分支 / 跳转（taken）
  wb: boolean        // 写回（wbmux）
  trap: boolean      // 中断 / 异常横幅（trapunit）
  csr: boolean       // CSR 八个值（csr）
}

/**
 * 按当前波次算出各面板卡片的开关。
 *
 * 不硬编码字段→波次的对应表（约 40 个字段，必然漂移），而是按「卡片 → 部件」推：
 * 波次走到哪个部件，那张卡片才出现。查不到部件的（本周期根本没用到）
 * 一律当作「一直可用」，这样不会把本来就显示的卡片误关掉。
 */
export function gateOf(plan: WavePlan, k: number): PanelGates {
  const open = (mod: string): boolean => {
    const f = plan.frameOfModule.get(mod)
    return f === undefined || f < k
  }
  return {
    fetch: open('imem'),
    decode: open('decoder'),
    regRead: open('regfile'),
    alu: open('alu'),
    mem: open('dmem'),
    branch: open('taken'),
    wb: open('wbmux'),
    trap: open('trapunit'),
    csr: open('csr'),
  }
}
