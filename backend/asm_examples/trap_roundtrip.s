# trap 往返 demo：ecall → 跳 handler → handler 跳过 ecall → mret 回来
# 预期：a0 = 2（被 handler 加过），a1 = 99（证明程序在 ecall 之后恢复了）
    la    t0, handler          # t0 = handler 的地址（lui+addi 两条指令）
    csrrw zero, mtvec, t0      # mtvec = t0，配置处理程序入口
    addi  a0, zero, 1          # a0 = 1
    ecall                      # ★ 触发异常 → 跳去 handler（mepc 记下 ecall 地址）
    addi  a1, zero, 99         # ← mret 后回到这里：a1 = 99
    csrrw zero, mtvec, zero    # 把 mtvec 清空
    ecall                      # 再触发异常 → mtvec=0 → 停机

handler:                       # 0x80000020
    addi  a0, a0, 1            # a0 = 2，证明 handler 真的跑过
    csrrs t1, mepc, zero       # t1 = mepc（只读不改）
    addi  t1, t1, 4            # mepc + 4：跳过那条 ecall
    csrrw zero, mepc, t1       # mepc = t1
    mret                       # 返回 → 0x80000014
