// ============================================================================
// _hl_check.mjs —— 离线验证高亮是不是真按后端状态走
//
// 读一个 cycle_state 流（每行一个 JSON，由 rv32i_sim.exe 逐周期吐出），
// 对每个周期跑一遍 computeHighlight()，打印激活的连线/网络/部件。
//
// 这是唯一能证明「图上亮的线跟后端一致」的手段——几何自检管不到高亮。
//
// 用法：node tools/_hl_check.mjs tools/out/_hl_states.jsonl
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { computeHighlight } from '../frontend/src/data/datapathHighlight.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const L = JSON.parse(fs.readFileSync(path.join(root, 'frontend/src/data/datapathLayout.json'), 'utf8'))

const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter((l) => l.trim().startsWith('{'))
const states = lines.map((l) => JSON.parse(l)).filter((m) => m.type === 'cycle_state')

// 每条断言 = { dis, when?, must: [...], mustNot: [...] }
//   dis     助记符，字符串精确匹配或 RegExp
//   when    可选，(state) => bool，把同一助记符的两种周期分开
//           （blt 跳成功 / 不跳，只写交集会漏掉一半信息）
//   must    必须亮的，mustNot 必须灭的；名字一律带前缀：
//           wire: 连线 / net: 网络 / mod: 部件
//
// mustNot 是补的：原表只有「必须包含」，于是抓不到「不该亮却亮了」这一类。
// csr_we 长期没亮（bin() 忘了切 "0b" 前缀）当年是靠 _wave_check.mjs 的反向断言
// 才发现的，这里补上同一方向；两边判据独立写，互为交叉验证。
const EXPECT = [
  // ---- 普通算术 / 访存 ----
  { dis: 'addi',
    must: ['wire:w_ctl_alusrc', 'wire:w_dec_wen', 'wire:w_wb_rf', 'wire:w_add4_m1'],
    mustNot: ['mod:taken', 'wire:w_alu_zf', 'wire:w_alu_lt', 'wire:w_m2_m1',
              'wire:w_immadd_m4', 'wire:w_taken_m4'] },
  { dis: 'sw',
    must: ['wire:w_ctl_sw', 'wire:w_rf_dmem', 'wire:w_alu_dmem'],
    mustNot: ['wire:w_dmem_wb0', 'wire:w_ctl_memtoreg'] },
  { dis: 'lw',
    must: ['wire:w_dmem_wb0', 'wire:w_ctl_memtoreg', 'wire:w_alu_dmem'],
    mustNot: ['wire:w_ctl_sw', 'wire:w_rf_dmem'] },
  // ---- lui / auipc：muxa0 与 muxa 两级选择 ----
  // lui：muxa0 选 imm（is_lui=1），muxa 的 sel 是 is_auipc=0 → 走 muxa0 那一路
  { dis: 'lui',
    must: ['wire:w_imm_muxa0', 'wire:w_ctl_islui', 'wire:w_muxa0_muxa'],
    mustNot: ['wire:w_rf_ma0', 'wire:w_ctl_auipc'] },
  // auipc：muxa0 选 rs1（is_lui=0），muxa 的 sel 是 is_auipc=1 → 走 pc 那一路
  { dis: 'auipc',
    must: ['wire:w_rf_ma0', 'wire:w_ctl_auipc'],
    mustNot: ['wire:w_imm_muxa0', 'wire:w_ctl_islui', 'wire:w_muxa0_muxa'] },

  // ---- 分支：六条全覆盖，每条都验「ZF/LT 哪根通」+「跳与不跳」----
  // funct3[2]=0（beq/bne）→ ZF 通、LT 灭；funct3[2]=1（其余四条）→ 反过来。
  // funct3[0] 只决定要不要取反，所以同一助记符的两个周期里标志线是一样的，
  // 只有 taken 及其下游不同。
  { dis: 'beq', when: (s) => s.branch.taken,
    must: ['wire:w_dec_branch', 'wire:w_alu_zf', 'wire:w_taken_m4', 'wire:w_immadd_m4',
           'mod:taken', 'wire:w_m2_m1'],
    mustNot: ['wire:w_alu_lt', 'wire:w_add4_m4', 'wire:w_add4_m1', 'wire:w_jalr_m3'] },
  // 注意：不跳的分支 pcSel 仍然是 1（pcSel = branch||jump||is_jalr，不含 taken），
  // 所以 w_m2_m1 照常亮、w_add4_m1 照常灭 —— pcmux1 选的是 pcmux2 那一路，
  // 而 pcmux2 选的是 pcmux4，pcmux4 的 sel 才由 taken 决定。
  { dis: 'beq', when: (s) => !s.branch.taken,
    must: ['wire:w_dec_branch', 'wire:w_alu_zf', 'wire:w_m2_m1', 'wire:w_add4_m4', 'mod:taken'],
    mustNot: ['wire:w_alu_lt', 'wire:w_taken_m4', 'wire:w_immadd_m4', 'wire:w_add4_m1'] },
  { dis: 'bne', when: (s) => s.branch.taken,
    must: ['wire:w_dec_branch', 'wire:w_alu_zf', 'wire:w_taken_m4', 'wire:w_immadd_m4'],
    mustNot: ['wire:w_alu_lt', 'wire:w_add4_m4'] },
  { dis: 'bne', when: (s) => !s.branch.taken,
    must: ['wire:w_dec_branch', 'wire:w_alu_zf', 'wire:w_add4_m4'],
    mustNot: ['wire:w_alu_lt', 'wire:w_taken_m4', 'wire:w_immadd_m4'] },
  // blt / bge / bltu / bgeu：四条合起来才是完整的极性表。
  // bltu 与 blt 在同一对操作数上结论相反，是 SLT / SLTU 有没有选错的唯一判据。
  { dis: /^(blt|bge|bltu|bgeu)$/, when: (s) => s.branch.taken,
    must: ['wire:w_dec_branch', 'wire:w_alu_lt', 'wire:w_taken_m4', 'wire:w_immadd_m4',
           'mod:taken'],
    mustNot: ['wire:w_alu_zf', 'wire:w_add4_m4'] },
  { dis: /^(blt|bge|bltu|bgeu)$/, when: (s) => !s.branch.taken,
    must: ['wire:w_dec_branch', 'wire:w_alu_lt', 'wire:w_m2_m1', 'wire:w_add4_m4', 'mod:taken'],
    mustNot: ['wire:w_alu_zf', 'wire:w_taken_m4', 'wire:w_immadd_m4', 'wire:w_add4_m1'] },

  // ---- 跳转：jal 走 pc+imm，jalr 走 &~1，两条路必须互斥 ----
  { dis: 'jal',
    must: ['wire:w_ctl_link', 'wire:w_wb_rf', 'wire:w_sel_m2', 'wire:w_sel_m1',
           'wire:w_immadd_m3', 'wire:w_m3_m2', 'wire:w_m2_m1'],
    mustNot: ['wire:w_jalr_m3', 'wire:w_alu_jalr', 'wire:w_add4_m1', 'mod:taken',
              'wire:w_immadd_m4', 'wire:w_alu_zf', 'wire:w_alu_lt'] },
  { dis: 'jalr',
    must: ['wire:w_jalr_m3', 'wire:w_alu_jalr', 'wire:w_sel_m3', 'wire:w_m3_m2',
           'wire:w_m2_m1', 'mod:jalrclean'],
    mustNot: ['wire:w_immadd_m3', 'wire:w_add4_m1', 'mod:taken', 'wire:w_alu_zf'] },

  // ---- CSR / 系统 ----
  // csr_we 曾经漏在这一行外面，而它恰恰是当时唯一没亮的那个网络——
  // bin() 忘了切 "0b" 前缀，csrWe() 恒为 false。CSRRW 是无条件写，它必须亮。
  // 写回侧分两条：wbmux1 的 sel 是 is_csr，选中的 1 口是 csr_old 这条**网络**
  // （布局上 wbmux1.wb1_1 挂 net，不是线），所以「选了 1 口」表现为
  // w_wb0_wb 灭 + csr_old 亮；w_alu_wb0 是下一级 wbmux0 的输入，按 mux-local
  // 规则它照常亮（mem_to_reg=0），别把它当成「不该亮」。
  { dis: 'csrrw',
    must: ['wire:w_wb1_wb', 'net:is_csr', 'net:csr_old', 'net:csr_addr', 'net:csr_we'],
    mustNot: ['wire:w_wb0_wb', 'net:illegal', 'net:ecall'] },
  // 写不写寄存器只由 rd 决定（rv_core.cpp:416 的 reg_write = rd != 0）。
  // csrrw x0, ... 是合法的「只写 CSR、不动寄存器堆」，图上「寄存器写使能」必须灭——
  // 这一条也是反向断言，抓的是「无条件点亮写使能」那种错。
  { dis: 'csrrw', when: (s) => s.writeback.reg_index !== 0,
    must: ['wire:w_dec_wen', 'wire:w_wb_rf', 'wire:w_dec_waddr'], mustNot: ['wire:w_wb0_wb'] },
  { dis: 'csrrw', when: (s) => s.writeback.reg_index === 0,
    must: ['net:csr_we'], mustNot: ['wire:w_dec_wen', 'wire:w_wb_rf'] },
  { dis: 'mret', must: ['net:is_mret', 'net:mepc'], mustNot: ['net:csr_we', 'net:illegal'] },
  { dis: '.word', must: ['net:illegal', 'net:trap_taken', 'net:mtvec'],
    mustNot: ['net:ecall', 'net:ebreak'] },
  { dis: 'ecall', must: ['net:ecall', 'net:trap_taken'],
    mustNot: ['net:illegal', 'net:ebreak', 'net:is_mret'] },
]

/** 按前缀查高亮结果。名字打错会当场抛，不会静默当成「没亮」。 */
const has = (h, name) => {
  const i = name.indexOf(':')
  const kind = name.slice(0, i)
  const id = name.slice(i + 1)
  if (kind === 'wire') return h.wires.has(id)
  if (kind === 'net') return h.nets.has(id)
  if (kind === 'mod') return h.modules.has(id)
  throw new Error(`断言名字必须带 wire: / net: / mod: 前缀，收到「${name}」`)
}

// 「本条断言一次都没匹配上」＝ 夹具缺口（不是通过）。原先 jalr 那条空断言
// 就是这么躺了很多轮：它长着一副「有覆盖」的样子，实际什么都没验。
const hitCount = new Array(EXPECT.length).fill(0)

let fails = 0
for (const st of states) {
  const h = computeHighlight(st.state, L)
  const dis = (st.state.disassembly || '').split(/\s+/)[0]
  const hits = EXPECT.map((e, i) => [e, i]).filter(([e]) =>
    (e.dis instanceof RegExp ? e.dis.test(dis) : e.dis === dis) && (!e.when || e.when(st.state)))
  const marks = []
  for (const [e, i] of hits) {
    hitCount[i]++
    for (const n of e.must) if (!has(h, n)) { fails++; marks.push(`该亮没亮 ${n}`) }
    for (const n of e.mustNot) if (has(h, n)) { fails++; marks.push(`不该亮却亮 ${n}`) }
  }

  const vals = [...h.values.entries()].map(([k, v]) => `${k}=${v}`).join(' ')
  console.log(
    `#${String(st.cycle).padStart(2)} ${String(st.state.pc)} ${String(st.state.disassembly).padEnd(24)} ` +
    `亮线 ${String(h.wires.size).padStart(2)} 网络[${[...h.nets].join(',') || '-'}] ` +
    `部件 ${String(h.modules.size).padStart(2)}${h.trapActive ? '  ★TRAP' : ''}`,
  )
  if (vals) console.log(`      值: ${vals}`)
  if (marks.length) console.log(`      ✗ ${marks.join('；')}`)
  else if (hits.length) console.log(`      ✓ ${hits.length} 条断言通过`)
}

console.log('')
const dead = EXPECT.map((e, i) => [e, i]).filter(([, i]) => !hitCount[i])
if (dead.length) {
  for (const [e] of dead) {
    console.log(`      ⚠ 断言没匹配到任何周期（等于没验）：${String(e.dis)}` +
                `${e.when ? ' + when' : ''}`)
  }
}
console.log(`共 ${states.length} 个周期，断言失败 ${fails} 处，` +
            `命中 ${hitCount.filter((c) => c > 0).length}/${EXPECT.length} 条断言`)
process.exit(fails ? 1 : 0)
