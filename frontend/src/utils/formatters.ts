// ============================================================================
// formatters.ts —— 数值格式化工具
// ============================================================================

/** 无符号 32 位整数转十六进制字符串 */
export function toHex(value: number | string, pad = 8): string {
  const n = typeof value === 'string' ? parseInt(value, 16) : value
  const u = n >>> 0
  return '0x' + u.toString(16).padStart(pad, '0').toUpperCase()
}

/** 无符号 32 位整数转二进制字符串 */
export function toBin(value: number, bits = 32): string {
  const u = value >>> 0
  return u.toString(2).padStart(bits, '0')
}

/** 有符号十进制显示 */
export function toSigned(value: number): number {
  const u = value >>> 0
  return u >= 0x80000000 ? u - 0x100000000 : u
}

/** 控制信号 → 人类可读描述 */
export function signalMeaning(key: string): string {
  const map: Record<string, string> = {
    reg_write: '寄存器写使能：允许将结果写入 rd',
    alu_src: 'ALU 源选择：0=rs2 寄存器，1=立即数',
    mem_write: '数据存储器写使能',
    mem_read: '数据存储器读使能',
    mem_to_reg: '写回选择：0=ALU 结果，1=内存读数据',
    branch: '条件分支指令标志',
    jump: '无条件跳转（JAL）标志',
    is_auipc: 'AUIPC：ALU 第一操作数取 PC',
    is_lui: 'LUI：ALU 透传立即数',
    is_jalr: 'JALR：PC 取 (rs1+imm) & ~1',
    alu_op: 'ALU 操作码',
  }
  return map[key] ?? key
}

/** 寄存器 ABI 名称 */
export const REG_NAMES = [
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
  's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
  'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
  's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6',
]

/** 寄存器序号 → 名称 */
export function regName(index: number): string {
  return REG_NAMES[index] ?? `x${index}`
}
