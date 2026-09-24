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
                    d.kind = InstrKind::SLLI; d.mnemonic = "slli";
                    d.imm = static_cast<i32>(d.rs2 & 31);
                    break;
                case 0b101:
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
            d.kind = InstrKind::FENCE; d.format = Format::I;
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

    if (d.kind == InstrKind::INVALID && d.mnemonic.empty()) {
        d.mnemonic = "invalid";
        if (d.text.empty()) d.text = ".word " + fmt_hex(bits);
    }
    return d;
}

}  // namespace rv32i
