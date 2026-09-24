# 计时器中断 demo：闹钟每 20 周期响一次，handler 计数并推迟闹钟
# 主程序空转 60 拍后：a1 = 中断次数，然后关中断、停机
    la    t0, handler             # t0 = handler 地址
    csrrw zero, mtvec, t0         # mtvec = handler
    addi  t0, zero, 20
    csrrw zero, mtimecmp, t0      # 闹钟定在第 20 周期
    addi  t0, zero, 128           # MTIE = bit7，5 位立即数装不下，用寄存器版
    csrrs zero, mie, t0           # mie |= 128 → 开 MTIE
    addi  t3, zero, 0             # t3 = 中断次数（必须在开总闸前清零）
    addi  t2, zero, 60            # 主程序转 60 拍
    csrrsi zero, mstatus, 8       # ★ 最后开总闸 MIE——此后中断才可能进来
spin:
    addi  t2, t2, -1
    bne   t2, zero, spin          # 空转（期间计时器偶尔打断）
    addi  a1, t3, 0               # 结果：a1 = 中断次数
    csrrci zero, mstatus, 8       # 先关总闸（此后 handler 不再进来）
    addi  t0, zero, 128
    csrrc zero, mie, t0           # 再关 MTIE
    csrrw  zero, mtvec, zero      # 清 mtvec
    ecall                         # 停机

handler:
    addi  t3, t3, 1               # 中断计数 +1
    csrrs t0, mtimecmp, zero      # t0 = 当前闹钟值（只读）
    addi  t0, t0, 20              # 推迟到 20 周期后
    csrrw zero, mtimecmp, t0      # 写回闹钟
    mret
