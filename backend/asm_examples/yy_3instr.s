# yy-riscv 前端里的那 3 条指令（教学练习用）
# x10=1, x11=2, x11=x11+x10=3
    addi  x10, x0, 1
    addi  x11, x0, 2
    add   x11, x11, x10
    ecall
