#pragma once
// ============================================================================
// rv_alu.hpp —— ALU（10 种 RV32I 算术逻辑运算 + zero 标志）
// ============================================================================

#include "rv_common.hpp"

namespace rv32i {

struct alu_result_t {
    u32 value;
    bool zero;
};

inline alu_result_t alu_compute(AluOp op, u32 a, u32 b) {
    u32 result = 0;
    switch (op) {
        case AluOp::ADD:    result = a + b; break;
        case AluOp::SUB:    result = a - b; break;
        case AluOp::SLL:    result = a << (b & 31); break;
        case AluOp::SLT:    result = (static_cast<i32>(a) < static_cast<i32>(b)) ? 1 : 0; break;
        case AluOp::SLTU:   result = (a < b) ? 1 : 0; break;
        case AluOp::XOR:    result = a ^ b; break;
        case AluOp::SRL:    result = a >> (b & 31); break;
        case AluOp::SRA:    result = static_cast<u32>(static_cast<i32>(a) >> (b & 31)); break;
        case AluOp::OR:     result = a | b; break;
        case AluOp::AND:    result = a & b; break;
        case AluOp::PASS_A: result = a; break;
    }
    return { result, result == 0 };
}

}  // namespace rv32i
