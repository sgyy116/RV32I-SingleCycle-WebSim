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

import { computeHighlight } from '../frontend/src/data/datapathHighlight.ts'
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

// ---------------------------------------------------------------- 逐周期断言
// 无条件成立的顺序：信号在这条路径上必然逐级传下去
const ORDER = [
  ['PC', 'imem'], ['PC', 'pc4adder'], ['imem', 'decoder'],
  ['decoder', 'regfile'], ['decoder', 'alu'], ['decoder', 'csr'],
  ['regfile', 'alu'],
]
// 写回多路器选哪一路，就要由哪一路驱动。不能无条件要求 alu 早于 wbmux——
// jal 的写回是 PC+4、csrrw 的写回是 CSR，这两条根本不经过 ALU。
const WB_SRC = { ALU: 'alu', MEM: 'dmem', CSR: 'csr', PC_PLUS_4: 'pc4adder' }
const MEM_DIS = /^(lw|lh|lb|lhu|lbu|sw|sh|sb)$/

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
console.log(`共 ${states.length} 个周期，断言失败 ${fails} 处`)
process.exit(fails ? 1 : 0)
