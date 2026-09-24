# src1_rdata 网络判定用例。
#
# 要验的就是一条：图上「rs1 寄存器的值送进 CSR 写数据口」这根线，
# 到底该在哪些指令上亮。真实条件只有两个（rv_core.cpp:403-412）：
#   寄存器版（funct3 的 bit2 = 0）且这一拍确实写 CSR（do_write）。
# 这里把 6 个变体、以及 do_write 的真/假两种情况全摆一遍。
#
# 期望（下面逐行标了）：
#   csrrw  寄存器版 + 无条件写          → 亮
#   csrrs  寄存器版 + rs1 != 0 才写     → t1 != 0 时亮，rs1 = x0 时不亮
#   csrrc  寄存器版 + rs1 != 0 才写     → 亮
#   csrrwi 立即数版                     → 不亮（src 取 rs1 字段，没读寄存器堆）
#   csrrsi 立即数版                     → 不亮
#   csrrci 立即数版                     → 不亮
#   addi   非 CSR                       → 不亮

    addi   t1, x0, 8          # t1 = 8，给下面 csrrs/csrrc 一个非零源操作数

    csrrw  t0, mstatus, x0    # 期望【亮】 寄存器版；CSRRW 无条件写，src = x0 的值 0
    csrrw  x0, mstatus, t1    # 期望【亮】 寄存器版；rd = x0 不写回，但 CSR 照样被写
    csrrs  t0, mstatus, t1    # 期望【亮】 寄存器版；src = 8 != 0 → do_write = true
    csrrs  t0, mstatus, x0    # 期望【不亮】寄存器版但 src = 0 → do_write = false
    csrrc  t0, mstatus, t1    # 期望【亮】 寄存器版；src = 8 != 0 → do_write = true

    csrrwi t0, mstatus, 4     # 期望【不亮】立即数版：src 取 rs1 字段本身
    csrrsi t0, mstatus, 3     # 期望【不亮】立即数版
    csrrsi t0, mstatus, 0     # 期望【不亮】立即数版，且字段为 0 → 不写
    csrrci t0, mstatus, 1     # 期望【不亮】立即数版

    addi   t2, x0, 1          # 期望【不亮】压根不是 CSR 指令
    addi   a0, x0, 0          # 退出码 0
    ecall
