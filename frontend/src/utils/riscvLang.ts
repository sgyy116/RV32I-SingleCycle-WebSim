// ============================================================================
// riscvLang.ts —— RISC-V 汇编 CodeMirror 语法高亮（StreamLanguage）
// ============================================================================

import { StreamLanguage } from '@codemirror/language'
import type { StreamParser } from '@codemirror/language'

const MNEMONICS = new Set([
  'add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and',
  'addi', 'slti', 'sltiu', 'xori', 'ori', 'andi', 'slli', 'srli', 'srai',
  'lb', 'lh', 'lw', 'lbu', 'lhu', 'sb', 'sh', 'sw',
  'beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu',
  'jal', 'jalr', 'lui', 'auipc', 'ecall', 'ebreak', 'j', 'nop',
  'csrrw', 'csrrs', 'csrrc', 'csrrwi', 'csrrsi', 'csrrci',
  'mv', 'li', 'la', 'ret', 'call',
])

const parser: StreamParser<unknown> = {
  token(stream) {
    // 注释
    if (stream.match(/#.*/)) return 'comment'

    // 标签定义 (如 "loop:")
    if (stream.match(/^\s*[A-Za-z_.][\w.]*:/)) return 'labelName'

    // 字符串
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string'

    // 指令助记符
    const word = stream.match(/^[A-Za-z_.][\w.]*/)
    if (word) {
      const w = (word === true ? stream.current() : word[0]).toLowerCase()
      if (MNEMONICS.has(w)) return 'keyword'
      if (w.startsWith('.') && w !== '.') return 'meta'
      return 'variableName'
    }

    // 数字
    if (stream.match(/^0x[0-9a-fA-F]+/)) return 'number'
    if (stream.match(/^-?\d+/)) return 'number'

    // 寄存器
    if (stream.match(/^(x\d{1,2}|zero|ra|sp|gp|tp|t[0-6]|s[0-9]|a[0-7]|s\d{2})/i)) {
      return 'atom'
    }

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
