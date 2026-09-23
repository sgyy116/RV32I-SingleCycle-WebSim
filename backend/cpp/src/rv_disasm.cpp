// ============================================================================
// rv_disasm.cpp —— 反汇编器实现
// ============================================================================

#include "rv_disasm.hpp"
#include "rv_immgen.hpp"

#include <sstream>
#include <cstdio>

namespace rv32i {

namespace {

std::string fmt_hex(u32 v) {
    char buf[16];
    std::snprintf(buf, sizeof(buf), "0x%x", v);
    return buf;
}

const char* csr_name(u32 csr) {
    switch (csr) {
        case 0xC00: return "cycle";
        case 0xC01: return "time";
        case 0xC02: return "instret";
        case 0x300: return "mstatus";
        case 0x301: return "misa";
        case 0x304: return "mie";
        case 0x305: return "mtvec";
        case 0x340: return "mscratch";
        case 0x341: return "mepc";
        case 0x342: return "mcause";
        case 0x343: return "mtval";
        case 0x344: return "mip";
        case 0x780: return "mtimecmp";   // 模拟器自定义：计时器闹钟值
        default: return nullptr;
    }
}

}  // namespace

decoded_instr_t decode(u32 bits) {
    rv_instr in(bits);
    decoded_instr_t d;
    d.funct3 = in.r.funct3;
    d.funct7 = in.r.funct7;
    d.rd = in.r.rd;
    d.rs1 = in.r.rs1;
    d.rs2 = in.r.rs2;

    switch (in.op.opcode) {
        case OP_LUI:
            d.kind = InstrKind::LUI; d.format = Format::U;
            d.imm = imm_gen(in, Format::U);
            d.mnemonic = "lui";
            { std::ostringstream os; os << "lui " << reg_name(d.rd) << ", " << d.imm;
              d.text = os.str(); }
            break;

        case OP_AUIPC:
            d.kind = InstrKind::AUIPC; d.format = Format::U;
            d.imm = imm_gen(in, Format::U);
            d.mnemonic = "auipc";
            { std::ostringstream os; os << "auipc " << reg_name(d.rd) << ", " << d.imm;
              d.text = os.str(); }
            break;

        case OP_JAL:
            d.kind = InstrKind::JAL; d.format = Format::J;
            d.imm = imm_gen(in, Format::J);
            d.mnemonic = "jal";
            { std::ostringstream os; os << "jal " << reg_name(d.rd) << ", " << d.imm;
              d.text = os.str(); }
            break;

        case OP_JALR:
            d.kind = InstrKind::JALR; d.format = Format::I;
            d.imm = imm_gen(in, Format::I);
            // 规范对 JALR 只定义 funct3=000，其余取值是保留编码 ⇒ 非法指令。
            // （差分测试实测：修之前 funct3=1..7 被当合法 JALR 执行，学生拿到的是
            //  一条「能跑但规范没定义」的指令，而不是非法指令异常。）
            if (d.funct3 != 0b000) { d.kind = InstrKind::INVALID; d.mnemonic = "invalid"; break; }
            d.mnemonic = "jalr";
            { std::ostringstream os; os << "jalr " << reg_name(d.rd) << ", " << d.imm
                << "(" << reg_name(d.rs1) << ")";
              d.text = os.str(); }
            break;

        case OP_BRANCH: {
            d.format = Format::B;
            d.imm = imm_gen(in, Format::B);
            switch (d.funct3) {
                case 0b000: d.kind = InstrKind::BEQ;  d.mnemonic = "beq";  break;
                case 0b001: d.kind = InstrKind::BNE;  d.mnemonic = "bne";  break;
                case 0b100: d.kind = InstrKind::BLT;  d.mnemonic = "blt";  break;
                case 0b101: d.kind = InstrKind::BGE;  d.mnemonic = "bge";  break;
                case 0b110: d.kind = InstrKind::BLTU; d.mnemonic = "bltu"; break;
                case 0b111: d.kind = InstrKind::BGEU; d.mnemonic = "bgeu"; break;
                default: d.kind = InstrKind::INVALID; break;
            }
            { std::ostringstream os; os << d.mnemonic << " " << reg_name(d.rs1) << ", "
                << reg_name(d.rs2) << ", " << d.imm;
              d.text = os.str(); }
            break;
        }

        case OP_LOAD: {
            d.format = Format::I;
            d.imm = imm_gen(in, Format::I);
            switch (d.funct3) {
                case 0b000: d.kind = InstrKind::LB;  d.mnemonic = "lb";  break;
                case 0b001: d.kind = InstrKind::LH;  d.mnemonic = "lh";  break;
                case 0b010: d.kind = InstrKind::LW;  d.mnemonic = "lw";  break;
                case 0b100: d.kind = InstrKind::LBU; d.mnemonic = "lbu"; break;
                case 0b101: d.kind = InstrKind::LHU; d.mnemonic = "lhu"; break;
                default: d.kind = InstrKind::INVALID; break;
            }
            { std::ostringstream os; os << d.mnemonic << " " << reg_name(d.rd) << ", "
                << d.imm << "(" << reg_name(d.rs1) << ")";
              d.text = os.str(); }
            break;
        }

        case OP_STORE: {
            d.format = Format::S;
            d.imm = imm_gen(in, Format::S);
            switch (d.funct3) {
                case 0b000: d.kind = InstrKind::SB; d.mnemonic = "sb"; break;
                case 0b001: d.kind = InstrKind::SH; d.mnemonic = "sh"; break;
                case 0b010: d.kind = InstrKind::SW; d.mnemonic = "sw"; break;
                default: d.kind = InstrKind::INVALID; break;
            }
            { std::ostringstream os; os << d.mnemonic << " " << reg_name(d.rs2) << ", "
                << d.imm << "(" << reg_name(d.rs1) << ")";
              d.text = os.str(); }
            break;
        }

        case OP_OP_IMM: {
            d.format = Format::I;
            d.imm = imm_gen(in, Format::I);
            switch (d.funct3) {
                case 0b000: d.kind = InstrKind::ADDI;  d.mnemonic = "addi";  break;
                case 0b010: d.kind = InstrKind::SLTI;  d.mnemonic = "slti";  break;
                case 0b011: d.kind = InstrKind::SLTIU; d.mnemonic = "sltiu"; break;
                case 0b100: d.kind = InstrKind::XORI;  d.mnemonic = "xori";  break;
                case 0b110: d.kind = InstrKind::ORI;   d.mnemonic = "ori";   break;
                case 0b111: d.kind = InstrKind::ANDI;  d.mnemonic = "andi";  break;
                case 0b001:
                    // 移位是「shamtw 型」：RV32 只有 5 位 shamt，bits[31:25] 必须为 0。
                    // 原先完全不看 funct7，保留编码也被当成了合法 slli。
                    // 注意只有移位这两例要看 funct7 —— 上面 addi/slti/... 的 funct7
                    // 其实就是立即数的高 7 位，取值自由，不能一起卡死。
                    if (d.funct7 != 0x00) { d.kind = InstrKind::INVALID; break; }
                    d.kind = InstrKind::SLLI; d.mnemonic = "slli";
                    d.imm = static_cast<i32>(d.rs2 & 31);
                    break;
                case 0b101:
                    // srli / srai 靠 funct7 区分（0x00 / 0x20），其余取值一律非法
                    if (d.funct7 != 0x00 && d.funct7 != 0x20) {
                        d.kind = InstrKind::INVALID; break;
                    }
                    if (d.funct7 == 0x20) { d.kind = InstrKind::SRAI; d.mnemonic = "srai"; }
                    else                  { d.kind = InstrKind::SRLI; d.mnemonic = "srli"; }
                    d.imm = static_cast<i32>(d.rs2 & 31);
                    break;
                default: d.kind = InstrKind::INVALID; break;
            }
            { std::ostringstream os; os << d.mnemonic << " " << reg_name(d.rd) << ", "
                << reg_name(d.rs1) << ", " << d.imm;
              d.text = os.str(); }
            break;
        }

        case OP_OP: {
            d.format = Format::R;
            // RV32I 的 R 型只有两种合法 funct7：0x00（十条里的八条）与 0x20（仅 sub/sra）。
            // 原实现除 sub/sra 外完全不看 funct7 —— RV32M 的 mul/div/rem（funct7=0x01）
            // 会被**静默当成 add/sll/slt/... 执行**：不报错，只是算出一个错值。
            // 「不报错的错值」比报错难查得多。这里按 RV32I 收口，不合法的编码交给
            // rv_core 统一按非法指令处理（mcause=2，mtval=机器码）。
            if (d.funct7 != 0x00 &&
                !(d.funct7 == 0x20 && (d.funct3 == 0b000 || d.funct3 == 0b101))) {
                d.kind = InstrKind::INVALID;
                break;
            }
            switch (d.funct3) {
                case 0b000: d.kind = (d.funct7 == 0x20) ? InstrKind::SUB : InstrKind::ADD;
                            d.mnemonic = (d.funct7 == 0x20) ? "sub" : "add"; break;
                case 0b001: d.kind = InstrKind::SLL; d.mnemonic = "sll"; break;
                case 0b010: d.kind = InstrKind::SLT; d.mnemonic = "slt"; break;
                case 0b011: d.kind = InstrKind::SLTU; d.mnemonic = "sltu"; break;
                case 0b100: d.kind = InstrKind::XOR; d.mnemonic = "xor"; break;
                case 0b101: d.kind = (d.funct7 == 0x20) ? InstrKind::SRA : InstrKind::SRL;
                            d.mnemonic = (d.funct7 == 0x20) ? "sra" : "srl"; break;
                case 0b110: d.kind = InstrKind::OR; d.mnemonic = "or"; break;
                case 0b111: d.kind = InstrKind::AND; d.mnemonic = "and"; break;
                default: d.kind = InstrKind::INVALID; break;
            }
            { std::ostringstream os; os << d.mnemonic << " " << reg_name(d.rd) << ", "
                << reg_name(d.rs1) << ", " << reg_name(d.rs2);
              d.text = os.str(); }
            break;
        }

        case OP_MISC_MEM:
            d.format = Format::I;
            // 规范只定义 funct3=000(FENCE) 与 001(FENCE.I)，其余是保留编码 ⇒ 非法指令。
            // FENCE.I 在本核心上是空操作，与 FENCE 同处理即可（不必单列一种 kind）。
            if (d.funct3 > 0b001) { d.kind = InstrKind::INVALID; d.mnemonic = "invalid"; break; }
            d.kind = InstrKind::FENCE;
            d.mnemonic = "fence"; d.text = "fence";
            break;

        case OP_SYSTEM: {
            d.format = Format::I;
            d.csr = (bits >> 20) & 0xFFF;
            d.rs1 = (bits >> 15) & 0x1F;
            if (d.funct3 == 0 && d.rd == 0 && d.rs1 == 0) {
                // 系统指令：按高 12 位区分 ecall / ebreak / mret
                u32 sys = (bits >> 20) & 0xFFF;
                if (sys == 0x000) { d.kind = InstrKind::ECALL; d.mnemonic = "ecall"; d.text = "ecall"; }
                else if (sys == 0x001) { d.kind = InstrKind::EBREAK; d.mnemonic = "ebreak"; d.text = "ebreak"; }
                else if (sys == 0x302) { d.kind = InstrKind::MRET; d.mnemonic = "mret"; d.text = "mret"; }
                else { d.kind = InstrKind::INVALID; d.mnemonic = "invalid"; }
            } else {
                const char* nm = csr_name(d.csr);
                std::string csr_str = nm ? nm : fmt_hex(d.csr);
                switch (d.funct3) {
                    case 0b001:
                        d.kind = InstrKind::CSRRW;
                        d.mnemonic = "csrrw";
                        { std::ostringstream os; os << "csrrw " << reg_name(d.rd) << ", "
                            << csr_str << ", " << reg_name(d.rs1);
                          d.text = os.str(); }
                        break;
                    case 0b010:
                        d.kind = InstrKind::CSRRS;
                        d.mnemonic = "csrrs";
                        { std::ostringstream os; os << "csrrs " << reg_name(d.rd) << ", "
                            << csr_str << ", " << reg_name(d.rs1);
                          d.text = os.str(); }
                        break;
                    case 0b011:
                        d.kind = InstrKind::CSRRC;
                        d.mnemonic = "csrrc";
                        { std::ostringstream os; os << "csrrc " << reg_name(d.rd) << ", "
                            << csr_str << ", " << reg_name(d.rs1);
                          d.text = os.str(); }
                        break;
                    case 0b101:
                        d.kind = InstrKind::CSRRWI;
                        d.mnemonic = "csrrwi";
                        { std::ostringstream os; os << "csrrwi " << reg_name(d.rd) << ", "
                            << csr_str << ", " << d.rs1;
                          d.text = os.str(); }
                        break;
                    case 0b110:
                        d.kind = InstrKind::CSRRSI;
                        d.mnemonic = "csrrsi";
                        { std::ostringstream os; os << "csrrsi " << reg_name(d.rd) << ", "
                            << csr_str << ", " << d.rs1;
                          d.text = os.str(); }
                        break;
                    case 0b111:
                        d.kind = InstrKind::CSRRCI;
                        d.mnemonic = "csrrci";
                        { std::ostringstream os; os << "csrrci " << reg_name(d.rd) << ", "
                            << csr_str << ", " << d.rs1;
                          d.text = os.str(); }
                        break;
                    default: d.kind = InstrKind::INVALID; break;
                }
            }
            break;
        }

        default:
            d.kind = InstrKind::INVALID;
            d.text = ".word " + fmt_hex(bits);
            break;
    }

    // 非法编码的展示文本一律统一成 `.word 0x…`。
    // OP_BRANCH / OP_LOAD / OP_STORE / OP_OP_IMM / OP_OP 五个 default 只置了 kind
    // 没置 mnemonic，而紧随其后的 ostringstream 块是**无条件执行**的，于是 text 会
    // 变成 `" a0, a1, 8"` —— 一条没有指令名的操作数列表。原先这里用 text.empty()
    // 判断是否覆盖，正好被这个「非空的垃圾文本」绕过，学生看到的就是那串残片。
    if (d.kind == InstrKind::INVALID) {
        d.mnemonic = "invalid";
        d.text = ".word " + fmt_hex(bits);
    }
    return d;
}

}  // namespace rv32i
