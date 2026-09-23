# 高亮/波次验证用的**控制流**夹具。
#
# 为什么要单独一份：_hl_test.s 的控制流只有 beq（跳成功）和 jal，于是
#   - 六条分支里的另外五条（bne/blt/bge/bltu/bgeu）从没被点亮验证过；
#   - jalr 完全没有（_hl_check.mjs 里它原先是一条空断言）；
#   - lui / auipc 的写回选择也没被验证过。
# taken 单元的判据是「funct3[2] 选 ZF/LT、funct3[0] 选极性、funct3[1] 只影响 alu_op」，
# 三位都得走一遍才谈得上验证（见 tools/_wave_check.mjs 的 taken / MUX 断言）。
#
# 每条分支都刻意一正一反：同一助记符、同一对操作数，只差跳与不跳。于是同一个
# 助记符在不同周期必须给出不同的 taken —— 这是「判得对不对」的判据，而不是
# 「指令认不认识」的判据。
# x3 = -1 = 0xFFFFFFFF：有符号看是 -1，无符号看是 4294967295。
# blt 与 bltu 在这一对操作数上结论相反，正好把 SLT 与 SLTU 分开。
#
# 内存基址是 0x80000000，本夹具不访存，只 ecall 停机。

    li   x1, 5              # x1 = 5
    li   x2, 5              # x2 = 5（与 x1 相等）
    li   x3, -1             # x3 = -1 = 0xFFFFFFFF

    # ---- funct3 = 000（beq）：base = ZF，极性不取反 ----
    beq  x1, x2, Q1         # 5 == 5 → ZF=1 → 跳
    li   x4, 1
Q1:
    beq  x1, x3, Q2         # 5 != -1 → ZF=0 → 不跳
    li   x4, 2
Q2:
    # ---- funct3 = 001（bne）：base = ZF，极性取反 ----
    bne  x1, x3, Q3         # ZF=0 → 跳
    li   x4, 3
Q3:
    bne  x1, x2, Q4         # ZF=1 → 不跳
    li   x4, 4
Q4:
    # ---- funct3 = 100（blt，有符号 → ALU 做 SLT）：base = LT ----
    blt  x3, x1, Q5         # -1 < 5 → LT=1 → 跳
    li   x4, 5
Q5:
    blt  x1, x3, Q6         # 5 < -1 假 → LT=0 → 不跳
    li   x4, 6
Q6:
    # ---- funct3 = 101（bge，有符号 → SLT）：base = LT，极性取反 ----
    bge  x1, x3, Q7         # 5 >= -1 → LT=0 → 跳
    li   x4, 7
Q7:
    bge  x3, x1, Q8         # -1 >= 5 假 → LT=1 → 不跳
    li   x4, 8
Q8:
    # ---- funct3 = 110（bltu，无符号 → SLTU）：同一对操作数，结论与 blt 相反 ----
    bltu x1, x3, Q9         # 5 < 4294967295 → LT=1 → 跳
    li   x4, 9
Q9:
    bltu x3, x1, Q10        # 4294967295 < 5 假 → LT=0 → 不跳
    li   x4, 10
Q10:
    # ---- funct3 = 111（bgeu，无符号 → SLTU）：base = LT，极性取反 ----
    bgeu x3, x1, Q11        # 4294967295 >= 5 → LT=0 → 跳
    li   x4, 11
Q11:
    bgeu x1, x3, Q12        # 5 >= 4294967295 假 → LT=1 → 不跳
    li   x4, 12
Q12:
    # ---- jal：PC 走 pcimmadder 那一路（pcmux3 的 0 口），&~1 那一路该灭 ----
    jal  x5, Q13
    li   x4, 13             # 被跳过
Q13:
    # ---- jalr：PC 走 &~1 那一路（pcmux3 的 1 口），pc+imm 那一路该灭 ----
    la   x9, Q14
    jalr x6, x9, 0
    li   x4, 14             # 被跳过
Q14:
    # ---- lui / auipc：muxa0 与 muxa 的写回选择 ----
    lui  x7, 0x12345
    auipc x11, 0x1
    ecall                   # mtvec == 0 → 停机（rv_core.cpp:201-203）
