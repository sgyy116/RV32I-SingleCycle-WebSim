#pragma once
// ============================================================================
// json_writer.hpp —— JSON 输出辅助工具（轻量，无第三方依赖）
// ============================================================================

#include <string>
#include <sstream>
#include <iomanip>
#include <cstdio>
#include <cstdint>

namespace rv32i {

// 字符串 JSON 转义
inline std::string json_escape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += c;
                }
        }
    }
    return out;
}

inline std::string json_str(const std::string& s) {
    return "\"" + json_escape(s) + "\"";
}

// 十六进制字符串（不带引号，如 0x80000100）
inline std::string hex_str(std::uint32_t v) {
    char buf[16];
    std::snprintf(buf, sizeof(buf), "0x%08x", v);
    return buf;
}

// 二进制字符串（如 0b0110011）
inline std::string bin_str(std::uint32_t v, int bits) {
    std::string s = "0b";
    for (int i = bits - 1; i >= 0; --i) {
        s += ((v >> i) & 1) ? '1' : '0';
    }
    return s;
}

// 用于把值拼进 JSON 的数字（十进制）
inline std::string dec_str(std::uint64_t v) {
    return std::to_string(v);
}

}  // namespace rv32i
