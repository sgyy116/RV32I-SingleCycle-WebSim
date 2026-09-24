#pragma once
// ============================================================================
// rv_core.hpp —— 单周期 RV32I CPU 核心
//
// step() 在一个周期内完成：IF → ID → RegRead → EX → MEM → WB → 更新 PC
// 每一步的中间信号都被记录到 cycle_state_t，供前端数据通路可视化使用。
// ============================================================================

#include <array>
#include <string>
#include <set>
#include <cstdint>

#include "rv_common.hpp"
#include "rv_regfile.hpp"
#include "rv_memory.hpp"
#include "rv_alu.hpp"
#include "rv_control.hpp"
#include "rv_disasm.hpp"

namespace rv32i {

// ---- 单周期数据通路状态（对应实现方案 6.3 节 JSON 协议） ----
struct reg_read_info_t { u32 index = 0; u32 value = 0; };
struct alu_info_t      { u32 op1 = 0, op2 = 0, result = 0; bool zero = false; };
struct mem_info_t      { u32 addr = 0, read_data = 0, write_data = 0;
                         std::string access_type = "NONE"; u32 access_size = 0; };
struct wb_info_t       { bool active = false; u32 reg_index = 0; u32 data = 0;
                         std::string source = "ALU"; };
struct branch_info_t   { bool taken = false; u32 target_addr = 0; };

// 每周期中断/异常相关 CSR 快照（前端可实时显示）
struct csr_snapshot_t {
    u32 mtvec = 0, mepc = 0, mcause = 0, mstatus = 0;
    u32 mie = 0, mip = 0, mtime = 0, mtimecmp = 0;
};
// 本周期是否取了 trap（供前端展示"中断/异常发生"）
struct trap_info_t {
    bool taken = false;
    u32 cause = 0;    // 原因（含中断标志位）
    u32 mepc = 0;
    u32 mtval = 0;
};

struct cycle_state_t {
    u32 cycle = 0;
    u32 pc = 0;
    u32 next_pc = 0;
    u32 instruction = 0;
    std::string disassembly;

    // instruction_fields
    u32 opcode = 0;
    std::string opcode_name;
    u32 rd = 0, funct3 = 0, rs1 = 0, rs2 = 0, funct7 = 0;
    std::string format;

    i32 immediate = 0;
    control_signals_t ctrl;
    reg_read_info_t reg_rs1, reg_rs2;
    alu_info_t alu;
    mem_info_t mem;
    wb_info_t wb;
    branch_info_t branch;

    csr_snapshot_t csr;   // 中断寄存器快照
    trap_info_t trap;     // 本周期 trap 信息

    std::array<u32, 32> regfile{};
    bool halted = false;
};

// 将单周期状态序列化为实现方案 6.3 节定义的 JSON 字符串
std::string cycle_state_to_json(const cycle_state_t& s, bool as_message = true);

// ---- 核心 ----
class rv32i_core {
public:
    rv32i_core();

    // 执行一个完整周期，返回 false 表示非法指令/停机
    bool step(cycle_state_t& out);
    // 无副作用状态快照（不推进 CPU，供 get_state 命令）
    void snapshot(cycle_state_t& out) const;
    void reset();

    // 加载 ELF/裸二进制
    std::string load_elf(const std::string& path);
    bool has_program() const { return m_loaded; }

    // 断点
    void set_breakpoint(u32 addr) { m_breakpoints.insert(addr); }
    void clear_breakpoint(u32 addr) { m_breakpoints.erase(addr); }
    bool breakpoint_hit(u32 addr) const { return m_breakpoints.count(addr) != 0; }

    // 状态查询
    u32 pc() const { return m_pc; }
    u32 cycle() const { return m_cycle; }
    bool halted() const { return m_halted; }
    u32 exit_code() const { return m_exit_code; }
    std::string halt_reason() const { return m_halt_reason; }
    const rv_regfile& regfile() const { return m_regfile; }
    const rv_memory& memory() const { return m_mem; }

    // 内存读写（供 get_memory 命令）
    const rv_memory& mem() const { return m_mem; }

private:
    u32 m_pc;
    u64 m_cycle;
    bool m_halted;
    u32 m_exit_code;
    std::string m_halt_reason;
    bool m_loaded;
    u32 m_entry = RESET_VECTOR;   // 已加载程序的入口（复位后恢复到这里）
    std::set<u32> m_breakpoints;

    rv_regfile m_regfile;
    rv_memory  m_mem;

    // 最小 CSR 集合（教学用）
    std::array<u32, 4096> m_csr;

    u32 csr_read(u32 addr);
    void csr_write(u32 addr, u32 value);

    // 取一次 trap：mepc=当前指令，mcause=原因，关总闸，跳转 mtvec（mtvec=0 则停机兜底）
    void raise_trap(u32 cause, u32 mtval, cycle_state_t& out);
    // 周期收尾：写 next_pc/halted，更新 cycle/time/instret 计数 CSR，拍寄存器快照
    bool finalize_step(cycle_state_t& out);

    // 译码结果
    decoded_instr_t m_decoded;
};

}  // namespace rv32i
