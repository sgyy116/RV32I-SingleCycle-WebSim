#pragma once
// ============================================================================
// rv_disasm.hpp —— 反汇编器（机器码 → 助记符字符串）
// ============================================================================

#include <string>
#include "rv_common.hpp"

namespace rv32i {

// 指令种类枚举（覆盖 RV32I 全集 + 系统指令）
enum class InstrKind : u8 {
    // R-type
    ADD, SUB, SLL, SLT, SLTU, XOR, SRL, SRA, OR, AND,
    // I-type 算术
    ADDI, SLTI, SLTIU, XORI, ORI, ANDI, SLLI, SRLI, SRAI,
    // 访存
    LW, LH, LB, LHU, LBU, SW, SH, SB,
    // 跳转
    JALR, JAL, LUI, AUIPC,
    // 分支
    BEQ, BNE, BLT, BGE, BLTU, BGEU,
    // 系统
    ECALL, EBREAK, MRET, FENCE,
    CSRRW, CSRRS, CSRRC, CSRRWI, CSRRSI, CSRRCI,
    INVALID
};

struct decoded_instr_t {
    InstrKind kind = InstrKind::INVALID;
    Format    format = Format::UNKNOWN;
    u32 rd = 0, rs1 = 0, rs2 = 0;
    u32 funct3 = 0, funct7 = 0;
    i32 imm = 0;
    u32 csr = 0;
    std::string mnemonic;   // "add"
    std::string text;       // "add a0, a0, a0"
};

// 完整译码：机器码 → 指令种类 + 字段 + 反汇编文本
decoded_instr_t decode(u32 bits);

}  // namespace rv32i
