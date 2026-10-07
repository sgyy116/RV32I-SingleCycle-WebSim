# RV32I 单周期模型机 —— 教学可视化仿真平台

> 一个全新的、教学导向的单周期 RISC-V 处理器可视化仿真平台。
> 学生在浏览器中编写 RISC-V 汇编代码，实时观察每条指令在单周期数据通路中的完整执行过程。

当前版本：**v1.4.1**，由 v1.4.0 提交 `f22ea12` 继续修改，按《具体说明.md》补齐 UI、调整端口动画及侧栏、精简波形并修复停机异常的展示。版本号见 `VERSION`，发布标签为 `v1.4.1`。

GitHub 的 main 维护稳定最新版；本地 `fix/ui-v1.4.1` 工作树保留用于维护。本次以快进方式同步 main 和版本标签，不包含本地主库另存的未提交改动。版本说明见 `docs/版本更新说明-提炼版.md`、`docs/版本更新说明-具体版.md`；管理约定见 `docs/版本管理.md`。异常／中断操作见 `docs/异常与中断使用说明.md`。

### 从 GitHub 获取的是源码

仓库不包含 node_modules、前端 dist、C++ build、测试输出、缓存、日志、压缩包或本机环境文件。SVG 参考图与校徽是保留的项目资料。

在 Windows 上首次检出后，需要 Node.js、Python 与 C++ 编译工具链；先构建前端并安装 Python 依赖，再运行启动器（缺少核心时启动器会本地编译）：

```powershell
npm --prefix frontend ci
npm --prefix frontend run build
python -m pip install -r backend/python/requirements.txt
.\启动-Windows.bat
```

启动及验证的完整说明见 `docs/工程进度.md`。仓库源码不等同于带预构建产物的离线交付包。

> ℹ️ **项目信息**
>
> - 主库：[sgyy116/RV32I-SingleCycle-WebSim](https://github.com/sgyy116/RV32I-SingleCycle-WebSim)
> - 仅供教学、学习、科研交流使用，**禁止商用**（完整条款见仓库根目录 `LICENSE`）。

## 实现、参考与许可

本项目是**独立实现**的 RV32I 单周期教学仿真平台，CPU 核心由项目团队编写。
开发时参考过以下公开项目的教学场景与设计思路，感谢原作者分享：

- [riscv-pipeline-frontend](https://github.com/EverlastingSnow/riscv-pipeline-frontend)
- [RISC-V_Platform](https://github.com/EverlastingSnow/RISC-V_Platform)
- [platform_riscv](https://github.com/EverlastingSnow/platform_riscv)

这些链接是**参考资料，不是本项目的源码出处**。

本项目有权许可的内容按仓库根目录 [`LICENSE`](LICENSE) 提供：这是自定义的非商用许可，
不是 [OSI 定义的开源许可证](https://opensource.org/osd)。第三方材料如有单独许可，仍按各自条款使用。

---

## ✨ 特性

- **界面整合**：控制按钮无悬停解释；示例选择仅保留编辑器内一处；缩放滑块与指令状态共用工具条；指令列表同时支持滑块、原生滚轮与自动跟随；折叠侧栏保留组件状态；底栏支持窄屏换行与移动端安全区。

- **RV32I 指令集**：支持 46 条基础整数指令（R/I/S/B/U/J 六种格式 + 系统指令），编译器另外支持 `li`/`mv`/`la`/`j`/`ret`/`call`/`beqz`/`bnez` 等伪指令
- **单周期执行模型**：一条指令一个周期，无流水线寄存器、无转发、无冒险检测
- **完整数据通路可视化**：PC → IMEM → RegFile → ALU → DMEM → WB 全流程，活跃连线高流动画、动态数值覆盖
- **信号逐波传播动画**：单周期 CPU 里一条指令 = 一个时钟周期，所以「波」模拟的是这条指令**内部组合逻辑的传播延迟**——信号从 PC 一级级传到寄存器堆的写入口（实测一条指令 8～14 波）。工具栏可【单步】逐波前进，也可【单条指令】按设定速度整条流动播完；速度播放途中可调
- **实时信号面板**：控制信号、ALU 输入输出、内存读写、写回路径逐一展示，并**按波次逐块出现**——信号还没传到 ALU，ALU 那张卡片就不出现；寄存器值到最后一波才落定（波形图除外，它是跨周期视图，无「波内」概念）
- **汇编编辑器**：CodeMirror 6 语法高亮 + 反汇编指令列表 + PC 高亮 + 断点
- **内置百科全书（术语词典）**：面向零基础新生，界面上出现的专有名词都能查到——171 条词条，覆盖全部 RV32I 指令、CSR 与异常中断、数据通路图上 28 个部件、通用组成原理概念与调用约定。正文短、可互相跳转（带返回栈）、标出处；**本项目自创的东西（如「波次」）标徽章并在正文点明**。支持搜索（大小写与分隔符不敏感、别名表、拼写近似），**点数据通路图上的任意部件可直接打开对应词条**
- **异步 Python 中间层**：`websockets`（WebSocket 服务）+ `aiohttp`（HTTP 编译服务，并伺服前端静态文件）
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

> 前端是**预构建好的静态文件**，由 Python 中间层在 `http://localhost:8081` 一并伺服——
> 页面与编译 API 同源（都在 8081），WebSocket 仍走 8080。

## 🚀 快速启动（两步）

### 前置要求

| 依赖 | 版本 | 说明 |
| ---- | ---- | ---- |
| g++ | 8+ | C++17 即可（代码未用 C++20 特性，旧 g++ 也能编） |
| Python | 3.9+ | 中间层（需 `pip install websockets aiohttp`） |
| Node.js | 18+ | **仅前端开发者需要**（要改 `frontend/src` 时）。跑交付版不用装 |
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

### 第三步：打开浏览器

中间层启动后，前端（`frontend/dist` 里的预构建静态文件）已经由它一并伺服：

```
http://localhost:8081
```

> 这就是**交付形态**：不需要 Node.js，也不需要 `npm install`。
> 启动、使用、关掉，文件夹不会有变化——编译产生的临时文件写在系统临时目录，不落在本文件夹。
>
> **一个前提**：包里已经带了编译好的 `rv32i_sim.exe`。**Linux 用户第一次运行**会因为
> 找不到 `rv32i_sim` 而调用 g++ 编译出 `backend/cpp/build/rv32i_sim`（**多出这一个文件**），
> 从第二次起就不再变化；自己改了 C++ 源码的人同理。
>
> 要改前端源码时才走开发轨，见下方「前端开发」。

也可以一键启动（脚本会自动编译缺的模拟器，然后启动服务）：

- **Windows**：双击 `启动-Windows.bat`
- **Linux**：`bash 启动-Linux.sh`

浏览器同样打开 `http://localhost:8081`。

### 前端开发（仅在要改 `frontend/src` 时）

交付版的前端是**构建产物**，改了源码必须重新构建才会反映到 8081：

```bash
cd frontend
npm install            # 仅第一次
npm run dev            # 开发服务器 → http://localhost:5173（热更新）
# 改完源码后，重新构建，8081 才会用上新代码：
npm run build
```

| | 交付轨（默认） | 开发轨 |
|---|---|---|
| 启动 | 一键启动器 | 启动器 + `npm run dev` |
| 页面 | `http://localhost:8081` | `http://localhost:5173` |
| 改前端后 | 需要 `npm run build` | 热更新立即生效 |

两条轨的后端是同一个（8080 WebSocket + 8081 HTTP），Vite 开发服务器会把
`/api` 请求代理到 8081，所以两种方式都能正常编译运行。

> 另有 `start.sh` 是**仓库自带的开发脚本**：它用 `-std=c++20`（g++ 8/9 不认这个写法）且**每次启动都重编**。
> 交付时用的是上面两个启动器，它们只在缺模拟器时才编译、且用 `-std=c++17`。
> 它起的是 Vite 开发服务器（5173），属于上面的「前端开发」流程，不参与交付。

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
│   ├── dist/                   # 预构建静态文件（交付时由中间层在 8081 伺服）
│   └── src/
│       ├── components/
│       │   ├── datapath/       # ★ 数据通路可视化
│       │   ├── glossary/       # ★ 百科全书浮层（外壳 / 搜索 / 列表 / 词条 / 正文）
│       │   ├── editor/         # CodeMirror 编辑器
│       │   ├── registers/      # 寄存器面板
│       │   ├── memory/         # 内存视图
│       │   └── layout/         # 布局组件
│       ├── stores/             # Pinia 状态
│       ├── data/               # 布局数据 + 示例程序 + glossary.ts（词条数据）/ glossaryQuery.ts（检索与互链）
│       └── types/              # 协议类型
├── tools/                      # 离线断言（不需要浏览器）
│   ├── check_all.py            #   一条命令跑完全部（几何 / 点亮 / 波次 / 术语表）
│   └── _glossary_check.mjs     #   术语表：字数 / 互链层级 / 别名冲突 / 图上映射覆盖率
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

前端 / 几何 / 点亮语义 / 术语表 / 连线配色的离线断言在仓库根目录一条命令跑完：

```bash
python3 tools/check_all.py     # 19 步：几何自检 + 条件分支接口 + 4 份夹具的高亮与波次断言 + 关键字表对账 + 术语表自检 + 连线配色标准
```

> 加了 `--no-regen` 就跳过前 4 步（不重新生成夹具状态流），变成 15 步。
> 术语表自检默认带 `--strict`，会连带检查图上 28 个部件的映射目标是否真有词条。
> 子脚本用退出码 3 表示「这次环境跑不了」——不算通过，脚本会在结尾单列出来。

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

本实现补全的**机器模式 trap 机制**：

- **异常（同步）**：`ecall`(原因 11)、`ebreak`(原因 3)、非法指令(原因 2) → 保存 `mepc`/`mcause`/`mtval` → 关总闸(`mstatus.MIE`) → 跳转 `mtvec`
- **中断（异步）**：计时器中断(原因 `0x80000007`)，需过"三道门"：`mtime >= mtimecmp` + `mie.MTIE` + `mstatus.MIE`
- **返回**：`mret` → `PC = mepc`，`MIE` 从 `MPIE` 恢复
- **计时器**：`mtime` = CSR `0xC01`（每周期 +1）；`mtimecmp` = **自定义 CSR `0x780`**（模拟器扩展，非标准）
- **协议**：每周期 `cycle_state` 带出 `csr` 快照（8 个关键寄存器）+ `trap` 段（本周期是否 trap、原因、mepc）
- **兜底**：`mtvec == 0` 时发生 trap → 停机提示，兼容旧程序

> 修复了 CPU 核心两个潜伏 bug：① CSR 寄存器版指令（csrrw/csrrs/csrrc）误把 rs1“编号”当“值”；② 分支条件不满足时仍错误跳转（旧测试全用必然成立的分支，故未暴露）。

## 🪟 Windows 兼容性

CPU 核心原面向 Linux，已适配 Windows（含中文路径）：

- C++：`main.cpp` 用 `PeekNamedPipe` 替代 `poll.h`（`#ifdef _WIN32` 双平台）；`rv_elf_loader.hpp` 用 `CreateFileW` 支持中文路径
- Python：文件读写统一 UTF-8；与 C++ 通信用**二进制管道** + `ensure_ascii=False`（天然规避 GBK/路径坑）
- 中间层已装 `websockets` + `aiohttp`，两个端口都端到端验证通过
- 测试脚本 `test_sim.py` / `test_server.py` 在 Windows 下均全过

## 📚 文档

- **`docs/工程进度.md` —— ★ 交接入口**：现在做到哪了 / 怎么验证没改坏 / 会复发的坑 / 遗留项。**接手先读这份**
- **`AGENTS.md` —— ★ AI 助手须知**：回答口径 / 五条硬约束 / 真相源对照 / 署名。`CLAUDE.md` 是指向它的指针
- `docs/DEVELOPMENT.md` —— ★ 开发文档：三层架构 / 后端中断异常机制 / 中间层 / 前端 / 协议 / 测试 / 演示（与本仓库同步）
- `docs/HL_CONTRACT.md` —— ★ 数据通路**点亮契约**：图上每根线、每个部件「本周期该不该亮」的判据，是前端全部断言的唯一来源
- `docs/CHANGELOG.md` —— 按「一轮工作」记录的变更与复验方法
- `docs/修复报告-2026-09-22.md` —— 正确性审计的完整报告：每个缺陷的症状 / 证据 / 修法 / 复验

## 📄 许可证

教学用途，仅供学习交流。完整条款与参考资料清单见上文「实现、参考与许可」与仓库根目录 `LICENSE`。
