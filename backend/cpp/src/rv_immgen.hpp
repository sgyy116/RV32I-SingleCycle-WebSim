#pragma once
// ============================================================================
// rv_immgen.hpp —— 立即数生成器（I/S/B/U/J 五种格式，符号扩展到 32 位）
// ============================================================================

#include "rv_common.hpp"

namespace rv32i {

// 依据 RISC-V 规格书逐位重组各格式立即数，再符号扩展为 32 位
inline i32 imm_gen(const rv_instr& in, Format fmt) {
    switch (fmt) {
        case Format::I: {
            // imm[11:0] 在 bit[31:20]，符号扩展为 32 位
            u32 imm = (in.bits >> 20) & 0xFFF;
            return static_cast<i32>(static_cast<i32>(imm << 20) >> 20);
        }

        case Format::S: {
            // imm[4:0] 在 bit[11:7]，imm[11:5] 在 bit[31:25]
            u32 imm = (in.bits >> 7) & 0x1F;
            imm |= ((in.bits >> 25) & 0x7F) << 5;
            return static_cast<i32>(static_cast<i32>(imm << 20) >> 20);
        }

        case Format::B: {
            // imm[4:1] bit[11:8]，imm[10:5] bit[30:25]，imm[11] bit[7]，imm[12] bit[31]
            u32 imm = 0;
            imm |= ((in.bits >> 8) & 0x0F) << 1;    // imm[4:1]
            imm |= ((in.bits >> 25) & 0x3F) << 5;   // imm[10:5]
            imm |= ((in.bits >> 7) & 0x01) << 11;   // imm[11]
            imm |= ((in.bits >> 31) & 0x01) << 12;  // imm[12]
            return static_cast<i32>(static_cast<i32>(imm << 19) >> 19);
        }

        case Format::U:
            // imm[31:12] 在 bit[31:12]
            return static_cast<i32>(in.bits & 0xFFFFF000u);

        case Format::J: {
            // imm[10:1] bit[30:21]，imm[11] bit[20]，imm[19:12] bit[19:12]，imm[20] bit[31]
            u32 imm = 0;
            imm |= ((in.bits >> 21) & 0x3FF) << 1;  // imm[10:1]
            imm |= ((in.bits >> 20) & 0x01) << 11;  // imm[11]
            imm |= ((in.bits >> 12) & 0xFF) << 12;  // imm[19:12]
            imm |= ((in.bits >> 31) & 0x01) << 20;  // imm[20]
            return static_cast<i32>(static_cast<i32>(imm << 11) >> 11);
        }

        default:
            return 0;
    }
}

}  // namespace rv32i
