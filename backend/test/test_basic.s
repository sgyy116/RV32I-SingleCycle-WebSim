# ============================================================================
# test_basic.s —— RV32I 基础指令测试程序
# 覆盖：ADDI / ADD / SUB / LW / SW / BEQ / JAL / JALR / LUI / AUIPC / 移位 / 比较
# 结束时 a0=0 并 ECALL 停机
# ============================================================================
    # ---- 算术运算 ----
    addi  t0, zero, 42      # t0 = 42
    addi  t1, zero, 8       # t1 = 8
    add   t2, t0, t1        # t2 = 50
    sub   t3, t0, t1        # t3 = 34
    andi  t4, t0, 0xFF      # t4 = 42
    ori   t5, t0, 0x100     # t5 = 298
    xori  t6, t0, -1        # t6 = -43
    slli  s0, t0, 2         # s0 = 168
    srli  s1, s0, 1         # s1 = 84
    slti  s2, t0, 100       # s2 = 1
    sltu  s3, zero, t0      # s3 = 1

    # ---- LUI / AUIPC ----
    lui   s4, 0x12345       # s4 = 0x12345000
    auipc s5, 0x12345       # s5 = PC + (0x12345 << 12)，立即数非零才能验出实现错误

    # ---- 内存读写（基址 0x80000000）----
    lui   a0, 0x80000       # a0 = 0x80000000（内存基址）
    sw    t2, 0(a0)         # mem[0x80000000] = 50
    lw    a1, 0(a0)         # a1 = 50

    # ---- 分支测试 ----
    beq   zero, zero, taken # 恒真跳转
    addi  a2, zero, 99      # 不应执行
taken:
    bne   t0, t1, next      # 42 != 8 -> 跳转
    addi  a2, zero, 98      # 不应执行
next:
    blt   t1, t0, done      # 8 < 42 -> 跳转
    addi  a2, zero, 97      # 不应执行

    # ---- 子程序调用（JAL + JALR）----
done:
    jal   ra, func          # ra = 返回地址
    addi  a3, zero, 0       # 返回后执行 a3 = 0
    j     fin

func:
    addi  a2, zero, 7       # a2 = 7
    jalr  zero, ra, 0       # 返回

fin:
    addi  a4, zero, 0       # 退出码 0
    ecall

