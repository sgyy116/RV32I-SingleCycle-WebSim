# ============================================================================
# fact.s —— 阶乘（迭代版，只用 RV32I 基础指令）
# 教学点：循环 + 分支 + 用加法循环实现乘法
# 结果: a1 = 5! = 120
# ============================================================================
    addi  a0, zero, 5       # n = 5
    addi  a1, zero, 1       # result = 1

# while (n > 1) { result *= n; n-- }
fact_loop:
    addi  t0, zero, 1
    slt   t1, a0, t0        # t1 = (n < 1) ?
    bne   t1, zero, done    # n < 1 → 结束
    addi  t2, zero, 2
    slt   t3, a0, t2        # t3 = (n < 2) ?
    bne   t3, zero, done    # n == 1 → 结束（乘 1 无意义）

    # 乘法: a1 = a1 * a0（用加法累加 a0 次）
    addi  t4, zero, 0       # sum = 0
    addi  t5, a0, 0         # 计数器 = n
mul_loop:
    add   t4, t4, a1        # sum += result
    addi  t5, t5, -1
    bne   t5, zero, mul_loop
    addi  a1, t4, 0         # result = sum

    addi  a0, a0, -1        # n--
    j     fact_loop

done:
    addi  a0, zero, 0       # 退出码 0
    ecall
