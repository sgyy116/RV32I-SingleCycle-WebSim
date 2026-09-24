#pragma once
// ============================================================================
// rv_alu.hpp —— ALU（10 种 RV32I 算术逻辑运算 + zero / less 标志）
// ============================================================================

#include "rv_common.hpp"

namespace rv32i {

// less 是 result 的最低位（即 SLT/SLTU 的比较结果）。
// 数据通路图上 ALU 右侧除了 ZF 还引出 LT，两支一起送进 taken 单元：
// taken 用 funct3[2] 在「相等」与「小于」之间选，用 funct3[0] 选极性，
// 六条分支（beq/bne/blt/bge/bltu/bgeu）就都由这两个标志位组出来。
struct alu_result_t {
    u32 value;
    bool zero;      // result == 0
    bool less;      // result 的最低位为 1
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
    return { result, result == 0, (result & 1u) != 0 };
}

}  // namespace rv32i
