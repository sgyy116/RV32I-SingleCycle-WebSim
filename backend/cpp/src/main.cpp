// ============================================================================
// main.cpp —— stdin/stdout JSON 命令循环（模拟器可执行文件入口）
//
// 与 Python 中间层通过「逐行 JSON」通信：
//   请求: {"cmd":"step"} / {"cmd":"load_elf","path":"..."} / ...
//   响应: {"type":"cycle_state", ...} / {"status":"ok", ...} / ...
// ============================================================================

#include <iostream>
#include <string>
#include <vector>
#include <cstdlib>
#include <cstring>

#include <unistd.h>
#ifndef _WIN32
#include <poll.h>
#endif
#ifdef _WIN32
#include <windows.h>
#endif

#include "rv_core.hpp"
#include "json_writer.hpp"

using namespace rv32i;

// ---------------------------------------------------------------------------
// 极简 JSON 字段提取（不引入第三方依赖，足够满足本协议）
// ---------------------------------------------------------------------------
namespace json {

// 从 pos 起跳过空白
inline std::size_t skip_ws(const std::string& s, std::size_t pos) {
    while (pos < s.size() && (s[pos] == ' ' || s[pos] == '\t' || s[pos] == '\n' || s[pos] == '\r'))
        ++pos;
    return pos;
}

std::string field_str(const std::string& s, const std::string& key) {
    const std::string pat = "\"" + key + "\":";
    std::size_t pos = s.find(pat);
    if (pos == std::string::npos) return "";
    pos = skip_ws(s, pos + pat.size());
    if (pos >= s.size() || s[pos] != '"') return "";
    ++pos;
    std::size_t end = s.find('"', pos);
    if (end == std::string::npos) return "";
    return s.substr(pos, end - pos);
}

// 提取数字或 0x 十六进制字段的原始文本
std::string field_raw(const std::string& s, const std::string& key) {
    const std::string pat = "\"" + key + "\":";
    std::size_t pos = s.find(pat);
    if (pos == std::string::npos) return "";
    pos = skip_ws(s, pos + pat.size());
    std::size_t end = s.find_first_of(",}", pos);
    if (end == std::string::npos) return s.substr(pos);
    return s.substr(pos, end - pos);
}

u32 field_u32(const std::string& s, const std::string& key, u32 def = 0) {
    std::string raw = field_raw(s, key);
    if (raw.empty()) return def;
    // 去除可能存在的引号（字符串形式的十六进制地址）
    if (raw.front() == '"') raw.erase(raw.begin());
    if (!raw.empty() && raw.back() == '"') raw.pop_back();
    try {
        return static_cast<u32>(std::stoul(raw, nullptr, 0));
    } catch (...) {
        return def;
    }
}

}  // namespace json

// ---------------------------------------------------------------------------
// 非阻塞读取 stdin 中可用的完整行（供 run 期间检测 pause）
// ---------------------------------------------------------------------------
static std::string g_input_buffer;

static std::vector<std::string> read_available_lines() {
    std::vector<std::string> lines;
    char buf[4096];
#ifdef _WIN32
    // Windows: 用 PeekNamedPipe "偷看" stdin 管道里有没有数据（不阻塞）
    HANDLE h = GetStdHandle(STD_INPUT_HANDLE);
    DWORD avail = 0;
    if (h == INVALID_HANDLE_VALUE) return lines;
    if (!PeekNamedPipe(h, nullptr, 0, nullptr, &avail, nullptr)) return lines;
    if (avail == 0) return lines;
    if (avail > sizeof(buf)) avail = sizeof(buf);
    DWORD n = 0;
    if (!ReadFile(h, buf, avail, &n, nullptr) || n == 0) return lines;
    g_input_buffer.append(buf, static_cast<std::size_t>(n));
#else
    // Linux/POSIX: 用 poll 非阻塞检查 stdin 是否可读
    while (true) {
        struct pollfd pfd{0, POLLIN, 0};
        int r = poll(&pfd, 1, 0);
        if (r <= 0) break;
        ssize_t n = read(0, buf, sizeof(buf));
        if (n <= 0) break;
        g_input_buffer.append(buf, static_cast<std::size_t>(n));
    }
#endif
    std::size_t pos;
    while ((pos = g_input_buffer.find('\n')) != std::string::npos) {
        std::string line = g_input_buffer.substr(0, pos);
        g_input_buffer.erase(0, pos + 1);
        if (!line.empty()) lines.push_back(line);
    }
    return lines;
}

int main() {
    rv32i_core core;
    std::string line;

    while (true) {
        if (!std::getline(std::cin, line)) break;
        if (line.empty()) continue;

        const std::string cmd = json::field_str(line, "cmd");

        if (cmd == "shutdown" || cmd == "quit") {
            std::cout << "{\"type\":\"bye\"}\n";
            std::cout.flush();
            break;
        }
        else if (cmd == "load_elf") {
            std::string path = json::field_str(line, "path");
            std::string err = core.load_elf(path);
            if (err.empty()) {
                std::cout << "{\"status\":\"ok\",\"entry\":\""
                          << hex_str(core.pc()) << "\",\"arch\":\"RV32I\"}\n";
            } else {
                std::cout << "{\"status\":\"error\",\"message\":\""
                          << json_escape(err) << "\"}\n";
            }
            std::cout.flush();
        }
        else if (cmd == "reset") {
            core.reset();
            std::cout << "{\"status\":\"ok\"}\n";
            std::cout.flush();
        }
        else if (cmd == "step") {
            cycle_state_t st;
            core.step(st);
            std::cout << cycle_state_to_json(st, true) << "\n";
            std::cout.flush();
        }
        else if (cmd == "run") {
            // 连续运行：逐周期流式输出 cycle_state，直到停机 / 断点 / pause
            u32 max_cycles = json::field_u32(line, "max_cycles", 100000);
            bool paused = false;
            u32 executed = 0;
            while (!core.halted() && executed < max_cycles) {
                cycle_state_t st;
                core.step(st);
                std::cout << cycle_state_to_json(st, true) << "\n";
                std::cout.flush();
                ++executed;

                if (st.halted) break;
                if (core.breakpoint_hit(st.next_pc)) {
                    std::cout << "{\"type\":\"breakpoint_hit\",\"addr\":\""
                              << hex_str(st.next_pc) << "\",\"cycle\":" << st.cycle << "}\n";
                    std::cout.flush();
                    break;
                }

                // 检查是否有 pause 或其他命令注入
                for (auto& l : read_available_lines()) {
                    const std::string c2 = json::field_str(l, "cmd");
                    if (c2 == "pause") paused = true;
                }
                if (paused) break;
            }
            if (paused) {
                std::cout << "{\"type\":\"paused\",\"cycle\":" << core.cycle() << "}\n";
            }
            std::cout.flush();
        }
        else if (cmd == "set_breakpoint") {
            u32 addr = json::field_u32(line, "addr");
            core.set_breakpoint(addr);
            std::cout << "{\"status\":\"ok\"}\n";
            std::cout.flush();
        }
        else if (cmd == "clear_breakpoint") {
            u32 addr = json::field_u32(line, "addr");
            core.clear_breakpoint(addr);
            std::cout << "{\"status\":\"ok\"}\n";
            std::cout.flush();
        }
        else if (cmd == "get_state") {
            cycle_state_t st;
            // 只读快照：不推进 CPU（旧行为会偷偷执行一条指令）
            core.snapshot(st);
            std::cout << cycle_state_to_json(st, true) << "\n";
            std::cout.flush();
        }
        else if (cmd == "get_memory") {
            u32 addr = json::field_u32(line, "addr");
            u32 count = json::field_u32(line, "count", 16);
            std::cout << "{\"type\":\"memory_dump\",\"addr\":\""
                      << hex_str(addr) << "\",\"bytes\":[";
            for (u32 i = 0; i < count; ++i) {
                if (i) std::cout << ",";
                std::cout << static_cast<u32>(core.mem().read_byte_raw(addr + i));
            }
            std::cout << "]}\n";
            std::cout.flush();
        }
        else if (cmd == "get_registers") {
            const auto& regs = core.regfile().raw();
            std::cout << "{\"type\":\"registers\",\"regs\":[";
            for (int i = 0; i < 32; ++i) {
                if (i) std::cout << ",";
                std::cout << regs[i];
            }
            std::cout << "]}\n";
            std::cout.flush();
        }
        else if (cmd == "disassemble") {
            // 反汇编一段内存，供前端显示完整指令列表
            u32 start = json::field_u32(line, "start", core.pc());
            u32 count = json::field_u32(line, "count", 128);
            std::cout << "{\"type\":\"disassembly\",\"start\":\""
                      << hex_str(start) << "\",\"instructions\":[";
            for (u32 i = 0; i < count; ++i) {
                u32 addr = start + i * 4;
                u32 word = core.mem().load_word(addr);
                auto d = decode(word);
                if (i) std::cout << ",";
                std::cout << "{\"pc\":\"" << hex_str(addr)
                          << "\",\"bytes\":\"" << hex_str(word)
                          << "\",\"text\":\"" << json_escape(d.text) << "\"}";
            }
            std::cout << "]}\n";
            std::cout.flush();
        }
        else {
            std::cout << "{\"status\":\"error\",\"message\":\"unknown command\"}\n";
            std::cout.flush();
        }
    }

    return 0;
}
