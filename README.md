# RV32I 单周期模型机 —— 教学可视化仿真平台

> 一个全新的、教学导向的单周期 RISC-V 处理器可视化仿真平台。
> 学生在浏览器中编写 RISC-V 汇编代码，实时观察每条指令在单周期数据通路中的完整执行过程。

> ⚠️ **版权与出处声明（请务必阅读）**
>
> 本项目**不是原创作品**，而是基于学长的原始单周期 RISC-V 仿真器进行的**继承式开发**。
>
> - CPU 模拟核心等绝大部分代码源自学长的工作；本仓库的贡献主要包括：补全中断/异常机制、适配 Windows 平台、后续前端功能扩展等；
> - **请勿将本项目误认为原创作品**，引用或分发时请保留本声明及对学长的致谢；
> - 仅供教学、学习、科研交流使用，**禁止商用**。

---

## ✨ 特性

- **RV32I 指令集**：支持 46 条基础整数指令（R/I/S/B/U/J 六种格式 + 系统指令），编译器另外支持 `li`/`mv`/`la`/`j`/`ret`/`call`/`beqz`/`bnez` 等伪指令
- **单周期执行模型**：一条指令一个周期，无流水线寄存器、无转发、无冒险检测
- **完整数据通路可视化**：PC → IMEM → RegFile → ALU → DMEM → WB 全流程，活跃连线高流动画、动态数值覆盖
- **信号逐波传播动画**：单周期 CPU 里一条指令 = 一个时钟周期，所以「波」模拟的是这条指令**内部组合逻辑的传播延迟**——信号从 PC 一级级传到寄存器堆的写入口（实测一条指令 8～14 波）。工具栏可【单步】逐波前进，也可【单条指令】按设定速度整条流动播完；速度播放途中可调
- **实时信号面板**：控制信号、ALU 输入输出、内存读写、写回路径逐一展示，并**按波次逐块出现**——信号还没传到 ALU，ALU 那张卡片就不出现；寄存器值到最后一波才落定（波形图除外，它是跨周期视图，无「波内」概念）
- **汇编编辑器**：CodeMirror 6 语法高亮 + 反汇编指令列表 + PC 高亮 + 断点
- **异步 Python 中间层**：`websockets`（WebSocket 服务）+ `aiohttp`（HTTP 编译服务）
- **双编译路径**：优先使用 `riscv-none-elf-gcc`，缺失时自动回退到内置 Python 微型汇编器

## 🏗️ 三层架构

```
┌────────────────────────────────────────────────────────────┐
│ 前端 (Vue 3 + TypeScript + Vite)                            │
│  代码编辑器 │ 数据通路 SVG 可视化 │ 寄存器/内存面板          │
│  WebSocket ↔ ws://localhost:8080                           │
└──────────────────────────┬─────────────────────────────────┘
                           │ JSON 消息
┌──────────────────────────▼─────────────────────────────────┐
│ Python 中间层 (websockets + aiohttp)                      │
│  • server.py        WebSocket 服务 (端口 8080, websockets) │
│  • ws_adapter.py    websockets 连接适配器                 │
│  • cpp_bridge.py    C++ 子进程管理 + JSON 通信             │
│  • compile_server.py HTTP 编译服务 (端口 8081, aiohttp)    │
│  • asm.py           Python 微型汇编器（回退方案）           │
└──────────────────────────┬─────────────────────────────────┘
                           │ stdin/stdout 逐行 JSON
┌──────────────────────────▼─────────────────────────────────┐
│ C++ 单周期模拟核心 (C++17)                                   │
│  rv32i_core::step(): IF → ID → RegRead → EX → MEM → WB     │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 快速启动（三步）

### 前置要求

| 依赖 | 版本 | 说明 |
| ---- | ---- | ---- |
| g++ | 8+ | C++17 即可（代码未用 C++20 特性，旧 g++ 也能编） |
| Python | 3.9+ | 中间层（需 `pip install websockets aiohttp`） |
| Node.js | 18+ | 前端（需 npm install） |
| riscv-none-elf-gcc | 可选 | 有则优先编译，无则回退到内置汇编器 |

### 第一步：编译 C++ 模拟核心

```bash
cd backend/cpp
# 方式一：CMake
cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j
# 方式二：g++ 直接编译（Windows 输出 rv32i_sim.exe，Linux 去掉 .exe）
mkdir -p build
g++ -std=c++17 -O2 -I src src/main.cpp src/rv_core.cpp src/rv_disasm.cpp -o build/rv32i_sim.exe
```

### 第二步：启动 Python 中间层

先安装依赖（用户级，无需 sudo）：

```bash
cd backend/python
python3 -m pip install --user -r requirements.txt
# 国内网络慢可用清华镜像:
# python3 -m pip install --user -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple/
```

再启动：

```bash
python3 server.py
# 输出: HTTP 编译服务已启动: http://localhost:8081
#       WebSocket 服务器已启动: ws://localhost:8080
```

### 第三步：启动前端

```bash
cd frontend
npm install
npm run dev
# 打开 http://localhost:5173
```

也可以一键启动（脚本会自动编译缺的模拟器、安装缺的前端依赖）：

- **Windows**：双击 `启动-Windows.bat`
- **Linux**：`bash 启动-Linux.sh`

> 另有 `start.sh` 是**继承来的开发脚本**：它用 `-std=c++20`（g++ 8/9 不认这个写法）且**每次启动都重编**。
> 交付时用的是上面两个启动器，它们只在缺模拟器时才编译、且用 `-std=c++17`。

## 📁 目录结构

```
rv32i-single-cycle/
├── 启动-Windows.bat            # 一键启动（Windows）
├── 启动-Linux.sh               # 一键启动（Linux）
├── README.md
├── backend/
│   ├── cpp/                    # C++ 模拟核心
│   │   ├── CMakeLists.txt
│   │   └── src/
│   │       ├── rv_common.hpp     # 指令编码联合体 + 操作码
│   │       ├── rv_alu.hpp        # ALU（10 种运算）
│   │       ├── rv_immgen.hpp     # 立即数生成器（I/S/B/U/J）
│   │       ├── rv_regfile.hpp    # 寄存器堆（x0 硬连线 0）
│   │       ├── rv_control.hpp    # 控制单元真值表
│   │       ├── rv_memory.hpp     # 128KB 字节寻址内存
│   │       ├── rv_elf_loader.hpp # ELF32 加载器
│   │       ├── rv_disasm.hpp/cpp # 反汇编器
│   │       ├── rv_core.hpp/cpp   # 单周期核心（step）
│   │       ├── json_writer.hpp   # JSON 输出辅助
│   │       └── main.cpp          # stdin/stdout JSON 命令循环
│   ├── python/                 # Python 中间层
│   │   ├── requirements.txt    # 依赖 (websockets, aiohttp)
│   │   ├── server.py           # WebSocket 服务入口 (websockets)
│   │   ├── ws_adapter.py       # websockets 连接适配器
│   │   ├── ws_handler.py       # 消息路由
│   │   ├── cpp_bridge.py       # C++ 子进程桥接
│   │   ├── compile_server.py   # HTTP 编译服务 (aiohttp)
│   │   ├── asm.py              # Python 微型汇编器
│   │   └── config.py
│   ├── asm_examples/           # 教学示例汇编
│   └── test/                   # 测试
│       ├── test_sim.py         # C++ 模拟器端到端测试（126 项断言）
│       ├── test_asm.py         # 微型汇编器测试（55 项，含 19 条缺口用例）
│       ├── test_server.py      # Python 中间层集成测试（11 项）
│       └── difftest/           # ★ 与自写独立参照模型的差分测试（零依赖）
│           ├── refmodel.py     #   独立 RV32I 参考实现（只依据 ISA 规范写成）
│           ├── corpus.py       #   测试语料生成器（能造非法/保留编码）
│           ├── run.py          #   锁步比对（55 个用例）
│           ├── roundtrip.py    #   汇编 ↔ 反汇编往返一致性
│           └── probe.py        #   非法编码组合全扫描
├── frontend/                   # Vue3 前端
│   └── src/
│       ├── components/
│       │   ├── datapath/       # ★ 数据通路可视化
│       │   ├── editor/         # CodeMirror 编辑器
│       │   ├── registers/      # 寄存器面板
│       │   ├── memory/         # 内存视图
│       │   └── layout/         # 布局组件
│       ├── stores/             # Pinia 状态
│       ├── data/               # 布局数据 + 示例程序
│       └── types/              # 协议类型
└── docs/
```

## 📡 通信协议（摘要）

### 前端 → 后端（WebSocket JSON）

```jsonc
{"type": "load", "source": "addi t0, zero, 42\necall"}
{"type": "step"}
{"type": "pause"}
{"type": "reset"}
{"type": "set_breakpoint", "addr": "0x80000004"}
{"type": "get_memory", "addr": "0x80000000", "count": 16}
{"type": "get_disassembly", "addr": "0x80000000", "count": 256}
```

> 后端仍接受 `{"type":"run"}`（Python 中间层与 C++ 核心一字未改），但**本前端不再发它**：
> 连续播放改由前端按波次节奏驱动——每播完一条指令才发一次 `step`，这样动画和 CPU
> 的推进严格对齐（详见 `frontend/src/stores/wave.ts`）。

### 后端 → 前端（每周期完整状态）

```jsonc
{
  "type": "cycle_state",
  "cycle": 42,
  "state": {
    "pc": "0x80000100",
    "next_pc": "0x80000104",
    "instruction": "0x00a50533",
    "disassembly": "add a0, a0, a0",
    "instruction_fields": { "opcode": "0b0110011", "rd": 10, "format": "R", ... },
    "immediate": 0,
    "control_signals": { "reg_write": true, "alu_src": false, ..., "alu_op": "ADD" },
    "reg_reads": { "rs1": {"index":10,"value":42}, "rs2": {"index":10,"value":42} },
    "alu": { "op1": 42, "op2": 42, "result": 84, "zero": false, "less": false },
    "memory": { "addr": "0x0", "read_data": "0x0", "access_type": "NONE", "access_size": 0 },
    "writeback": { "active": true, "reg_index": 10, "data": 84, "source": "ALU" },
    "branch": { "taken": false, "target_addr": "0x80000104" },
    "regfile": [0, 0, ...],
    "halted": false
  }
}
```

## 🧪 测试

```bash
cd backend/test
python3 test_sim.py            # C++ 模拟核心端到端（126 项断言）
python3 test_asm.py            # 微型汇编器（55 项）
python3 test_server.py         # Python 中间层集成（11 项）

python3 difftest/run.py        # 差分测试：与自写参照模型锁步比对（55 用例）
python3 difftest/roundtrip.py  # 汇编 ↔ 反汇编往返一致性
python3 difftest/probe.py      # 非法编码组合全扫描
```

前端 / 几何 / 点亮语义的离线断言在仓库根目录一条命令跑完：

```bash
python3 tools/check_all.py     # 16 步：几何自检 + 4 份夹具的高亮与波次断言 + 关键字表对账
```

> **差分测试为什么重要**：`test_sim.py` 的期望值终究是人工写的，写错就会给 bug 背书
> （AUIPC 算错曾长期潜伏，正是因为断言从被测对象自己的输出里取值）。
> `difftest/` 里的参照模型是**照着 RISC-V 规范另写的一份实现**，与被测核心零共享代码，
> 逐周期逐字段比对——这是唯一能证伪「后端整体正确」的手段。

## 🎯 已实现指令集

| 类别 | 指令 | 数量 |
| ---- | ---- | ---- |
| R 型 | ADD SUB SLL SLT SLTU XOR SRL SRA OR AND | 10 |
| I 型算术 | ADDI SLTI SLTIU XORI ORI ANDI SLLI SRLI SRAI | 9 |
| I 型访存 | LW LH LB LHU LBU | 5 |
| 跳转 | JAL JALR | 2 |
| S 型 | SW SH SB | 3 |
| B 型 | BEQ BNE BLT BGE BLTU BGEU | 6 |
| U 型 | LUI AUIPC | 2 |
| 系统 | ECALL EBREAK **MRET** CSRRW/CSRRS/CSRRC/CSRRWI/CSRRSI/CSRRCI | 9 |

> `ecall`/`ebreak`/非法指令已改为触发 **trap**；未配置 `mtvec` 时停机兜底（旧程序仍可用 `ecall` 结束）。

## 🚦 中断与异常机制（已实现）

在学长单周期核心基础上补全的**机器模式 trap 机制**：

- **异常（同步）**：`ecall`(原因 11)、`ebreak`(原因 3)、非法指令(原因 2) → 保存 `mepc`/`mcause`/`mtval` → 关总闸(`mstatus.MIE`) → 跳转 `mtvec`
- **中断（异步）**：计时器中断(原因 `0x80000007`)，需过"三道门"：`mtime >= mtimecmp` + `mie.MTIE` + `mstatus.MIE`
- **返回**：`mret` → `PC = mepc`，`MIE` 从 `MPIE` 恢复
- **计时器**：`mtime` = CSR `0xC01`（每周期 +1）；`mtimecmp` = **自定义 CSR `0x780`**（模拟器扩展，非标准）
- **协议**：每周期 `cycle_state` 带出 `csr` 快照（8 个关键寄存器）+ `trap` 段（本周期是否 trap、原因、mepc）
- **兜底**：`mtvec == 0` 时发生 trap → 停机提示，兼容旧程序

> 修复了原始代码两个潜伏 bug：① CSR 寄存器版指令（csrrw/csrrs/csrrc）误把 rs1“编号”当“值”；② 分支条件不满足时仍错误跳转（旧测试全用必然成立的分支，故未暴露）。

## 🪟 Windows 兼容性

原始代码面向 Linux，已适配 Windows（含中文路径）：

- C++：`main.cpp` 用 `PeekNamedPipe` 替代 `poll.h`（`#ifdef _WIN32` 双平台）；`rv_elf_loader.hpp` 用 `CreateFileW` 支持中文路径
- Python：文件读写统一 UTF-8；与 C++ 通信用**二进制管道** + `ensure_ascii=False`（天然规避 GBK/路径坑）
- 中间层已装 `websockets` + `aiohttp`，两个端口都端到端验证通过
- 测试脚本 `test_sim.py` / `test_server.py` 在 Windows 下均全过

## 📚 文档

- `docs/DEVELOPMENT.md` —— ★ 开发文档：三层架构 / 后端中断异常机制 / 中间层 / 前端 / 协议 / 测试 / 演示（与本仓库同步）
- `docs/HL_CONTRACT.md` —— ★ 数据通路**点亮契约**：图上每根线、每个部件「本周期该不该亮」的判据，是前端全部断言的唯一来源
- `docs/CHANGELOG.md` —— 按「一轮工作」记录的变更与复验方法
- `docs/修复报告-2026-09-22.md` —— 正确性审计的完整报告：每个缺陷的症状 / 证据 / 修法 / 复验
- 前端参考：五级流水线版 `RV64I/riscv-pipeline-frontend`

## 📄 许可证

教学用途，仅供学习交流。
