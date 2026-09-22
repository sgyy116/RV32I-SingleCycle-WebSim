#pragma once

// ============================================================================
// rv_common.hpp —— RV32I 指令编码联合体 + 操作码枚举 + 基础类型
//
// 参考 RV64I 参考实现的 rv_instr 结构，数据类型由 64 位改为 32 位。
// 六种指令格式（R/I/S/B/U/J）的位域划分在 RV32/RV64 中完全相同，可直接沿用。
// ============================================================================

#include <cstdint>
#include <string>
#include <array>

namespace rv32i {

using u8  = std::uint8_t;
using u16 = std::uint16_t;
using u32 = std::uint32_t;
using u64 = std::uint64_t;
using i8  = std::int8_t;
using i16 = std::int16_t;
using i32 = std::int32_t;
using i64 = std::int64_t;

// ---------------------------------------------------------------------------
// RV32I 操作码
// ---------------------------------------------------------------------------
enum Opcode : u8 {
    OP_LOAD     = 0b0000011,   // 访存读
    OP_MISC_MEM = 0b0001111,   // FENCE
    OP_OP_IMM   = 0b0010011,   // 立即数算术
    OP_AUIPC    = 0b0010111,
    OP_STORE    = 0b0100011,   // 访存写
    OP_OP       = 0b0110011,   // 寄存器算术
    OP_LUI      = 0b0110111,
    OP_BRANCH   = 0b1100011,
    OP_JALR     = 0b1100111,
    OP_JAL      = 0b1101111,
    OP_SYSTEM   = 0b1110011,   // ECALL / EBREAK / CSR
};

// ---------------------------------------------------------------------------
// 指令格式
// ---------------------------------------------------------------------------
enum class Format : u8 { R, I, S, B, U, J, UNKNOWN };

// ---------------------------------------------------------------------------
// 指令编码联合体（RV32I 六种格式位域）
// ---------------------------------------------------------------------------
union rv_instr {
    u32 bits;
    struct { u32 opcode : 7; } op;
    struct { u32 opcode : 7; u32 rd : 5; u32 funct3 : 3; u32 rs1 : 5; u32 rs2 : 5; u32 funct7 : 7; } r;
    struct { u32 opcode : 7; u32 rd : 5; u32 funct3 : 3; u32 rs1 : 5; u32 imm : 12; } i;
    struct { u32 opcode : 7; u32 imm_lo : 5; u32 funct3 : 3; u32 rs1 : 5; u32 rs2 : 5; u32 imm_hi : 7; } s;
    struct { u32 opcode : 7; u32 imm_lo : 4; u32 funct3 : 3; u32 rs1 : 5; u32 rs2 : 5; u32 imm_hi : 6; } b;
    struct { u32 opcode : 7; u32 rd : 5; u32 imm_hi : 20; } u;
    struct { u32 opcode : 7; u32 rd : 5; u32 imm : 20; } j;

    rv_instr() : bits(0) {}
    rv_instr(u32 b) : bits(b) {}
};

// ---------------------------------------------------------------------------
// ALU 操作
// ---------------------------------------------------------------------------
enum class AluOp : u8 {
    ADD, SUB, SLL, SLT, SLTU, XOR, SRL, SRA, OR, AND,
    PASS_A,       // 透传 op1（LUI/AUIPC/JAL/JALR/LW/SW 等地址计算用）
};

inline const char* alu_op_name(AluOp op) {
    switch (op) {
        case AluOp::ADD:    return "ADD";
        case AluOp::SUB:    return "SUB";
        case AluOp::SLL:    return "SLL";
        case AluOp::SLT:    return "SLT";
        case AluOp::SLTU:   return "SLTU";
        case AluOp::XOR:    return "XOR";
        case AluOp::SRL:    return "SRL";
        case AluOp::SRA:    return "SRA";
        case AluOp::OR:     return "OR";
        case AluOp::AND:    return "AND";
        case AluOp::PASS_A: return "PASS";
    }
    return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// ABI 寄存器名
// ---------------------------------------------------------------------------
inline const char* reg_name(u32 idx) {
    static const char* names[32] = {
        "zero", "ra",  "sp",  "gp",  "tp",  "t0",  "t1",  "t2",
        "s0",   "s1",  "a0",  "a1",  "a2",  "a3",  "a4",  "a5",
        "a6",   "a7",  "s2",  "s3",  "s4",  "s5",  "s6",  "s7",
        "s8",   "s9",  "s10", "s11", "t3",  "t4",  "t5",  "t6",
    };
    return names[idx & 31];
}

// 指令格式字符串
inline const char* format_str(Format f) {
    switch (f) {
        case Format::R: return "R";
        case Format::I: return "I";
        case Format::S: return "S";
        case Format::B: return "B";
        case Format::U: return "U";
        case Format::J: return "J";
        default:        return "?";
    }
}

}  // namespace rv32i
