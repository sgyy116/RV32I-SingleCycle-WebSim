// ============================================================================
// riscvLang.ts —— RISC-V 汇编 CodeMirror 语法高亮（StreamLanguage）
//
// ★ MNEMONICS 必须与 backend/python/asm.py 的支持子集**逐条对齐**。
//   本机与学生机器上都没有 riscv-*-gcc，compile_server.py 会直接回退到
//   asm.assemble()——那张表才是产品真正支持的指令集。
//   两边不一致的后果学生是直接撞得到的：写 `li a0, 10` 时编辑器把它染成关键字
//   （表示"合法"），点编译却报"不支持的助记符"；反过来 `mret` 编得出来却不高亮。
//   tools/_lang_check.mjs 会拿 asm.py 的实际能力跟这张表对账，改一边漏了另一边就报错。
// ============================================================================

import { StreamLanguage } from '@codemirror/language'
import type { StreamParser } from '@codemirror/language'

export const MNEMONICS = new Set([
  // ---- 真实指令 ----
  'add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and',
  'addi', 'slti', 'sltiu', 'xori', 'ori', 'andi', 'slli', 'srli', 'srai',
  'lb', 'lh', 'lw', 'lbu', 'lhu', 'sb', 'sh', 'sw',
  'beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu',
  'jal', 'jalr', 'lui', 'auipc',
  'ecall', 'ebreak', 'mret',
  'csrrw', 'csrrs', 'csrrc', 'csrrwi', 'csrrsi', 'csrrci',
  // ---- 伪指令（asm.py 会展开成上面的一条或两条）----
  'j', 'nop', 'mv', 'li', 'la', 'ret', 'call', 'beqz', 'bnez',
])

// 完整的寄存器名表，x0~x31 与全部 ABI 别名（含 fp，它是 s0 的别名）
export const REGISTERS = new Set<string>([
  'zero', 'ra', 'sp', 'gp', 'tp', 'fp',
  ...'t0 t1 t2 t3 t4 t5 t6'.split(' '),
  ...Array.from({ length: 12 }, (_, i) => `s${i}`),
  ...Array.from({ length: 8 }, (_, i) => `a${i}`),
  ...Array.from({ length: 32 }, (_, i) => `x${i}`),
])

export const parser: StreamParser<unknown> = {
  token(stream) {
    // 注释
    if (stream.match(/#.*/)) return 'comment'

    // 标签定义 (如 "loop:"，也兼容行内 "loop: addi ...")
    if (stream.match(/^\s*[A-Za-z_.][\w.]*:/)) return 'labelName'

    // 字符串
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string'

    // 标识符：一次取出**整词**再分类。
    // ★ 顺序是关键。原先助记符分支在前、寄存器分支在后，而助记符分支对任何字母
    //   开头的词都会 return（不认识就 return 'variableName'），于是下面那条寄存器
    //   正则**永远走不到**——a0 / sp / t0 全被染成 variableName，
    //   「寄存器用 atom 色」这件事从写下那天起就没生效过。
    //   而且那条正则没加 $ 锚点，真走到了也会把 `zeros` 当成 `zero` 吃掉。
    if (stream.match(/^[A-Za-z_.][\w.]*/)) {
      const w = stream.current().toLowerCase()
      if (MNEMONICS.has(w)) return 'keyword'
      if (REGISTERS.has(w)) return 'atom'
      if (w.startsWith('.') && w !== '.') return 'meta'   // 伪指令 .word 之类
      return 'variableName'
    }

    // 数字
    if (stream.match(/^0x[0-9a-fA-F]+/)) return 'number'
    if (stream.match(/^-?\d+/)) return 'number'

    stream.next()
    return null
  },
  blankLine() {
    return ''
  },
  startState() {
    return {}
  },
  copyState() {
    return {}
  },
}

export const riscvLang = StreamLanguage.define(parser)
