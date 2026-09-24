#pragma once
// ============================================================================
// rv_regfile.hpp —— 寄存器堆（32×32 位，x0 硬连线为 0）
// ============================================================================

#include <array>
#include "rv_common.hpp"

namespace rv32i {

class rv_regfile {
public:
    rv_regfile() { m_regs.fill(0); }

    u32 read(u32 idx) const {
        return (idx == 0) ? 0u : m_regs[idx & 31];
    }

    void write(u32 idx, u32 value) {
        if (idx != 0) m_regs[idx & 31] = value;   // x0 写入被忽略
    }

    void reset() { m_regs.fill(0); }

    const std::array<u32, 32>& raw() const { return m_regs; }

private:
    std::array<u32, 32> m_regs;
};

}  // namespace rv32i
