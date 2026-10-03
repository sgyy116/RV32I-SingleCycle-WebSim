// ============================================================================
// datapathPalette.ts —— 数据通路配色的唯一真相源
//
// 以前线色被抄在三个地方（datapathScene 的 WIRE_COLOR、它的 LABEL_COLOR、
// DatapathView 图例里的 .sw.*），而且 style.css 里还留着一套完全冲突的旧配色。
// 结果是「图例说什么颜色」和「图上画什么颜色」可以各自漂移而没人发现。
// 现在只有这一份，图例由它渲染出来，所以图例和图上不可能不一致。
//
// 判定口径（改 kind 时按这个来，别凭感觉）：
//   address = 一切「位置编号」：PC 值、下一条 PC、跳转目标、访存地址、寄存器号
//   control = 一切「决定 / 开关」：判据、选择端、写使能、ALU 操作码
//   imm     = 立即数与图上字面常量（4、0）
//   data    = 其余「传值」的线（指令码、寄存器读出、ALU 结果写回）
//   clock   = 全局时序（clk / reset）
//   trap    = 异常 / 中断相关
//
// ── 配色是怎么定下来的（2026-10-01，用户反馈「有些线颜色相像」后重做三轮）──
//
// 【为什么旧的会相像】旧版追求「所有线都比所有模块描边色暗」，6 个色全被压进
// Tailwind 700 级那一条窄明度带里。后果是**蓝 #1d4ed8 和紫 #6d28d9 在
// CIEDE2000 下只差 12.3，在红绿色盲模拟下只差 0.66** —— 图上等于同一个颜色。
// 60 根线里有 30 根是这两类，用户看到的「相像」就是这个。而「线比框暗」这条
// 规则本来也没守住：data 蓝 vs 圆形部件框实测只差 5.9。所以这一版放弃明度迁就，
// 改为**同时用色相和明度拉开**。
//
// 【最后这六个色是用户指定的语义色系】用户点名要「金黄 / 翠绿 / 紫 / 赤红 /
// 青 / 深蓝」，其中赤红必须给异常 / 中断，其余由实现分配。因此本表不是
// 「自由搜索出的最优六色」，而是**在这六个色系的窗口内搜出的最优组合**——
// 这两个最优不是一回事，下面把代价写清楚。
//
//     正常视觉最小 ΔE   12.32 → 28.03
//     色盲模拟最小 ΔE    0.66 → 10.67
//     白底对比度最低     4.76 →  3.25
//
// 【金黄只能做成暗金，这是物理限制不是偏好】亮金黄在白底上过不了可见性下限：
// #FACC15 只有 1.53:1、#EAB308 1.92:1、#CA8A04 2.94:1，2.5px 细线会糊掉。
// 能用的最早一档是 #B8860B（DarkGoldenrod）3.25:1，再亮就是不可见。所以
// MIN_CONTRAST 定在 3.2 而不是 3.5 —— 这一条专门为金黄让的，其余五色实测
// 都在 3.68:1 以上。
//
// 【翠绿和青天生挨得近，这是本方案的瓶颈】六个色系在色环上不是均匀分布：
// 翠绿(163°) / 青(192°) / 深蓝(224°) 三个挤在 60 度里，而金黄(43°) 到翠绿
// 中间空着 120 度。结果色盲模拟下的瓶颈对就是「地址 / PC 青 vs 时钟 / 复位 紫」
// (deutan 10.67) 和「地址 / PC 青 vs 控制信号 翠绿」(tritan 13.57)。
// 当时 MUX 描边还是青色，试过把青压深来躲它，代价是分离度崩盘（#0E7490 掉到
// 4.33），所以青停在 #0891B2；后来改成把 MUX 描边调灰（见下一段）。
//
// 【一度存在的残留，已修掉】地址 / PC 的青 #0891B2 曾经和 MUX 模块描边色
// #0284c7 只差 ΔE 10.94（色相只差 7 度）—— 青色地址线插进青色边框的 MUX 时
// 线框分不干净，是全图最差的一对。2026-10-01 按用户决定把 MUX 描边改成和
// 其它矩形一样的灰 #475569（理由见 datapathScene.ts 的 C 表注释）。
// 现在「线 vs 框」的最差是 trap 线 #be123c vs trap 框 #dc2626 的 11.94 ——
// 那一对是**故意**留的一档明度差，用来区分「这是线还是框」。
// 作为对照：旧版同类问题最差是 5.9。
//
// 【线 vs 框至今仍有的一处不通】颜色相似的模拟下，立即数的金黄 #b8860b 与
// 加法器 / ALU 的橙 #ea580c 在二代色盲（deutan）里只差 ΔE 1.03 —— 等于同一个
// 颜色。正常视觉下两者差 24.12，完全没问题。这是**只影响色盲用户**的旧问题，
// 与 MUX 无关，改 MUX 也修不了它，需要改「金黄」或「橙」其中之一才能解，
// 两边都是用户点名的语义色，所以先记在这里，没有动。
//
// 这几条数字由 tools/_palette_check.mjs 每次离线核对时重算断言，改色改到
// 低于阈值会直接报错，不会静默退化。
//
// 仍然要如实说明：**纯灰度打印下 6 类分不开**（6 个色塞不进一维亮度空间）。
// 兜底的三条通道是：control 是唯一的虚线、图例常驻、悬停 tooltip 显示中文类别名。
//
// 语法约束：本文件被 datapathScene.ts 引用，而后者要能被 Node 24 直接跑
// （类型剥离），所以只能用可擦除语法 —— type / interface / as，
// 不许出现 enum、namespace、构造器参数属性。
// ============================================================================

export type WireKind = 'data' | 'address' | 'imm' | 'control' | 'clock' | 'trap'

export interface WireKindSpec {
  kind: WireKind
  /** 图例与悬停提示上的中文名。中文界面里绝不能把 kind 这个英文 token 露给学生。 */
  label: string
  color: string
  /** 空串 = 实线。只有 control 用虚线，这是它唯一的非颜色通道。 */
  dash: string
  /** 默认态线宽。激活态按 v1.3.1 统一为 2.5 的流动虚线，类别仍由颜色表达。 */
  width: number
}

/**
 * 顺序就是图例里的显示顺序：先按「传什么」分（数据 / 地址 / 立即数），
 * 再按「干什么用」分（控制 / 时钟 / 异常）。
 */
export const WIRE_KINDS: WireKindSpec[] = [
  { kind: 'data',    label: '数据总线',     color: '#1e3a8a', dash: '',    width: 2.5 },  // 深蓝
  { kind: 'address', label: '地址 / PC',    color: '#0891b2', dash: '',    width: 2.5 },  // 青
  { kind: 'imm',     label: '立即数 / 常量', color: '#b8860b', dash: '',    width: 2.5 },  // 金黄（暗金）
  { kind: 'control', label: '控制信号',     color: '#047857', dash: '6 4', width: 2.0 },  // 翠绿
  { kind: 'clock',   label: '时钟 / 复位',  color: '#a855f7', dash: '',    width: 2.5 },  // 紫
  { kind: 'trap',    label: '异常 / 中断',  color: '#be123c', dash: '',    width: 3.0 },  // 赤红
]

const BY_KIND: Record<string, WireKindSpec> = {}
for (const k of WIRE_KINDS) BY_KIND[k.kind] = k

/** 取某一类线的规格。kind 缺失或不认识时回落到 data —— 拼错的 kind 会静默变蓝，
 *  所以 tools/_palette_check.mjs 里有一条断言专门抓 JSON 里的非法 kind。 */
export function wireSpec(kind?: string): WireKindSpec {
  return BY_KIND[kind || 'data'] || BY_KIND.data
}

export function wireColor(kind?: string): string {
  return wireSpec(kind).color
}

/** 类别 → 中文名。找不到就原样返回，好让 tooltip 至少显示个东西而不是空白。 */
export function wireKindLabel(kind?: string): string {
  return BY_KIND[kind || ''] ? BY_KIND[kind as string].label : kind || ''
}

/**
 * 网络标签（同名即同网的那些方框）属于哪一类。
 *
 * 全图 134 个端口里 26 个没有 wire 对象、靠 net 名字连接，trap 子系统正是
 * 这样表达的。不给它们上色的话，图例上的红色就成了一个**死条目** ——
 * 只有 1 条线是红的，而 trap 那一整套信号全是标签。所以这里补上映射，
 * 新增 wire 0 条，不碰 check_layout.py 的任何几何断言。
 */
const NET_KIND: Record<string, WireKind> = {
  pc: 'address',
  'pc+4': 'address',
  csr_addr: 'address',
  src1_rdata: 'data',
  csr_old: 'data',
  csr_we: 'control',
  is_csr: 'control',
  is_mret: 'control',
  illegal: 'trap',
  ecall: 'trap',
  ebreak: 'trap',
  trap_taken: 'trap',
  mtvec: 'trap',
  mepc: 'trap',
}

/** 网络标签用哪一类色。表里没有的网络按 data 画。 */
export function netKind(net?: string): string {
  return (net && NET_KIND[net]) || 'data'
}

/**
 * 高亮态的两个颜色。datapath.css 里的 g.module.dp-lit / dp-trap-lit 用的是
 * 这两个值，而 CSS 里**不能**引用 TS，所以由 tools/_palette_check.mjs 反过来
 * 断言「CSS 里的 --dp-hl-* 等于这里的值」，防两边分家。
 *
 * 注意 trap 的高亮色 #dc2626 与 trap 线的颜色 #be123c 差一档明度：前者是
 * 部件外框、粗；后者是线、细。故意不同，免得「这是线还是框」分不出来。
 */
export const HILITE = {
  module: '#2563eb',
  trap: '#dc2626',
}
