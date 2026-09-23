// ============================================================================
// _lang_check.mjs —— 前端高亮关键字表 ↔ asm.py 实际能力 的双向一致性校验
//
// 为什么需要它：asm.py 就是产品的编译器（没有 riscv-*-gcc，直接回退到它）。
// 但「哪些助记符算合法」这件事被抄成了两份：后端 asm.py 的 encode()，
// 前端 riscvLang.ts 的 MNEMONICS。两份表没有互相校验过，于是长期不一致——
// 前端高亮 nop/mv/li/ret/call 而后端一个都不支持，后端支持 mret 而前端不高亮。
// 学生看到的是：关键字染成合法色，点编译却报「不支持的助记符」。
//
// 这个脚本不重抄任何一张表：它**直接问 asm.py 能不能编**，再跟 MNEMONICS 对账。
//
// 用法：node tools/_lang_check.mjs
// 退出码：0 = 全过，1 = 有断言失败，3 = 跳过（前端 node_modules 不在，跑不了）
// ============================================================================

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

// riscvLang.ts 依赖 @codemirror/language，而交付包**故意不带** frontend/node_modules
// （2 万多个文件）。静态 import 在缺依赖时甩一段 ERR_MODULE_NOT_FOUND 堆栈就退出，
// check_all.py 于是把「环境没装」误报成「断言失败」。改成动态 import：
// 依赖不在就说明原因、以退出码 3 退出（3 = 跳过，check_all.py 认得）。
const SKIP = 3
let MNEMONICS, parser
try {
  ;({ MNEMONICS, parser } = await import('../frontend/src/utils/riscvLang.ts'))
} catch (e) {
  if (e && e.code === 'ERR_MODULE_NOT_FOUND') {
    console.log('  跳过：前端依赖未安装，读不到 riscvLang.ts。')
    console.log('        交付包故意不带 frontend/node_modules，装上再跑：cd frontend && npm install')
    process.exit(SKIP)
  }
  throw e
}

let fails = 0
const bad = (msg) => { fails++; console.log(`  ✗ ${msg}`) }

// ---------------------------------------------------------------- 词法驱动
// 自己搭一个最小的流对象，而不是 import CodeMirror 的 StringStream：
// tools/ 下没有 node_modules，裸包名解析不到；而 parser.token 只用到
// match / current / eol / next 四个方法，语义照 StringStream 抄即可
// （match 在匹配位置不在开头时返回 null，是 CM 的既有行为）。
function makeStream(str) {
  let pos = 0
  let start = 0
  return {
    get pos() { return pos },
    set pos(v) { pos = v },
    get start() { return start },
    set start(v) { start = v },
    eol: () => pos >= str.length,
    next() { pos++ },
    current: () => str.slice(start, pos),
    match(pat) {
      const m = str.slice(pos).match(pat)
      if (!m || m.index > 0) return null
      pos += m[0].length
      return m
    },
  }
}

/** 跑一遍 StreamParser，返回 [[词, 类型], ...]。 */
function tokenize(line) {
  const s = makeStream(line)
  const out = []
  while (!s.eol()) {
    s.start = s.pos
    const type = parser.token(s)
    if (s.pos === s.start) { s.next(); continue }   // 没前进就手动挪一格，防死循环
    out.push([line.slice(s.start, s.pos), type])
  }
  return out
}

// ---------------------------------------------------------------- 探针
// 每个助记符配一条最小的、必然能编过的语句；带标签的两行用 \n 分隔。
const PROBES = [
  'add a0, a1, a2', 'sub a0, a1, a2', 'sll a0, a1, a2', 'slt a0, a1, a2',
  'sltu a0, a1, a2', 'xor a0, a1, a2', 'srl a0, a1, a2', 'sra a0, a1, a2',
  'or a0, a1, a2', 'and a0, a1, a2',
  'addi a0, a1, 1', 'slti a0, a1, 1', 'sltiu a0, a1, 1', 'xori a0, a1, 1',
  'ori a0, a1, 1', 'andi a0, a1, 1', 'slli a0, a1, 1', 'srli a0, a1, 1', 'srai a0, a1, 1',
  'lb a0, 0(a1)', 'lh a0, 0(a1)', 'lw a0, 0(a1)', 'lbu a0, 0(a1)', 'lhu a0, 0(a1)',
  'sb a0, 0(a1)', 'sh a0, 0(a1)', 'sw a0, 0(a1)',
  'beq a0, a1, L\nL: ecall', 'bne a0, a1, L\nL: ecall', 'blt a0, a1, L\nL: ecall',
  'bge a0, a1, L\nL: ecall', 'bltu a0, a1, L\nL: ecall', 'bgeu a0, a1, L\nL: ecall',
  'jal a0, L\nL: ecall', 'jalr a0, a1, 0', 'lui a0, 1', 'auipc a0, 1',
  'ecall', 'ebreak', 'mret',
  'csrrw a0, mstatus, a1', 'csrrs a0, mstatus, a1', 'csrrc a0, mstatus, a1',
  'csrrwi a0, mstatus, 1', 'csrrsi a0, mstatus, 1', 'csrrci a0, mstatus, 1',
  'j L\nL: ecall', 'nop', 'mv a0, a1', 'li a0, 1', 'la a0, L\nL: ecall', 'ret',
  'call L\nL: ecall', 'beqz a0, L\nL: ecall', 'bnez a0, L\nL: ecall',
]

// 直接问 asm.py：这些探针里哪些真的编得出来。
// 关键字表在本文件里一个字都不重抄——重抄就又会变成第三份可能过期的表。
const py = [
  'import sys, json',
  `sys.path.insert(0, ${JSON.stringify(path.join(root, 'backend', 'python'))})`,
  'import asm',
  'cands = json.loads(sys.stdin.read())',
  'ok = []',
  'for c in cands:',
  '    try:',
  '        asm.assemble(c.split("\\n"))',
  '        ok.append(c.split()[0])',
  '    except Exception:',
  '        pass',
  'sys.stdout.write(json.dumps(ok))',
].join('\n')

const raw = execFileSync('python', ['-c', py], {
  input: JSON.stringify(PROBES),
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  encoding: 'utf-8',
})
const supported = new Set(JSON.parse(raw))

console.log(`asm.py 实测可编 ${supported.size} 个助记符，前端 MNEMONICS ${MNEMONICS.size} 个\n`)

// ---------------------------------------------------------------- 双向对账
{
  const onlyBackend = [...supported].filter((m) => !MNEMONICS.has(m)).sort()
  const onlyFrontend = [...MNEMONICS].filter((m) => !supported.has(m)).sort()
  const probed = new Set(PROBES.map((p) => p.split(/\s+/)[0]))
  const unprobed = [...MNEMONICS].filter((m) => !probed.has(m)).sort()

  for (const m of onlyBackend) bad(`asm.py 编得出来，前端却没高亮成关键字：${m}`)
  for (const m of onlyFrontend) bad(`前端高亮成关键字，asm.py 却编不出来：${m}`)
  for (const m of unprobed) bad(`MNEMONICS 里的 ${m} 没有对应探针，无法确认它真能编（请补 PROBES）`)
  if (!onlyBackend.length && !onlyFrontend.length && !unprobed.length) {
    console.log('  ✓ 两张表逐条一致')
  }
}

// ---------------------------------------------------------------- 高亮类型
{
  const cases = [
    ['addi a0, a1, 1', 'addi', 'keyword'],
    ['addi a0, a1, 1', 'a0', 'atom'],
    ['li fp, 1', 'fp', 'atom'],            // fp 是 s0 的别名，asm.py 认，这里也要认
    ['li x31, 1', 'x31', 'atom'],
    ['li x32, 1', 'x32', 'variableName'],  // x32 不存在，不该染成寄存器
    // 标签定义连冒号一起成词（labelName 的 token 是 "loop:"）；
    // 作为跳转目标出现的 loop 只是个普通标识符，应当留在 variableName
    ['loop: beq a0, a1, loop', 'loop:', 'labelName'],
    ['loop: beq a0, a1, loop', 'loop', 'variableName'],
    ['loop: beq a0, a1, loop', 'beq', 'keyword'],
    ['addi a0, a1, 0x10  # 加一', '# 加一', 'comment'],
    ['.word 0x1234', '.word', 'meta'],
    ['.word 0x1234', '0x1234', 'number'],
  ]
  let n = 0
  for (const [line, word, want] of cases) {
    const got = tokenize(line).find(([t]) => t === word)
    if (!got) { bad(`「${line}」里找不到词 ${word}`); continue }
    if (got[1] !== want) bad(`「${line}」里的 ${word} 是 ${got[1]}，期望 ${want}`)
    else n++
  }
  if (n === cases.length) console.log(`  ✓ 高亮类型 ${n} 条全对（含寄存器 atom 色）`)
}

// ---------------------------------------------------------------- 抽样渲染
console.log('\n样例渲染：')
for (const line of [
  'main:   li   a0, 10',
  '        la   t0, data',
  '        call func',
  '        beqz a0, done',
  'done:   mret',
]) {
  const pretty = tokenize(line).map(([t, ty]) => (ty ? `${ty}:${t}` : t)).join(' ')
  console.log(`  ${pretty}`)
}

console.log(`\n断言失败 ${fails} 处`)
process.exit(fails ? 1 : 0)
