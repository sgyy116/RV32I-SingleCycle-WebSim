// ============================================================================
// _wave_check.mjs —— 离线验证「信号逐波传播」的波次划分对不对
//
// 波次是纯前端算的（datapathWave.ts），页面上只能靠肉眼看流动快慢，看不出
// 「PC 是不是真比 ALU 早」这种结构性错误。这个脚本把每个周期的 WavePlan
// 摊开，逐条断言。
//
// 最重要的一条在最后：**sliceHighlight(hl, plan, plan.count) 必须与原始 hl
// 的 wires/modules/nets 完全相等**。它证明动画只是把同一份高亮切片，播到底 =
// 原来的静态高亮，既没丢也没多。这条一过，语义就没被动过，剩下的都是观感问题。
//
// 用法：node tools/_wave_check.mjs tools/out/_hl_states.jsonl
//       （缺省就用 tools/out/_hl_states.jsonl）
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { computeHighlight, WIRE_SIGNAL } from '../frontend/src/data/datapathHighlight.ts'
import {
  ALWAYS_LIT, ANNOTATION_NETS, NET_LINK,
  computeWaves, sliceHighlight, moduleFrame,
} from '../frontend/src/data/datapathWave.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const L = JSON.parse(fs.readFileSync(path.join(root, 'frontend/src/data/datapathLayout.json'), 'utf8'))

const src = process.argv[2] || path.join(here, 'out', '_hl_states.jsonl')
const lines = fs.readFileSync(src, 'utf8').split('\n').filter((l) => l.trim().startsWith('{'))
const states = lines.map((l) => JSON.parse(l)).filter((m) => m.type === 'cycle_state')

let fails = 0
const bad = (msg) => { fails++; console.log(`      ✗ ${msg}`) }

// 「时钟沿切开的写端口」（与 datapathWave.ts 的 SINK 表同名）。
// 落到这些端口上的信号属于**本周期末**，它的帧取「它到达的那一波」，与同模块输出线的帧
// 没有大小关系——写回/PC 更新发生在最后，这件事线级帧表达不了（详见下面那段说明）。
// 在测试里手抄一份期望值是有意的：下面有存在性自检兜住改名。
const SINK_PORTS = new Set([
  'PC.pc_next',
  'regfile.wdata', 'regfile.wen', 'regfile.waddr',
  'dmem.d', 'dmem.we',
  'csr.wdata_in', 'csr.we_in',
])

// 载波：一根线，或一条网络引线（NET_LINK 里那些没画成 wire 的真实连接）。
// 两者在波次模型里是同一回事，只是帧查的表不同。
const CARRIERS = [
  ...L.wires.map((w) => ({ id: w.id, from: w.from, to: w.to, net: false })),
  ...Object.entries(NET_LINK).map(([n, [a, b]]) => ({ id: n, from: a, to: b, net: true })),
]
const moduleOfPort = (p) => p.slice(0, p.lastIndexOf('.'))

// 进入某模块的载波（汇端口不是时钟沿写端口）／离开某模块的载波
const IN_AT = new Map()
const OUT_AT = new Map()
const pushTo = (m, k, v) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]) }
for (const c of CARRIERS) {
  if (!SINK_PORTS.has(c.to)) pushTo(IN_AT, moduleOfPort(c.to), c)
  pushTo(OUT_AT, moduleOfPort(c.from), c)
}

const carrierFrame = (plan, c) => (c.net ? plan.frameOfNet.get(c.id) : plan.frameOfWire.get(c.id))
const CARRIER_BY_ID = new Map(CARRIERS.map((c) => [c.id, c]))

/**
 * 顺序不变量的全部违例（见下面那段说明）。
 * 抽成函数是为了能对它做**变异自检**：把某根线的帧改成和它下游相等，它必须报出来
 * ——否则这条不变量就是空转的，和「实现错 + 断言恒真」是同一个病。
 * 返回 { violations: string[], pairs: number }，pairs 是实际比过的载波对数。
 */
function chainViolations(plan) {
  const violations = []
  let pairs = 0
  for (const [m, ins] of IN_AT) {
    const outs = OUT_AT.get(m)
    if (!outs) continue
    for (const x of ins) {
      const fx = carrierFrame(plan, x)
      if (fx === undefined) continue
      for (const y of outs) {
        if (y.id === x.id) continue          // 同一根载波不可能既进又出
        const fy = carrierFrame(plan, y)
        if (fy === undefined) continue
        pairs++
        if (fx < fy) continue
        violations.push(`${m}：进来的 ${x.id}=${fx} 不早于出去的 ${y.id}=${fy}`)
      }
    }
  }
  return { violations, pairs }
}

let chainPairs = 0        // 全周期累计比过的载波对数

/**
 * 变异自检：这条顺序不变量真的在判事，还是恒真？
 *
 * 针对性很强——它防的正是本项目反复出现的那个病：**实现错 + 断言恒真长期共存**
 * （AUIPC 是标本；dmem / csr / taken 三次恒亮 bug 也是同一形态）。
 * 「每个周期都 0 违例」既可能是真没违例，也可能是这个循环压根没比过任何一对
 * （第一版就是这么栽的：链接判定写错，比过 0 对，却一路显示全过）。
 *
 * 所以这里不只查「有没有比过」，而是**逐跳验证 CHAIN_DOC 里那三条链**：
 * 对每个周期、每一跳 (a → b)，只要两根载波这一拍都亮着（就是被比过），
 * 就把 a 的帧强行抬到与 b 相等，要求它被精确报出来。
 * 返回 { ok, note, hops }，hops 是实际做过变异的跳数。
 */
function mutationSelfCheck() {
  const hops = []
  for (const chain of CHAIN_DOC) {
    for (let i = 0; i + 1 < chain.length; i++) hops.push([chain[i], chain[i + 1]])
  }
  let done = 0
  for (const st of states) {
    const hl = computeHighlight(st.state, L)
    const plan = computeWaves(hl, L)
    if (chainViolations(plan).violations.length) continue   // 本来就不干净的周期，自检结论不可信
    for (const [a, b] of hops) {
      const x = CARRIER_BY_ID.get(a)
      const y = CARRIER_BY_ID.get(b)
      const fx = x && carrierFrame(plan, x)
      const fy = y && carrierFrame(plan, y)
      if (fx === undefined || fy === undefined || !x || !y) continue   // 这一拍这条链没走
      const m = moduleOfPort(x.to)
      const mutated = { ...plan }
      if (x.net) {
        mutated.frameOfNet = new Map(plan.frameOfNet)
        mutated.frameOfNet.set(a, fy)
      } else {
        mutated.frameOfWire = new Map(plan.frameOfWire)
        mutated.frameOfWire.set(a, fy)
      }
      const want = `${m}：进来的 ${a}=${fy} 不早于出去的 ${b}=${fy}`
      if (!chainViolations(mutated).violations.includes(want)) {
        return { ok: false, hops: done,
                 note: `第 ${st.cycle} 周期链 ${a} → ${b}：把 ${a} 的帧抬到 ${fy} 后没被报出来` }
      }
      done++
    }
  }
  if (!done) {
    return { ok: false, hops: 0, note: 'CHAIN_DOC 里三跳一条都没在夹具里同时亮过——链条是纸面的' }
  }
  return { ok: true, hops: done, note: `CHAIN_DOC 三条链共 ${done} 处跳变，逐处变异全部被捕获` }
}

// ---------------------------------------------------------------- 静态自检
// 1) 布局里所有「两个以上端口」的网络，要么在 NET_LINK 里，要么是注解网络。
//    漏一个就等于图上少一整块连通性，而且不会有任何报错——只能靠这条拦住。
{
  const cnt = {}
  for (const p of L.ports) if (p.net) cnt[p.net] = (cnt[p.net] || 0) + 1
  const multi = Object.keys(cnt).filter((n) => cnt[n] >= 2)
  const unlisted = multi.filter((n) => !NET_LINK[n] && !ANNOTATION_NETS.includes(n))
  const missing = Object.keys(NET_LINK).filter((n) => !multi.includes(n))
  console.log(`网络自检：多端口网络 ${multi.length} 个，NET_LINK ${Object.keys(NET_LINK).length} 条，` +
              `注解 ${ANNOTATION_NETS.length} 个`)
  for (const n of unlisted) bad(`网络 ${n} 有 ${cnt[n]} 个端口却没登记（图会被算断）`)
  for (const n of missing) bad(`NET_LINK 里的 ${n} 在布局上不是多端口网络`)
}

// 2) NET_LINK 两端的端口必须在布局里真实存在（端口名打错就等于没连）
{
  const known = new Set(L.ports.map((p) => p.id))
  for (const [net, [a, b]] of Object.entries(NET_LINK)) {
    if (!known.has(a)) bad(`NET_LINK[${net}] 的源端口 ${a} 在布局里不存在`)
    if (!known.has(b)) bad(`NET_LINK[${net}] 的汇端口 ${b} 在布局里不存在`)
    // 方向自检：驱动端名字里带 _out / taken_out，受驱端不该带 _out
    if (!/_out$/.test(a)) bad(`NET_LINK[${net}] 的源端口 ${a} 名字不像驱动端（不以 _out 结尾）`)
    if (/_out$/.test(b)) bad(`NET_LINK[${net}] 的汇端口 ${b} 名字像驱动端，方向可能反了`)
  }
}

// 3) 布局里的每条线都必须在 WIRE_SIGNAL 里登记。
//    没登记的会落到 DEFAULT_WIRE_SIGNAL = 恒亮。而「恒亮」正是 csr_we / dmem /
//    csr / taken 四次高亮 bug 的共同形态——新加的线绝不能悄悄掉进这条默认分支，
//    所以这里要求两边**集合相等**（多了也报，防止改名后留死条目）。
{
  const layoutIds = new Set(L.wires.map((w) => w.id))
  const keys = Object.keys(WIRE_SIGNAL)
  console.log(`连线登记自检：布局 ${layoutIds.size} 条，WIRE_SIGNAL ${keys.length} 条`)
  for (const i of layoutIds) if (!(i in WIRE_SIGNAL)) bad(`布局里的线 ${i} 没登记（会走恒亮默认值）`)
  for (const i of keys) if (!layoutIds.has(i)) bad(`WIRE_SIGNAL 里的 ${i} 在布局里不存在`)
}

// ---------------------------------------------------------------- 逐周期断言
// 无条件成立的顺序：信号在这条路径上必然逐级传下去
const ORDER = [
  ['PC', 'imem'], ['PC', 'pc4adder'], ['imem', 'decoder'],
  ['decoder', 'regfile'], ['decoder', 'alu'], ['decoder', 'csr'],
  ['regfile', 'alu'],
]

// ---- 顺序断言为什么只能这么写（这一节踩过坑，写清楚免得下次又写错）
//
// 模块帧 = 模块「组合节点」的深度（datapathWave.ts 第 3 步）。两个模块的帧之间**只有
// 当连接它们的那根线本周期亮着时**才有大小关系——线不亮就不建边，两个节点各走各的路径，
// 帧完全可以反过来。
//
// 具体反例（实测，别照着重犯）：
//   · csrrw 那拍 wbmux0=7 而 wbmux1=4：wbmux1 的 sel 是 is_csr=1，选中的是注解网络
//     csr_old，所以 w_wb0_wb 那根线灭了，两级之间没有边。
//   · 模块级写 ['pcmux5','PC'] 或 ['wbmux','regfile'] 更是错的期望：PC 的帧来自它自己
//     （pc_next 是时钟沿切开的幻影节点 #in，不进模块帧），regfile 的帧来自读口——
//     这两个模块本来就在第 0~2 波就亮了，「早就在被读」。写回/PC 更新发生在最后，
//     这件事模块帧**表达不了**。
//
// 所以顺序断言的正确形式是**载波级**的：不问「哪个部件先亮」，只问「信号在线上有没有
// 逐级往下走」。原来这里只有 7 对写死的模块对，ALU 操作数链、写回链、PC 链的内部次序
// 无人管——下面这条不变量把三条链一起覆盖了：
//
//   ★ 若载波 X 落到模块 M 的某个（非时钟沿写）端口上，载波 Y 从 M 出去，
//     则 frame(X) < frame(Y)。
//
// 即「信号进了这个部件，出来的信号不可能比它早」。它覆盖的三条链
// （写在这里当文档，机制是上面那一条）：
//   ALU 操作数：w_rf_ma0 → w_muxa0_muxa → w_ma_alu；w_rf_mb1 → w_mb_alu
//   写回：      w_alu_wb0 → w_wb0_wb → w_wb1_wb → w_wb_rf（→ 落在 regfile.wdata 上）
//   PC：        w_alu_jalr → w_jalr_m3 → w_m3_m2 → w_m2_m1 → w_m1_m6 → w_m6_m5 → w_m5_pc
//
// 「写回链的最后一跳 w_wb1_wb < w_wb_rf」正是模块帧表达不了的那一段：regfile 的帧来自
// 它的读口，很早就在亮；写回晚在最后一波，只有线级帧说得清。PC 链同理。
//
// 诚实标注：这条不变量对当前的分层算法是**结构性成立**的（最长路径分层保证每条边两端
// 深度至少差 1），所以它抓不到「分层算法想错了」，只能抓「分层被改坏」——比如有人给汇点
// 开例外、或 ALWAYS_LIT 的跳过被去掉。它是**回归护栏**，不是独立验证。
const CHAIN_DOC = [
  ['w_rf_ma0', 'w_muxa0_muxa', 'w_ma_alu'],
  ['w_rf_mb1', 'w_mb_alu'],
  ['w_alu_wb0', 'w_wb0_wb', 'w_wb1_wb', 'w_wb_rf'],
  ['w_alu_jalr', 'w_jalr_m3', 'w_m3_m2', 'w_m2_m1', 'w_m1_m6', 'w_m6_m5', 'w_m5_pc'],
]
// 写回多路器选哪一路，就要由哪一路驱动。不能无条件要求 alu 早于 wbmux——
// jal 的写回是 PC+4、csrrw 的写回是 CSR，这两条根本不经过 ALU。
const WB_SRC = { ALU: 'alu', MEM: 'dmem', CSR: 'csr', PC_PLUS_4: 'pc4adder' }
const MEM_DIS = /^(lw|lh|lb|lhu|lbu|sw|sh|sb)$/

// 模块级自检：CHAIN_DOC 里写的每根线都得在布局里真实存在，
// 否则改名之后这段「文档」会悄悄变成空话（顺序检查一处都不跑，还显示全过）。
{
  const ids = new Set(L.wires.map((w) => w.id))
  for (const chain of CHAIN_DOC) {
    for (const id of chain) if (!ids.has(id)) bad(`CHAIN_DOC 里的线 ${id} 在布局里不存在（顺序检查已失效）`)
    // 相邻两跳必须真的接得上：前一跳到这个模块，后一跳从这个模块出去。
    // 接不上就说明链条写错了，而「比过 0 对」的下场上面已经演示过一次。
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = CARRIER_BY_ID.get(chain[i])
      const b = CARRIER_BY_ID.get(chain[i + 1])
      if (!a || !b) continue
      if (moduleOfPort(a.to) !== moduleOfPort(b.from)) {
        bad(`CHAIN_DOC 的 ${chain[i]} → ${chain[i + 1]} 接不上：` +
            `${a.to} 与 ${b.from} 不在同一个模块`)
      }
    }
  }
  // SINK_PORTS 同理：抄错一个端口名 = 少豁免一处，会冒出一堆假失败；
  // 反过来把不该豁免的端口写进来，就会悄悄放过一条真违例。两个方向都拦住。
  const ports = new Map(L.ports.map((p) => [p.id, p]))
  const sourced = new Set(L.wires.map((w) => w.from))
  for (const id of SINK_PORTS) {
    const p = ports.get(id)
    if (!p) bad(`SINK_PORTS 里的 ${id} 在布局里不存在（豁免已失效）`)
    else if (sourced.has(id)) bad(`SINK_PORTS 里的 ${id} 有连线从它出发，它不可能是时钟沿写端口`)
  }
}

console.log('')
for (const st of states) {
  const hl = computeHighlight(st.state, L)
  const plan = computeWaves(hl, L)
  const dis = (st.state.disassembly || '').split(/\s+/)[0]

  // 每波里都有东西
  const perWave = Array.from({ length: plan.count }, () => [])
  for (const [m, f] of plan.frameOfModule) perWave[f]?.push(m)
  for (const [, f] of plan.frameOfWire) perWave[f]?.push('·')
  for (const [, f] of plan.frameOfNet) perWave[f]?.push('~')
  const empty = perWave.map((a, i) => (a.length ? null : i)).filter((i) => i !== null)

  const lit = (id) => { const f = moduleFrame(plan, id); return f < 0 ? null : f }

  console.log(
    `#${String(st.cycle).padStart(2)} ${String(dis).padEnd(8)} ` +
    `波数 ${String(plan.count).padStart(2)}  模块 ${String(plan.frameOfModule.size).padStart(2)}  ` +
    `线 ${String(plan.frameOfWire.size).padStart(2)}  网络 ${plan.frameOfNet.size}` +
    `${hl.trapActive ? '  ★TRAP' : ''}`,
  )
  console.log('      ' + perWave.map((a, i) =>
    `${i}:${a.length ? a.filter((x) => x !== '·' && x !== '~').join('/') || a.length + '条线' : '空'}`,
  ).join('  '))

  if (plan.count === 0) { bad(`第 ${st.cycle} 周期波数为 0（有高亮却分不出波）`) ; continue }
  for (const i of empty) bad(`第 ${st.cycle} 周期第 ${i} 波是空的`)
  if (plan.count > 24) bad(`第 ${st.cycle} 周期波数 ${plan.count} 异常大（可能有环没断开）`)

  // 物理顺序
  const before = (a, b, why) => {
    const fa = lit(a), fb = lit(b)
    if (fa === null || fb === null) return
    if (fa >= fb) bad(`第 ${st.cycle} 周期（${dis}）顺序不对：${a}=${fa} 不早于 ${b}=${fb}（${why}）`)
  }
  for (const [a, b] of ORDER) before(a, b, '固定通路')

  // ★ 顺序不变量：信号进了这个部件，出来的不可能比它早（见上面那段说明）
  const cv = chainViolations(plan)
  chainPairs += cv.pairs
  for (const v of cv.violations) bad(`第 ${st.cycle} 周期（${dis}）顺序不对：${v}`)

  // 写回值必须来自它该来的那个部件，且早于写回
  const src = st.state.writeback?.active ? st.state.writeback.source : null
  if (src && WB_SRC[src]) before(WB_SRC[src], 'wbmux', `写回来源是 ${src}`)
  else if (src) bad(`第 ${st.cycle} 周期未知的写回来源 ${src}`)

  // 访存部件不该在非访存指令上占波次
  const fd = lit('dmem')
  if (fd !== null && !MEM_DIS.test(dis)) {
    bad(`第 ${st.cycle} 周期（${dis}）dmem 不该有波次 ${fd}`)
  }
  if (MEM_DIS.test(dis) && fd === null) bad(`第 ${st.cycle} 周期（${dis}）是访存指令但 dmem 没有波次`)

  // 更硬的一条：dmem 被点亮 ⟺ 这条指令真的访存。
  // 曾经它被时钟线 w_clk_dmem 无条件点亮，每条指令都亮着，
  // 靠 computeHighlight 里「电源线不点亮受驱端」修掉。这条守住它别回来。
  const dmemLit = hl.modules.has('dmem')
  if (dmemLit !== MEM_DIS.test(dis)) {
    bad(`第 ${st.cycle} 周期（${dis}）dmem ${dmemLit ? '被点亮' : '没被点亮'}，`
      + `但这条指令${MEM_DIS.test(dis) ? '是' : '不是'}访存指令`)
  }

  // trapunit 只在 trap 周期占波次
  const ft = lit('trapunit')
  if (ft !== null && !hl.trapActive) bad(`第 ${st.cycle} 周期（${dis}）trapunit 不该有波次 ${ft}`)

  // ---- taken（分支成立判断）
  // 这一组是补的：dmem / csr / trapunit 都写了反向断言，唯独 taken 一条都没有，
  // 于是「w_alu_zf 写成 active: () => true」这个恒亮 bug 一直没人发现——
  // 它拖着 taken 单元在每条指令上点亮（addi 也亮），而所有断言都是「必须包含」，
  // 抓不到「不该亮却亮了」。下面几条专治这个方向。
  const BR_DIS = /^(beq|bne|blt|bge|bltu|bgeu)$/
  const isBr = BR_DIS.test(dis)
  // taken 靠 funct3 的两位把六条分支判完：
  //   funct3[2] = 0（beq/bne，000/001）→ 取 ZF；= 1（blt/bge/bltu/bgeu）→ 取 LT
  //   funct3[0] 只选极性（正/反），funct3[1] 只决定 alu_op 是 SLT 还是 SLTU
  // —— 后两位都不该改变「哪根标志线通」，所以这里只看 funct3[2]。
  const fs = String(st.state.instruction_fields?.funct3 ?? '').replace(/^0b/, '')
  const f3n = Number.isNaN(parseInt(fs, 2)) ? 0 : parseInt(fs, 2)
  const wantZf = isBr && (f3n & 0b100) === 0
  const wantLt = isBr && (f3n & 0b100) !== 0
  const zfLit = hl.wires.has('w_alu_zf')
  if (zfLit !== wantZf) {
    bad(`第 ${st.cycle} 周期（${dis} f3=0b${fs}）w_alu_zf ${zfLit ? '被点亮' : '没被点亮'}，`
      + `应当是${wantZf ? '亮' : '灭'}的（只有 beq/bne 取 ZF）`)
  }
  const ltLit = hl.wires.has('w_alu_lt')
  if (ltLit !== wantLt) {
    bad(`第 ${st.cycle} 周期（${dis} f3=0b${fs}）w_alu_lt ${ltLit ? '被点亮' : '没被点亮'}，`
      + `应当是${wantLt ? '亮' : '灭'}的（只有 blt/bge/bltu/bgeu 取 LT）`)
  }
  // taken 单元：它的六条相邻线全都以 branch 为门（其中 w_dec_branch 在每条分支上都亮），
  // 所以「被点亮」与「是分支指令」等价，两个方向都要成立。
  const tkLit = hl.modules.has('taken')
  if (tkLit !== isBr) {
    bad(`第 ${st.cycle} 周期（${dis}）taken 部件${tkLit ? '被点亮' : '没被点亮'}，`
      + `但这条指令${isBr ? '是' : '不是'}分支指令`)
  }

  // ---- MUX 互斥（点亮契约：每个 MUX 只点亮它本周期选中的那一路数据输入）
  // 这是当前零覆盖、教学上最致命的一类错：把一个 MUX 的两条输入写反
  // （原先 w_immadd_m3 = is_jalr 就是接反的），只看「亮了什么」永远发现不了。
  // 期望值直接从 control_signals / branch 算，不 import 前端那几个派生函数
  // ——否则就是拿被测实现去验证被测实现。
  const cs = st.state.control_signals
  const svJalr = cs.is_jalr
  const svJump = cs.jump || cs.is_jalr          // pcmux2 的 sel：jump || is_jalr
  const svPc = cs.branch || svJump              // pcmux1 的 sel：branch || jump || is_jalr
  const svBt = cs.branch && st.state.branch.taken === true   // pcmux4 的 sel：taken（只在分支里成立）
  const MUX_DATA = [
    ['muxa0', 'w_rf_ma0', 'w_imm_muxa0', !cs.is_lui],
    ['muxb', 'w_rf_mb1', 'w_imm_muxb', !cs.alu_src],
    ['wbmux0', 'w_alu_wb0', 'w_dmem_wb0', !cs.mem_to_reg],
    ['pcmux1', 'w_m2_m1', 'w_add4_m1', svPc],
    ['pcmux2', 'w_m3_m2', 'w_m4_m2', svJump],
    ['pcmux3', 'w_jalr_m3', 'w_immadd_m3', svJalr],
    ['pcmux4', 'w_immadd_m4', 'w_add4_m4', svBt],
  ]
  for (const [mux, w1, w0, one] of MUX_DATA) {
    if (hl.wires.has(w1) !== one || hl.wires.has(w0) === one) {
      bad(`第 ${st.cycle} 周期（${dis}）${mux} 选中的是 ${one ? w1 : w0}（sel=${one ? 1 : 0}），`
        + `实际 ${w1}=${hl.wires.has(w1) ? '亮' : '灭'} / ${w0}=${hl.wires.has(w0) ? '亮' : '灭'}`)
    }
  }
  // taken 的输出线跟着 taken 走（它进 pcmux4 的选择端，1 = 选 pc+imm）
  if (hl.wires.has('w_taken_m4') !== svBt) {
    bad(`第 ${st.cycle} 周期（${dis}）w_taken_m4 ${hl.wires.has('w_taken_m4') ? '被点亮' : '没被点亮'}，`
      + `应当与 taken 一致（branch && branch.taken）`)
  }
  // ---- 中断/异常那两级 MUX（pcmux6 选 mepc，pcmux5 选 mtvec）
  // 它们的 1 口是挂在端口上的**注解网络**（mepc / mtvec），不是线，因此只能断言
  // 线这一侧的 0 口：mret 时 PC 直接取 mepc，w_m1_m6 必须灭；中断时取 mtvec，
  // w_m6_m5 必须灭。mret 的编码是一个固定 32 位字（rv_disasm.cpp:192-197 的四条
  // 判据合起来就是整字相等），这里直接比整字，不重抄那四条。
  const isMret = String(st.state.instruction).toLowerCase() === '0x30200073'
  if (hl.wires.has('w_m1_m6') !== !isMret) {
    bad(`第 ${st.cycle} 周期（${dis}）w_m1_m6 ${hl.wires.has('w_m1_m6') ? '被点亮' : '没被点亮'}，`
      + `应当${isMret ? '灭（mret 的 PC 取 mepc，不走 pcmux1）' : '亮'}`)
  }
  if (hl.wires.has('w_m6_m5') !== !st.state.trap.taken) {
    bad(`第 ${st.cycle} 周期（${dis}）w_m6_m5 ${hl.wires.has('w_m6_m5') ? '被点亮' : '没被点亮'}，`
      + `应当${st.state.trap.taken ? '灭（trap 的 PC 取 mtvec）' : '亮'}`)
  }

  // ---- CSR 相关的网络与部件
  // 这四条刻意**不重抄后端那张 do_write 表**，只挑几件能独立成立、不靠同一份判据的事实。
  // 尤其是「本该亮却没亮」这一类——上面所有断言都是「必须包含」，只有这类能抓住。
  const CSR_REG = /^(csrrw|csrrs|csrrc)$/
  const CSR_IMM = /^(csrrwi|csrrsi|csrrci)$/
  const SYS_OP = /^(ecall|ebreak|mret|csrrw|csrrs|csrrc|csrrwi|csrrsi|csrrci)$/
  const s1 = hl.nets.has('src1_rdata')
  const we = hl.nets.has('csr_we')

  // 1) csrrw / csrrwi 是无条件写（rv_core.cpp:407 和 :410 的 case 里 do_write = true，不看源操作数）。
  //    这条最值钱：bin() 忘了切 "0b" 前缀时 csrWe() 恒为 false、csr_we 从来没亮过，
  //    而当时没有任何断言会发现——因为「没亮」不在任何「必须包含」的清单里。
  if (/^(csrrw|csrrwi)$/.test(dis) && !we) {
    bad(`第 ${st.cycle} 周期（${dis}）csr_we 没亮，但这两条指令无条件写 CSR`)
  }
  // 2) 立即数版压根不读寄存器堆（src 取 rs1 字段本身，rv_core.cpp:404），
  //    src1_rdata 是「寄存器读出的数据」，不该亮
  if (CSR_IMM.test(dis) && s1) {
    bad(`第 ${st.cycle} 周期（${dis}）src1_rdata 亮了，但立即数版不经过寄存器堆`)
  }
  // 3) 非系统指令不该点亮 CSR 寄存器组。
  //    曾经 src1_rdata 写成恒亮，它挂在 csr.wdata_in 上，把 csr 拖成**每条指令都亮**，
  //    跟 dmem 被时钟线 w_clk_dmem 点亮是同一类病。
  if (dis && !SYS_OP.test(dis) && !hl.trapActive && hl.modules.has('csr')) {
    bad(`第 ${st.cycle} 周期（${dis}）csr 部件被点亮，但它不碰 CSR`)
  }
  // 4) 反过来：src1_rdata 只属于寄存器版 CSR 指令
  if (dis && !CSR_REG.test(dis) && s1) {
    bad(`第 ${st.cycle} 周期（${dis}）src1_rdata 亮了，但它不是寄存器版 CSR 指令`)
  }

  // ★ 回归护栏：播到底必须等于原来的静态高亮，一个不多一个不少
  const full = sliceHighlight(hl, plan, plan.count)
  const diff = (name, a, b) => {
    const miss = [...a].filter((x) => !b.has(x))
    const extra = [...b].filter((x) => !a.has(x))
    if (miss.length) bad(`第 ${st.cycle} 周期播到底后丢了 ${name}：${miss.join(',')}`)
    if (extra.length) bad(`第 ${st.cycle} 周期播到底后多了 ${name}：${extra.join(',')}`)
  }
  diff('连线', hl.wires, full.wires)
  diff('部件', hl.modules, full.modules)
  diff('网络', hl.nets, full.nets)
  if (hl.trapActive !== full.trapActive) bad(`第 ${st.cycle} 周期播到底后 trapActive 变了`)
}

// ---------------------------------------------------------------- 汇总
const alwayNoFrame = new Set()
for (const st of states) {
  const hl = computeHighlight(st.state, L)
  const plan = computeWaves(hl, L)
  for (const m of hl.modules) {
    if (!ALWAYS_LIT.has(m) && !plan.frameOfModule.has(m)) alwayNoFrame.add(m)
  }
}

console.log('')
if (alwayNoFrame.size) {
  console.log(`算不出波次、按常亮处理的部件（与改造前观感一致）：${[...alwayNoFrame].join(', ')}`)
}
console.log(`顺序不变量：共比过 ${chainPairs} 对「进入某部件的载波 → 离开该部件的载波」`)
if (chainPairs === 0) bad('顺序不变量一对都没比过（断言形同虚设）')

const sc = mutationSelfCheck()
console.log(`顺序不变量变异自检：${sc.note}`)
if (!sc.ok) bad(sc.note)

console.log(`共 ${states.length} 个周期，断言失败 ${fails} 处`)
process.exit(fails ? 1 : 0)
