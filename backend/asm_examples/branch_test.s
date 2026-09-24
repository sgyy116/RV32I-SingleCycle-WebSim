# ============================================================================
# branch_test.s —— 条件分支全覆盖测试
# 教学点：BEQ/BNE/BLT/BGE/BLTU/BGEU 六种比较与 PC 跳转
# ============================================================================
    addi  t0, zero, 10
    addi  t1, zero, 20

    # BEQ：相等才跳
    beq   t0, t0, beq_ok    # 10 == 10 跳转
    addi  t2, zero, 99      # 不执行
beq_ok:
    # BNE：不等才跳
    bne   t0, t1, bne_ok    # 10 != 20 跳转
    addi  t2, zero, 98
bne_ok:
    # BLT：有符号小于
    blt   t0, t1, blt_ok    # 10 < 20 跳转
    addi  t2, zero, 97
blt_ok:
    # BGE：有符号大于等于
    bge   t1, t0, bge_ok    # 20 >= 10 跳转
    addi  t2, zero, 96
bge_ok:
    # BLTU / BGEU：无符号比较
    bltu  t0, t1, bltu_ok
    addi  t2, zero, 95
bltu_ok:
    bgeu  t1, t0, done
    addi  t2, zero, 94
done:
    addi  t2, zero, 1       # 所有分支正确 → t2 = 1
    addi  a0, zero, 0
    ecall
