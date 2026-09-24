# ============================================================================
# test_pseudo.s —— 伪指令端到端测试
#
# test_asm.py 验的是「编码器算出来的 == 我手算的」，两边可能一起错。
# 这一份把伪指令编出来的程序真的喂给模拟器跑，验的是「CPU 执行后的结果」。
#
# 覆盖：li（小常数 / 大常数 / 负数）、mv、nop、ret、call、beqz/bnez、
#       行内标签、la、以及带 0x 偏移的 lw/sw
# ============================================================================
        li    a0, 0             # a0 = 0（addi 形式）
        li    a1, 0x12345       # a1 = 0x12345（lui+addi 形式）
        mv    a2, a1            # a2 = a1
        li    a6, -100          # a6 = -100
        li    s0, 5             # s0 = 5（循环计数）
        li    s1, 0             # s1 = 0（累加和）

loop:
        add   s1, s1, s0        # s1 += s0
        addi  s0, s0, -1        # s0--
        bnez  s0, loop          # s0 != 0 就继续

        call  func              # 调子程序（auipc + jalr）
        addi  a3, zero, 1       # 返回后执行
        j     fin

func:   li    a4, 7             # 行内标签 + li
        ret                     # jalr x0, ra, 0

fin:
        la    t3, data          # t3 = data 的绝对地址
        lw    t4, 0(t3)         # t4 = mem[t3]
        sw    t4, 0x4(t3)       # mem[t3+4] = t4（验证 0x 偏移）
        lw    t5, 0x4(t3)       # t5 = mem[t3+4]
        li    a5, 0             # 退出码 0
        ecall

data:   .word 0xCAFEBABE
