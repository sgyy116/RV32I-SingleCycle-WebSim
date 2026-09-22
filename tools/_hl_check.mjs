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

// 每条断言：{ 周期里的指令助记符, 必须包含的连线, 必须包含的网络 }
const EXPECT = [
  { dis: 'addi', wire: ['w_ctl_alusrc', 'w_dec_wen', 'w_wb_rf'], net: [] },
  { dis: 'sw',   wire: ['w_ctl_sw', 'w_rf_dmem', 'w_alu_dmem'], net: [] },
  { dis: 'lw',   wire: ['w_dmem_wb0', 'w_ctl_memtoreg', 'w_alu_dmem'], net: [] },
  { dis: 'beq',  wire: ['w_dec_branch', 'w_taken_m4', 'w_immadd_m4'], net: [] },
  { dis: 'jalr', wire: [], net: [] },
  { dis: 'jal',  wire: ['w_ctl_link', 'w_wb_rf', 'w_sel_m2', 'w_sel_m1'], net: [] },
  // csr_we 曾经漏在这一行外面，而它恰恰是当时唯一没亮的那个网络——
  // bin() 忘了切 "0b" 前缀，csrWe() 恒为 false。CSRRW 是无条件写，它必须亮。
  { dis: 'csrrw', wire: ['w_wb1_wb'], net: ['is_csr', 'csr_old', 'csr_addr', 'csr_we'] },
  { dis: 'mret',  wire: [], net: ['is_mret', 'mepc'] },
  { dis: '.word', wire: [], net: ['illegal', 'trap_taken', 'mtvec'] },
  { dis: 'ecall', wire: [], net: ['ecall', 'trap_taken'] },
]

let fails = 0
for (const st of states) {
  const h = computeHighlight(st.state, L)
  const dis = (st.state.disassembly || '').split(/\s+/)[0]
  const must = EXPECT.filter((e) => e.dis === dis)
  const marks = []
  for (const e of must) {
    for (const w of e.wire) {
      const ok = h.wires.has(w)
      if (!ok) { fails++; marks.push(`缺失连线 ${w}`) }
    }
    for (const n of e.net) {
      const ok = h.nets.has(n)
      if (!ok) { fails++; marks.push(`缺失网络 ${n}`) }
    }
    if (!marks.length) marks.push('断言通过')
  }

  const vals = [...h.values.entries()].map(([k, v]) => `${k}=${v}`).join(' ')
  console.log(
    `#${String(st.cycle).padStart(2)} ${String(st.state.pc)} ${String(st.state.disassembly).padEnd(24)} ` +
    `亮线 ${String(h.wires.size).padStart(2)} 网络[${[...h.nets].join(',') || '-'}] ` +
    `部件 ${String(h.modules.size).padStart(2)}${h.trapActive ? '  ★TRAP' : ''}`,
  )
  if (vals) console.log(`      值: ${vals}`)
  if (marks.length && must.length) console.log(`      ${marks.join('；')}`)
}

console.log('')
console.log(`共 ${states.length} 个周期，断言失败 ${fails} 处`)
process.exit(fails ? 1 : 0)
