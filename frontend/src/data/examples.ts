// ============================================================================
// examples.ts —— 教学示例汇编程序
// ============================================================================

export interface Example {
  name: string
  description: string
  source: string
}

export const EXAMPLES: Example[] = [
  {
    name: '加法入门',
    description: 'ADDI / ADD：两个数相加，寄存器 t2 = 50',
    source: `# 加法入门 —— 观察 ADD/ADDI 的数据通路
    addi  t0, zero, 42      # t0 = 0 + 42
    addi  t1, zero, 8       # t1 = 0 + 8
    add   t2, t0, t1        # t2 = 42 + 8 = 50
    addi  a0, zero, 0       # 退出码 0
    ecall
`,
  },
  {
    name: '算术运算',
    description: '加减、逻辑、移位、比较 —— 覆盖全部 ALU 操作',
    source: `# 算术运算 —— 覆盖 ALU 10 种操作
    addi  t0, zero, 42
    addi  t1, zero, 8
    add   t2, t0, t1        # 50
    sub   t3, t0, t1        # 34
    andi  t4, t0, 0xFF      # 42
    ori   t5, t0, 0x100     # 298
    xori  t6, t0, -1        # -43
    slli  s0, t0, 2         # 168
    srli  s1, s0, 1         # 84
    slti  s2, t0, 100       # 1
    sltu  s3, zero, t0      # 1
    addi  a0, zero, 0
    ecall
`,
  },
  {
    name: '访存读写',
    description: 'SW / LW —— 观察 DMEM 读写与 MemtoReg 写回路径',
    source: `# 访存读写 —— SW 写内存，LW 读回
    addi  t0, zero, 100
    lui   a0, 0x80000       # a0 = 0x80000000（内存基址）
    sw    t0, 0(a0)         # mem[0x80000000] = 100
    lw    t1, 0(a0)         # t1 = 100
    addi  a0, zero, 0
    ecall
`,
  },
  {
    name: '条件分支',
    description: 'BEQ / BNE / BLT —— 观察分支比较与 PC 跳转',
    source: `# 条件分支 —— 分支命中时 PC 跳转
    addi  t0, zero, 10
    addi  t1, zero, 20
    beq   t0, t1, skip      # 10 == 20? 否，不跳
    addi  t2, zero, 1       # t2 = 1（顺序执行）
skip:
    blt   t0, t1, done      # 10 < 20? 是，跳转
    addi  t2, zero, 99      # 不会执行
done:
    addi  a0, zero, 0
    ecall
`,
  },
  {
    name: '函数调用',
    description: 'JAL / JALR —— 调用与返回，观察 PC 链接机制',
    source: `# 函数调用 —— JAL 保存返回地址，JALR 返回
    addi  a0, zero, 0
    jal   ra, func          # 调用子程序，ra = 返回地址
    addi  a1, zero, 5       # 返回后执行
    j     fin
func:
    addi  a2, zero, 7       # 子程序体
    jalr  zero, ra, 0       # 返回
fin:
    addi  a0, zero, 0
    ecall
`,
  },
  {
    name: '斐波那契',
    description: '循环 + 加法 —— 计算斐波那契数列第 9 项',
    source: `# 斐波那契 —— t3 = F(9) = 34
    addi  t0, zero, 1       # F(1)
    addi  t1, zero, 1       # F(2)
    addi  t2, zero, 9       # 循环计数
loop:
    add   t3, t0, t1        # t3 = t0 + t1
    addi  t0, t1, 0         # t0 = t1
    addi  t1, t3, 0         # t1 = t3
    addi  t2, t2, -1        # 计数减一
    bne   t2, zero, loop    # 不为 0 则继续
    addi  a0, zero, 0
    ecall
`,
  },
]
