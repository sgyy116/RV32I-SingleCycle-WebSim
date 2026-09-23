#pragma once
// ============================================================================
// rv_control.hpp —— 主控制单元（opcode+funct3+funct7 → 控制信号真值表）
//
// 每个控制信号的含义：
//   reg_write  : 寄存器写使能（Rd 写回）
//   alu_src    : ALU 第二操作数来源：0=rs2, 1=立即数
//   mem_write  : 数据存储器写使能
//   mem_read   : 数据存储器读使能
//   mem_to_reg : 写回数据来源：0=ALU结果, 1=内存数据
//   branch     : 条件分支指令
//   jump       : 无条件跳转（JAL）
//   is_auipc   : AUIPC（写回 pc+imm；op1 取 PC、op2 取立即数，故 ALU 做 ADD）
//   is_lui     : LUI（ALU 用 PASS_A 直接透传立即数）
//   is_jalr    : JALR（PC = ALU结果 & ~1）
//   alu_op     : ALU 操作码
// ============================================================================

#include "rv_common.hpp"

namespace rv32i {

struct control_signals_t {
    bool reg_write = false;
    bool alu_src   = false;
    bool mem_write = false;
    bool mem_read  = false;
    bool mem_to_reg = false;
    bool branch    = false;
    bool jump      = false;
    bool is_auipc  = false;
    bool is_lui    = false;
    bool is_jalr   = false;
    AluOp alu_op   = AluOp::ADD;
};

// 主译码：opcode → 基础控制信号（funct3/funct7 仅对 OP 类做二次译码）
inline control_signals_t control_decode(u32 opcode, u32 funct3, u32 funct7) {
    control_signals_t c;
    switch (opcode) {
        case OP_LUI:
            c.reg_write = true;
            c.is_lui    = true;
            c.alu_src   = true;
            c.alu_op    = AluOp::PASS_A;
            break;
        case OP_AUIPC:
            c.reg_write = true;
            c.is_auipc  = true;
            c.alu_src   = true;
            // AUIPC 要写回 pc + (imm<<12)：core 里 op1 被设为 m_pc、op2 取立即数，
            // 所以这里必须做 ADD。原先写成 PASS_A 只透传 op1，把立即数整个丢掉，
            // 结果退化成 pc —— 只有 auipc x, 0（imm=0）时看不出差别。
            c.alu_op    = AluOp::ADD;
            break;
        case OP_JAL:
            c.reg_write = true;
            c.jump      = true;
            c.alu_src   = true;
            c.alu_op    = AluOp::PASS_A;
            break;
        case OP_JALR:
            c.reg_write = true;
            c.is_jalr   = true;
            c.alu_src   = true;
            c.alu_op    = AluOp::ADD;
            break;
        case OP_BRANCH:
            c.branch = true;
            // 分支的 ALU 操作按 funct3 选，而不是一律 SUB：
            //   funct3[2]=0        （beq/bne）→ SUB，taken 看 ZF
            //   funct3[2]=1,f3[1]=0（blt/bge）→ SLT  有符号比较
            //   funct3[2]=1,f3[1]=1（bltu/bgeu）→ SLTU 无符号比较
            // 有符号/无符号的区别就落在 alu_op 里，所以 taken 单元只需要
            // 一个「小于」标志位（见 rv_core.cpp 的 taken 推导与图上 alu.lt_out）。
            if (funct3 & 0b100) c.alu_op = (funct3 & 0b010) ? AluOp::SLTU : AluOp::SLT;
            else                c.alu_op = AluOp::SUB;
            break;
        case OP_LOAD:
            c.reg_write = true;
            c.mem_read  = true;
            c.mem_to_reg = true;
            c.alu_src   = true;
            c.alu_op    = AluOp::ADD;   // 地址 = rs1 + imm
            break;
        case OP_STORE:
            c.mem_write = true;
            c.alu_src   = true;
            c.alu_op    = AluOp::ADD;   // 地址 = rs1 + imm
            break;
        case OP_OP_IMM:
            c.reg_write = true;
            c.alu_src   = true;
            // funct3 区分逻辑移位（SLLI/SRLI/SRAI）与算术
            if (funct3 == 0b001) {                       // SLLI
                c.alu_op = AluOp::SLL;
            } else if (funct3 == 0b101) {                // SRLI / SRAI
                c.alu_op = (funct7 == 0x20) ? AluOp::SRA : AluOp::SRL;
            } else {
                switch (funct3) {
                    case 0b000: c.alu_op = AluOp::ADD;  break;
                    case 0b010: c.alu_op = AluOp::SLT;  break;
                    case 0b011: c.alu_op = AluOp::SLTU; break;
                    case 0b100: c.alu_op = AluOp::XOR;  break;
                    case 0b110: c.alu_op = AluOp::OR;   break;
                    case 0b111: c.alu_op = AluOp::AND;  break;
                    default:    c.alu_op = AluOp::ADD;  break;
                }
            }
            break;
        case OP_OP:
            c.reg_write = true;
            switch (funct3) {
                case 0b000: c.alu_op = (funct7 == 0x20) ? AluOp::SUB : AluOp::ADD; break;
                case 0b001: c.alu_op = AluOp::SLL;  break;
                case 0b010: c.alu_op = AluOp::SLT;  break;
                case 0b011: c.alu_op = AluOp::SLTU; break;
                case 0b100: c.alu_op = AluOp::XOR;  break;
                case 0b101: c.alu_op = (funct7 == 0x20) ? AluOp::SRA : AluOp::SRL; break;
                case 0b110: c.alu_op = AluOp::OR;   break;
                case 0b111: c.alu_op = AluOp::AND;  break;
                default:    c.alu_op = AluOp::ADD;  break;
            }
            break;
        case OP_SYSTEM:
            // ECALL / EBREAK / CSR：由 core 处理，这里保持全 0
            break;
        case OP_MISC_MEM:  // FENCE：无害，顺序执行
        default:
            break;
    }
    return c;
}

}  // namespace rv32i
