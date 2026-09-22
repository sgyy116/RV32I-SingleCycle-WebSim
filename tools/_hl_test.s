# 高亮验证用的小程序。
# 覆盖：五段全走 / 分支跳成功 / JAL / JALR 不涉及 / CSR 读写 / mret / 非法指令 trap
# 注意内存基址是 0x80000000，数据地址必须落在 [0x80000000, 0x80020000) 内，
# 越界读写后端静默返回 0（rv_memory.hpp:24-27），不是异常。

    lui  x2, 0x80001        # x2 = 0x80001000（有效数据地址）
    addi x1, x0, 8
    sw   x1, 0(x2)          # MEM 写：mem_write=1，w_rf_dmem 该亮
    lw   x3, 0(x2)          # MEM 读：mem_read/mem_to_reg=1，w_dmem_wb0 该亮
    beq  x1, x3, skip       # 8 == 8 → 跳成功：branch.taken=1，w_taken_m4 该亮
    addi x4, x0, 99         # 被跳过
skip:
    jal  x5, after          # JAL：jump=1，writeback.source=PC_PLUS_4
    addi x6, x0, 88         # 被跳过
after:
    csrrw x7, mstatus, x1   # CSR：is_csr=1，w_wb1_wb 该亮，source=CSR
    csrrw x0, mepc, x2      # 把 mepc 设成 0x80001000，给下面 mret 一个落点
    mret                    # is_mret 该亮，PC 跳回 mepc
    # 回到 0x80001000，那里存的是刚才 sw 写的 8（0x00000008）→ 非法指令
    # 非法指令 trap：cause=2，illegal / trap_taken 该亮
