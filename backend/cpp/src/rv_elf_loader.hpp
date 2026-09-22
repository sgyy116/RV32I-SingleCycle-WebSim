#pragma once
// ============================================================================
// rv_elf_loader.hpp —— ELF 加载器（解析 ELF32 header + PT_LOAD 段并写入内存）
// ============================================================================

#include <string>
#include <vector>
#include <fstream>
#include <stdexcept>

#ifdef _WIN32
#include <windows.h>
#endif

#include "rv_common.hpp"
#include "rv_memory.hpp"

namespace rv32i {

inline constexpr u16 EM_RISCV = 243;

struct elf_load_result_t {
    u32 entry = RESET_VECTOR;
    std::string arch = "RV32I";
    bool ok = false;
    std::string error;
};

namespace detail {

struct Elf32_Ehdr {
    u8  e_ident[16];
    u16 e_type;
    u16 e_machine;
    u32 e_version;
    u32 e_entry;
    u32 e_phoff;
    u32 e_shoff;
    u32 e_flags;
    u16 e_ehsize;
    u16 e_phentsize;
    u16 e_phnum;
    u16 e_shentsize;
    u16 e_shnum;
    u16 e_shstrndx;
};

struct Elf32_Phdr {
    u32 p_type;
    u32 p_offset;
    u32 p_vaddr;
    u32 p_paddr;
    u32 p_filesz;
    u32 p_memsz;
    u32 p_flags;
    u32 p_align;
};

inline u16 rd_le16(const u8* p) { return static_cast<u16>(p[0]) | (static_cast<u16>(p[1]) << 8); }
inline u32 rd_le32(const u8* p) {
    return static_cast<u32>(p[0]) | (static_cast<u32>(p[1]) << 8) |
           (static_cast<u32>(p[2]) << 16) | (static_cast<u32>(p[3]) << 24);
}

// 按 UTF-8 路径读取整个文件（Windows 上 std::ifstream 不支持中文路径，改用宽字符 API）
inline std::vector<u8> read_file(const std::string& path, bool& ok) {
    ok = false;
#ifdef _WIN32
    int wlen = MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, nullptr, 0);
    if (wlen <= 0) return {};
    std::wstring wpath(static_cast<std::size_t>(wlen - 1), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, &wpath[0], wlen);

    HANDLE h = CreateFileW(wpath.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return {};

    std::vector<u8> data;
    LARGE_INTEGER sz;
    if (GetFileSizeEx(h, &sz) && sz.QuadPart > 0) {
        data.resize(static_cast<std::size_t>(sz.QuadPart));
        std::size_t total = 0;
        DWORD r = 0;
        while (total < data.size() &&
               ReadFile(h, data.data() + total,
                        static_cast<DWORD>(data.size() - total), &r, nullptr) &&
               r > 0) {
            total += r;
        }
        if (total != data.size()) { ok = false; CloseHandle(h); return {}; }
    }
    CloseHandle(h);
    ok = true;
    return data;
#else
    std::ifstream file(path, std::ios::binary);
    if (!file) return {};
    std::vector<u8> data((std::istreambuf_iterator<char>(file)),
                         std::istreambuf_iterator<char>());
    ok = true;
    return data;
#endif
}

}  // namespace detail

// 从 ELF 文件加载程序段；若文件不是合法 ELF，则尝试按裸二进制加载到基址
inline elf_load_result_t load_elf(const std::string& path, rv_memory& mem) {
    elf_load_result_t result;
    bool file_ok = false;
    std::vector<u8> data = detail::read_file(path, file_ok);
    if (!file_ok) {
        result.error = "无法打开文件: " + path;
        return result;
    }

    // 判断是否为 ELF（魔数）；非 ELF 一律按裸二进制加载（修复：不再要求 ≥16 字节）
    const bool is_elf =
        data.size() >= 4 &&
        data[0] == 0x7F && data[1] == 'E' && data[2] == 'L' && data[3] == 'F';

    if (!is_elf) {
        // 裸二进制：直接加载到基址（任意大小，含小文件）
        if (data.size() > mem.size()) {
            result.error = "裸二进制文件过大: " + std::to_string(data.size()) + " 字节";
            return result;
        }
        mem.reset();
        mem.write_raw(mem.base(), data.data(), data.size());
        result.entry = mem.base();
        result.arch = "RAW";
        result.ok = true;
        return result;
    }

    // 确认是 ELF 后：头部至少 16 字节才能解析
    if (data.size() < 16) {
        result.error = "文件过小，不是有效的 ELF";
        return result;
    }

    const u8* raw = data.data();
    detail::Elf32_Ehdr hdr;
    hdr.e_ident[0] = raw[0];
    // EI_CLASS 在 e_ident[4]：1=ELF32
    const u8 ei_class = raw[4];
    const u8 ei_data  = raw[5];   // 1 = little-endian
    hdr.e_type    = detail::rd_le16(raw + 16);
    hdr.e_machine = detail::rd_le16(raw + 18);
    hdr.e_version = detail::rd_le32(raw + 20);
    hdr.e_entry   = detail::rd_le32(raw + 24);
    hdr.e_phoff   = detail::rd_le32(raw + 28);
    hdr.e_shoff   = detail::rd_le32(raw + 32);
    hdr.e_flags   = detail::rd_le32(raw + 36);
    hdr.e_ehsize  = detail::rd_le16(raw + 40);
    hdr.e_phentsize = detail::rd_le16(raw + 42);
    hdr.e_phnum     = detail::rd_le16(raw + 44);

    if (ei_class != 1) {
        result.error = "仅支持 ELF32（RV32I），检测到 ELF64";
        return result;
    }
    if (ei_data != 1) {
        result.error = "仅支持小端 ELF";
        return result;
    }
    if (hdr.e_machine != EM_RISCV) {
        result.error = "非 RISC-V 架构 (e_machine=" + std::to_string(hdr.e_machine) + ")";
        return result;
    }
    if (hdr.e_phentsize < sizeof(detail::Elf32_Phdr) || hdr.e_phnum == 0) {
        result.error = "无有效的程序头";
        return result;
    }

    mem.reset();

    // 逐段加载 PT_LOAD
    bool loaded = false;
    for (u16 i = 0; i < hdr.e_phnum; ++i) {
        u32 ph_off = hdr.e_phoff + i * hdr.e_phentsize;
        if (ph_off + sizeof(detail::Elf32_Phdr) > data.size()) break;

        const u8* p = raw + ph_off;
        detail::Elf32_Phdr ph;
        ph.p_type   = detail::rd_le32(p + 0);
        ph.p_offset = detail::rd_le32(p + 4);
        ph.p_vaddr  = detail::rd_le32(p + 8);
        ph.p_paddr  = detail::rd_le32(p + 12);
        ph.p_filesz = detail::rd_le32(p + 16);
        ph.p_memsz  = detail::rd_le32(p + 20);
        ph.p_flags  = detail::rd_le32(p + 24);
        ph.p_align  = detail::rd_le32(p + 28);

        if (ph.p_type != 1) continue;   // 仅 PT_LOAD

        if (!mem.in_range(ph.p_vaddr)) {
            result.error = "段地址越界: 0x" + [](u32 v) -> std::string {
                char buf[16]; std::snprintf(buf, sizeof(buf), "%08X", v); return buf;
            }(ph.p_vaddr);
            return result;
        }
        if (ph.p_offset + ph.p_filesz > data.size()) {
            result.error = "段数据超出文件范围";
            return result;
        }
        if (ph.p_filesz > ph.p_memsz || ph.p_memsz > mem.size()) {
            result.error = "段大小非法";
            return result;
        }

        mem.write_raw(ph.p_vaddr, data.data() + ph.p_offset, ph.p_filesz);
        // 剩余 memsz - filesz 填充为 0（write_raw 前已 reset 全 0）
        loaded = true;
    }

    if (!loaded) {
        result.error = "ELF 中没有可加载的 PT_LOAD 段";
        return result;
    }

    result.entry = hdr.e_entry;
    result.arch = "RV32I";
    result.ok = true;
    return result;
}

}  // namespace rv32i
