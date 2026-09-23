// ============================================================================
// rv_core.cpp —— 单周期 RV32I CPU 核心实现
//
// 单周期执行模型：一个时钟周期内组合逻辑完成
//   IF → ID → RegRead → EX → MEM → WB → 更新 PC
// 无流水线寄存器、无转发、无冒险检测。
// ============================================================================

#include "rv_core.hpp"
#include "rv_elf_loader.hpp"
#include "json_writer.hpp"

#include <sstream>
#include <cstdio>

namespace rv32i {

namespace {

const char* opcode_name(u32 opcode) {
    switch (opcode) {
        case OP_LOAD:     return "LOAD";
        case OP_MISC_MEM: return "MISC-MEM";
        case OP_OP_IMM:   return "OP-IMM";
        case OP_AUIPC:    return "AUIPC";
        case OP_STORE:    return "STORE";
        case OP_OP:       return "OP";
        case OP_LUI:      return "LUI";
        case OP_BRANCH:   return "BRANCH";
        case OP_JALR:     return "JALR";
        case OP_JAL:      return "JAL";
        case OP_SYSTEM:   return "SYSTEM";
        default:          return "UNKNOWN";
    }
}

}  // namespace

// ---------------------------------------------------------------------------
// JSON 序列化（实现方案 6.3 节协议）
// ---------------------------------------------------------------------------
std::string cycle_state_to_json(const cycle_state_t& s, bool as_message) {
    std::ostringstream os;
    os << "{";
    if (as_message) os << "\"type\":\"cycle_state\",";
    os << "\"cycle\":" << s.cycle << ",";
    os << "\"state\":{";

    os << "\"pc\":\"" << hex_str(s.pc) << "\",";
    os << "\"next_pc\":\"" << hex_str(s.next_pc) << "\",";
    os << "\"instruction\":\"" << hex_str(s.instruction) << "\",";
    os << "\"disassembly\":" << json_str(s.disassembly) << ",";

    os << "\"instruction_fields\":{";
    os << "\"opcode\":\"" << bin_str(s.opcode, 7) << "\",";
    os << "\"opcode_name\":" << json_str(opcode_name(s.opcode)) << ",";
    os << "\"rd\":" << s.rd << ",";
    os << "\"funct3\":\"" << bin_str(s.funct3, 3) << "\",";
    os << "\"rs1\":" << s.rs1 << ",";
    os << "\"rs2\":" << s.rs2 << ",";
    os << "\"funct7\":\"" << bin_str(s.funct7, 7) << "\",";
    os << "\"format\":" << json_str(s.format);
    os << "},";

    os << "\"immediate\":" << s.immediate << ",";

    os << "\"control_signals\":{";
    os << "\"reg_write\":" << (s.ctrl.reg_write ? "true" : "false") << ",";
    os << "\"alu_src\":"   << (s.ctrl.alu_src   ? "true" : "false") << ",";
    os << "\"mem_write\":" << (s.ctrl.mem_write ? "true" : "false") << ",";
    os << "\"mem_read\":"  << (s.ctrl.mem_read  ? "true" : "false") << ",";
    os << "\"mem_to_reg\":"<< (s.ctrl.mem_to_reg ? "true" : "false") << ",";
    os << "\"branch\":"    << (s.ctrl.branch    ? "true" : "false") << ",";
    os << "\"jump\":"      << (s.ctrl.jump      ? "true" : "false") << ",";
    os << "\"is_auipc\":"  << (s.ctrl.is_auipc  ? "true" : "false") << ",";
    os << "\"is_lui\":"    << (s.ctrl.is_lui    ? "true" : "false") << ",";
    os << "\"is_jalr\":"   << (s.ctrl.is_jalr   ? "true" : "false") << ",";
    os << "\"alu_op\":\""  << alu_op_name(s.ctrl.alu_op) << "\"";
    os << "},";

    os << "\"reg_reads\":{";
    os << "\"rs1\":{\"index\":" << s.reg_rs1.index << ",\"value\":" << s.reg_rs1.value << "},";
    os << "\"rs2\":{\"index\":" << s.reg_rs2.index << ",\"value\":" << s.reg_rs2.value << "}";
    os << "},";

    os << "\"alu\":{";
    os << "\"op1\":"    << s.alu.op1 << ",";
    os << "\"op2\":"    << s.alu.op2 << ",";
    os << "\"result\":" << s.alu.result << ",";
    os << "\"zero\":"   << (s.alu.zero ? "true" : "false") << ",";
    os << "\"less\":"   << (s.alu.less ? "true" : "false");
    os << "},";

    os << "\"memory\":{";
    os << "\"addr\":\""        << hex_str(s.mem.addr) << "\",";
    os << "\"read_data\":\""   << hex_str(s.mem.read_data) << "\",";
    os << "\"write_data\":\""  << hex_str(s.mem.write_data) << "\",";
    os << "\"access_type\":\"" << s.mem.access_type << "\",";
    os << "\"access_size\":"   << s.mem.access_size;
    os << "},";

    os << "\"writeback\":{";
    os << "\"active\":"    << (s.wb.active ? "true" : "false") << ",";
    os << "\"reg_index\":" << s.wb.reg_index << ",";
    os << "\"data\":"      << s.wb.data << ",";
    os << "\"source\":\""  << s.wb.source << "\"";
    os << "},";

    os << "\"branch\":{";
    // 注意：这里必须是裸的 JSON 布尔（不带引号）。前端 types/simulation.ts 把它声明成
    // boolean，发成字符串 "false" 的话在 JS 里恒为真值，分支高亮会永远点亮。
    os << "\"taken\":"          << (s.branch.taken ? "true" : "false") << ",";
    os << "\"target_addr\":\""  << hex_str(s.branch.target_addr) << "\"";
    os << "},";

    os << "\"csr\":{";
    os << "\"mtvec\":\""    << hex_str(s.csr.mtvec)    << "\",";
    os << "\"mepc\":\""     << hex_str(s.csr.mepc)     << "\",";
    os << "\"mcause\":\""   << hex_str(s.csr.mcause)   << "\",";
    os << "\"mstatus\":\""  << hex_str(s.csr.mstatus)  << "\",";
    os << "\"mie\":\""      << hex_str(s.csr.mie)      << "\",";
    os << "\"mip\":\""      << hex_str(s.csr.mip)      << "\",";
    os << "\"mtime\":\""    << hex_str(s.csr.mtime)    << "\",";
    os << "\"mtimecmp\":\"" << hex_str(s.csr.mtimecmp) << "\"";
    os << "},";

    os << "\"trap\":{";
    os << "\"taken\":"  << (s.trap.taken ? "true" : "false") << ",";
    os << "\"cause\":"  << s.trap.cause << ",";
    os << "\"mepc\":\"" << hex_str(s.trap.mepc)  << "\",";
    os << "\"mtval\":\"" << hex_str(s.trap.mtval) << "\"";
    os << "},";

    os << "\"regfile\":[";
    for (int i = 0; i < 32; ++i) {
        if (i) os << ",";
        os << s.regfile[i];
    }
    os << "],";

    os << "\"halted\":" << (s.halted ? "true" : "false");
    os << "}";
    os << "}";
    return os.str();
}

// ---------------------------------------------------------------------------
// 核心
// ---------------------------------------------------------------------------
rv32i_core::rv32i_core() : m_mem(DEFAULT_MEM_SIZE, RESET_VECTOR) {
    m_csr.fill(0);
    reset();
}

void rv32i_core::reset() {
    m_pc = RESET_VECTOR;
    m_cycle = 0;
    m_halted = false;
    m_exit_code = 0;
    m_halt_reason = "";
    m_loaded = false;
    m_regfile.reset();
    m_mem.reset();
    m_csr.fill(0);
}

std::string rv32i_core::load_elf(const std::string& path) {
    auto res = rv32i::load_elf(path, m_mem);
    if (!res.ok) return res.error;
    m_pc = res.entry;
    m_loaded = true;
    m_halted = false;
    m_cycle = 0;
    return "";
}

u32 rv32i_core::csr_read(u32 addr) {
    return m_csr[addr & 0xFFF];
}

void rv32i_core::csr_write(u32 addr, u32 value) {
    // cycle/time/instret 为只读计数器
    if (addr == 0xC00 || addr == 0xC01 || addr == 0xC02) return;
    m_csr[addr & 0xFFF] = value;
}

void rv32i_core::raise_trap(u32 cause, u32 mtval, cycle_state_t& out) {
    // 填报表：本周期发生了 trap（供前端展示）
    out.trap.taken = true;
    out.trap.cause = cause;
    out.trap.mepc  = m_pc;        // 触发 trap 的指令（此刻 m_pc 还没被改成 mtvec）
    out.trap.mtval = mtval;

    m_csr[0x341] = m_pc;          // mepc   = 触发 trap 的指令地址
    m_csr[0x342] = cause;         // mcause = 原因编号
    m_csr[0x343] = mtval;         // mtval  = 附加信息
    u32 ms = m_csr[0x300];        // mstatus
    ms = (ms & ~(1u << 7)) | ((ms & (1u << 3)) << 4);   // MPIE(bit7) = MIE(bit3)，保存旧总闸
    ms &= ~(1u << 3);             // MIE = 0，关总闸（防 trap 套 trap）
    m_csr[0x300] = ms;
    u32 mtvec = m_csr[0x305];     // 处理程序入口
    if (mtvec == 0) {             // 没配置处理程序 → 停机兜底（保持旧行为兼容）
        m_halted = true;
        m_halt_reason = "未处理的 trap (mtvec=0)";
    } else {
        m_pc = mtvec;             // 跳到处理程序
    }
}

bool rv32i_core::finalize_step(cycle_state_t& out) {
    out.next_pc = m_pc;
    out.halted = m_halted;
    ++m_cycle;
    m_csr[0xC00] = static_cast<u32>(m_cycle);   // cycle
    m_csr[0xC01] = static_cast<u32>(m_cycle);   // time
    m_csr[0xC02]++;                             // instret
    out.regfile = m_regfile.raw();

    // CSR 快照：每周期把关键中断寄存器带出去（前端显示用）
    out.csr.mtvec    = m_csr[0x305];
    out.csr.mepc     = m_csr[0x341];
    out.csr.mcause   = m_csr[0x342];
    out.csr.mstatus  = m_csr[0x300];
    out.csr.mie      = m_csr[0x304];
    out.csr.mip      = m_csr[0x344];
    out.csr.mtime    = m_csr[0xC01];
    out.csr.mtimecmp = m_csr[0x780];
    return !m_halted;
}

bool rv32i_core::step(cycle_state_t& out) {
    out = cycle_state_t{};
    if (!m_loaded) {
        m_halt_reason = "未加载程序";
        out.halted = true;
        return false;
    }
    if (m_halted) {
        out.halted = true;
        return false;
    }

    out.cycle = static_cast<u32>(m_cycle);
    out.pc = m_pc;
    out.instruction = m_mem.load_word(m_pc);

    rv_instr in(out.instruction);
    m_decoded = decode(out.instruction);
    const decoded_instr_t& d = m_decoded;

    // ---------------- 译码 (ID) ----------------
    out.opcode = in.op.opcode;
    out.rd     = d.rd;
    out.funct3 = d.funct3;
    out.rs1    = d.rs1;
    out.rs2    = d.rs2;
    out.funct7 = d.funct7;
    out.format = format_str(d.format);
    out.disassembly = d.text;

    out.ctrl    = control_decode(in.op.opcode, d.funct3, d.funct7);
    out.immediate = d.imm;

    // ---------------- 计时器中断检查（异步事件，优先打断当前指令） ----------------
    // 三道门：mtime(0xC01) >= mtimecmp(0x780) && mie.MTIE(bit7) && mstatus.MIE(bit3)
    if (m_csr[0xC01] >= m_csr[0x780]
        && (m_csr[0x304] & (1u << 7))      // mie.MTIE
        && (m_csr[0x300] & (1u << 3))      // mstatus.MIE
        && !m_halted) {
        raise_trap(0x80000007u, 0, out);   // 机器计时器中断
        return finalize_step(out);
    }

    // ---------------- 非法指令异常（原因 2） ----------------
    if (d.kind == InstrKind::INVALID) {
        raise_trap(2, out.instruction, out);   // mtval = 出错的机器码
        return finalize_step(out);
    }

    // ---------------- 读寄存器 (RegRead) ----------------
    u32 rs1_val = m_regfile.read(d.rs1);
    u32 rs2_val = m_regfile.read(d.rs2);
    out.reg_rs1 = { d.rs1, rs1_val };
    out.reg_rs2 = { d.rs2, rs2_val };

    // ---------------- 执行 (EX) ----------------
    // ALU 第一操作数：LUI 用立即数；AUIPC 用 PC；其余用 rs1
    u32 op1 = out.ctrl.is_lui ? static_cast<u32>(d.imm) : rs1_val;
    if (out.ctrl.is_auipc) op1 = m_pc;
    u32 alu_in2 = out.ctrl.alu_src ? static_cast<u32>(d.imm) : rs2_val;

    out.alu.op1 = op1;
    out.alu.op2 = alu_in2;
    auto ar = alu_compute(out.ctrl.alu_op, op1, alu_in2);
    out.alu.result = ar.value;
    out.alu.zero = ar.zero;
    out.alu.less = ar.less;

    // ---------------- 分支 / 跳转目标 ----------------
    u32 target = m_pc + 4;
    bool taken = false;

    if (out.ctrl.branch) {
        target = m_pc + static_cast<u32>(d.imm);
        // taken 由 ALU 交出的两个标志位 + funct3 组出来，与图上 taken 单元的接线一一对应：
        //   base  = funct3[2] ? less : zero     funct3[2] 在「小于」与「相等」之间选一路
        //   taken = funct3[0] ? !base : base    funct3[0] 选极性，把 blt/bge、bltu/bgeu 分成一对
        // 逐条核对：
        //   000 beq →base=zero  pol=0→zero        001 bne  →base=zero  pol=1→!zero
        //   100 blt →base=less  pol=0→less        101 bge  →base=less  pol=1→!less
        //   110 bltu→base=less  pol=0→less        111 bgeu →base=less  pol=1→!less
        // 有符号/无符号的差别不在 taken 里，而在 alu_op（SLT / SLTU，见 rv_control.hpp）。
        // 原先这里是一张 switch(d.kind) 表：功能上对，但和图上那个只有 branch/zf 两个
        // 输入的 circle 完全对不上 —— 图上学不到 blt/bge 是怎么判的，属于「图错」。
        {
            const bool base = (d.funct3 & 0b100) ? ar.less : ar.zero;
            taken = (d.funct3 & 0b001) ? !base : base;
        }
        // 分支条件不满足时不得跳转，应顺序执行下一条（否则循环无法退出）
        if (!taken) target = m_pc + 4;
        out.branch.taken = taken;
        out.branch.target_addr = target;
    } else if (out.ctrl.jump) {
        target = m_pc + static_cast<u32>(d.imm);
        taken = true;
        out.branch.taken = true;
        out.branch.target_addr = target;
    } else if (out.ctrl.is_jalr) {
        target = (rs1_val + static_cast<u32>(d.imm)) & ~1u;
        taken = true;
        out.branch.taken = true;
        out.branch.target_addr = target;
    } else {
        out.branch.taken = false;
        out.branch.target_addr = m_pc + 4;
    }

    // ---------------- 访存 (MEM) ----------------
    if (out.ctrl.mem_read) {
        u32 addr = out.alu.result;
        u32 rdata = 0;
        u32 size = 0;
        switch (d.kind) {
            case InstrKind::LW:  rdata = m_mem.load_word(addr); size = 4; break;
            case InstrKind::LH:  rdata = m_mem.load_half(addr); size = 2; break;
            case InstrKind::LB:  rdata = m_mem.load_byte(addr); size = 1; break;
            case InstrKind::LHU: rdata = m_mem.load_half_u(addr); size = 2; break;
            case InstrKind::LBU: rdata = m_mem.load_byte_u(addr); size = 1; break;
            default: break;
        }
        out.mem.addr = addr;
        out.mem.read_data = rdata;
        out.mem.access_type = "READ";
        out.mem.access_size = size;
    } else if (out.ctrl.mem_write) {
        u32 addr = out.alu.result;
        u32 wdata = rs2_val;
        u32 size = 0;
        switch (d.kind) {
            case InstrKind::SW: m_mem.store_word(addr, wdata); size = 4; break;
            case InstrKind::SH: m_mem.store_half(addr, static_cast<u16>(wdata)); size = 2; break;
            case InstrKind::SB: m_mem.store_byte(addr, static_cast<u8>(wdata)); size = 1; break;
            default: break;
        }
        out.mem.addr = addr;
        out.mem.write_data = wdata;
        out.mem.access_type = "WRITE";
        out.mem.access_size = size;
    }

    // ---------------- 写回 (WB) ----------------
    if (out.ctrl.mem_to_reg) {
        out.wb.source = "MEM";
        out.wb.data = out.mem.read_data;
    } else if (out.ctrl.jump || out.ctrl.is_jalr) {
        out.wb.source = "PC_PLUS_4";
        out.wb.data = m_pc + 4;
    } else {
        out.wb.source = "ALU";
        out.wb.data = out.alu.result;
    }
    out.wb.active = out.ctrl.reg_write && d.rd != 0;
    out.wb.reg_index = d.rd;
    if (out.wb.active) m_regfile.write(d.rd, out.wb.data);

    // ---------------- 系统指令（ECALL / EBREAK / MRET / CSR） ----------------
    if (in.op.opcode == OP_SYSTEM) {
        if (d.kind == InstrKind::ECALL) {
            // ecall → 机器模式环境调用异常（原因 11）。不再直接停机，而是进 trap
            raise_trap(11, 0, out);
            return finalize_step(out);
        } else if (d.kind == InstrKind::EBREAK) {
            // ebreak → 断点异常（原因 3）
            raise_trap(3, 0, out);
            return finalize_step(out);
        } else if (d.kind == InstrKind::MRET) {
            // mret：从处理程序返回 —— PC = mepc；MIE = MPIE（恢复总闸）
            m_pc = m_csr[0x341];          // 跳到 mepc 记的返回地址
            u32 ms = m_csr[0x300];
            ms = (ms & ~(1u << 3)) | ((ms & (1u << 7)) >> 4);   // MIE = MPIE（bit3 ← bit7）
            m_csr[0x300] = ms;
            return finalize_step(out);
        } else {
            // CSR 指令
            u32 csr_addr = d.csr;
            u32 old = csr_read(csr_addr);
            // 修正 bug：寄存器版(csrrw/csrrs/csrrc) 应取 rs1 寄存器的"值"；
            // 立即数版(csrrwi/csrrsi/csrrci) 才把 rs1 字段当 5 位立即数
            const bool reg_variant = (d.funct3 & 0b100) == 0;
            u32 src = reg_variant ? m_regfile.read(d.rs1) : d.rs1;
            u32 wv = old;
            bool do_write = false;
            switch (d.funct3) {
                case 0b001: wv = src; do_write = true; break;            // CSRRW
                case 0b010: wv = old | src; do_write = (src != 0); break;// CSRRS
                case 0b011: wv = old & ~src; do_write = (src != 0); break;// CSRRC
                case 0b101: wv = src; do_write = true; break;            // CSRRWI
                case 0b110: wv = old | src; do_write = (src != 0); break;// CSRRSI
                case 0b111: wv = old & ~src; do_write = (src != 0); break;// CSRRCI
                default: break;
            }
            if (do_write) csr_write(csr_addr, wv);
            out.wb.source = "CSR";
            // CSR 指令同样经寄存器写回（rd 拿到旧值）。主译码对 OP_SYSTEM 一律保持
            // 全 0（rv_control.hpp 的 case OP_SYSTEM），所以这里必须自己补上 reg_write
            // —— 否则图上「寄存器写使能」与写地址线灭着，而寄存器其实真的被改了。
            out.ctrl.reg_write = (d.rd != 0);
            out.wb.active = d.rd != 0;
            out.wb.reg_index = d.rd;
            out.wb.data = old;
            if (d.rd != 0) m_regfile.write(d.rd, old);
            m_pc = target;
            return finalize_step(out);
        }
    }

    // ---------------- 更新 PC ----------------
    m_pc = target;
    return finalize_step(out);
}

}  // namespace rv32i
