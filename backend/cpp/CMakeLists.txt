cmake_minimum_required(VERSION 3.20)
project(rv32i_single_cycle LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# 单周期 RV32I 模拟核心（头文件实现 + 少量 .cpp）
set(RV32I_CORE_SOURCES
    src/rv_core.cpp
    src/rv_disasm.cpp
)

add_library(rv32i_core STATIC ${RV32I_CORE_SOURCES})
target_include_directories(rv32i_core PUBLIC src)

# stdin/stdout JSON 命令循环（模拟器可执行文件）
add_executable(rv32i_sim src/main.cpp)
target_link_libraries(rv32i_sim PRIVATE rv32i_core)
