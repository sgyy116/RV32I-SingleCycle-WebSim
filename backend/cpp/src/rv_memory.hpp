#pragma once
// ============================================================================
// rv_memory.hpp —— 字节寻址统一内存（默认 128KB，基址 0x80000000）
// ============================================================================

#include <vector>
#include <cstring>
#include "rv_common.hpp"

namespace rv32i {

inline constexpr u32 DEFAULT_MEM_SIZE  = 128 * 1024;    // 128KB
inline constexpr u32 RESET_VECTOR      = 0x80000000u;   // 复位 PC / 内存基址
inline constexpr u32 MEMORY_END        = RESET_VECTOR + DEFAULT_MEM_SIZE;

class rv_memory {
public:
    explicit rv_memory(u32 size = DEFAULT_MEM_SIZE, u32 base = RESET_VECTOR)
        : m_data(size, 0), m_base(base) {}

    void reset() { std::fill(m_data.begin(), m_data.end(), 0); }

    bool in_range(u32 addr) const {
        return addr >= m_base && addr < m_base + m_data.size();
    }

    u32 addr_to_offset(u32 addr) const { return addr - m_base; }

    // 读（小端）；越界读返回 0
    u32 load_byte_u(u32 addr) const {
        return in_range(addr) ? m_data[addr_to_offset(addr)] : 0;
    }
    u32 load_byte(u32 addr) const {
        return in_range(addr)
            ? static_cast<u32>(static_cast<i8>(m_data[addr_to_offset(addr)])) : 0;
    }
    u32 load_half_u(u32 addr) const {
        if (!in_range(addr) || !in_range(addr + 1)) return 0;
        u32 off = addr_to_offset(addr);
        return static_cast<u32>(m_data[off]) |
               (static_cast<u32>(m_data[off + 1]) << 8);
    }
    u32 load_half(u32 addr) const {
        return static_cast<u32>(static_cast<i16>(load_half_u(addr)));
    }
    u32 load_word(u32 addr) const {
        if (!in_range(addr) || !in_range(addr + 3)) return 0;
        u32 off = addr_to_offset(addr);
        return static_cast<u32>(m_data[off]) |
               (static_cast<u32>(m_data[off + 1]) << 8) |
               (static_cast<u32>(m_data[off + 2]) << 16) |
               (static_cast<u32>(m_data[off + 3]) << 24);
    }

    // 写（小端）；越界写忽略
    void store_byte(u32 addr, u8 val) {
        if (in_range(addr)) m_data[addr_to_offset(addr)] = val;
    }
    void store_half(u32 addr, u16 val) {
        if (!in_range(addr) || !in_range(addr + 1)) return;
        u32 off = addr_to_offset(addr);
        m_data[off]     = static_cast<u8>(val);
        m_data[off + 1] = static_cast<u8>(val >> 8);
    }
    void store_word(u32 addr, u32 val) {
        if (!in_range(addr) || !in_range(addr + 3)) return;
        u32 off = addr_to_offset(addr);
        m_data[off]     = static_cast<u8>(val);
        m_data[off + 1] = static_cast<u8>(val >> 8);
        m_data[off + 2] = static_cast<u8>(val >> 16);
        m_data[off + 3] = static_cast<u8>(val >> 24);
    }

    // 原始写入（ELF 段加载用）；越界截断
    void write_raw(u32 addr, const u8* data, std::size_t len) {
        if (!in_range(addr)) return;
        u32 off = addr_to_offset(addr);
        std::size_t avail = m_data.size() - off;
        if (len > avail) len = avail;
        std::memcpy(m_data.data() + off, data, len);
    }

    u8 read_byte_raw(u32 addr) const {
        return in_range(addr) ? m_data[addr_to_offset(addr)] : 0;
    }

    u32 size() const { return static_cast<u32>(m_data.size()); }
    u32 base() const { return m_base; }

private:
    std::vector<u8> m_data;
    u32 m_base;
};

}  // namespace rv32i
