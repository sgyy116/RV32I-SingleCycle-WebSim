# RV32I 单周期模型机

在浏览器中编写 RISC-V 汇编，观察指令执行、数据通路和寄存器变化。

- **版本**：v1.5.1
- **正式页面**：http://localhost:8081/
- **主库**：[sgyy116/RV32I-SingleCycle-WebSim](https://github.com/sgyy116/RV32I-SingleCycle-WebSim)
- **发布标签**：`v1.5.1`

Ubuntu 服务器对接与部署步骤见 [Ubuntu 服务器部署](docs/Ubuntu服务器部署.md)。前端在正式部署中通过同域名 `/ws` 连接后端，并自动按页面协议选择 `ws` 或 `wss`。

## 功能

### 指令执行与异常中断

支持 RV32I 整数运算、逻辑运算、移位、访存、条件分支和跳转指令，以及 CSR 操作、`ecall`、`ebreak` 和 `mret`。可通过汇编程序配置异常入口与计时器中断，观察异常原因、返回地址和处理程序的执行过程。未配置异常入口时，触发 trap 后停机。

### 数据通路可视化

通过 SVG 展示 PC、指令存储器、寄存器堆、译码器、ALU、数据存储器和写回路径。执行时高亮当前使用的连线与部件，在线路上显示实时数值，并以六类颜色区分数据总线、地址／PC、立即数／常量、控制信号、时钟／复位和异常／中断。支持拖动平移、滚轮或滑条缩放，以及 1:1 视角复位。

### 逐波传播与执行控制

一条指令对应一个 CPU 周期；波次用于展示该指令内部组合逻辑的传播过程。

- **单步**：推进一个信号传播波次。
- **单条指令**：按设定速度播放一条指令的数据通路动画。
- **运行**：连续执行并播放后续指令。
- **暂停**：停止自动播放，保留当前进度。
- **复位**：复位仿真状态并清除波次显示。
- **速度**：以 1～20 波／秒调整动画播放节奏。
- **上一步／下一步**：查看已保存的周期快照，无需重新执行程序。

### 汇编编辑与编译

内置 CodeMirror 编辑器，提供语法高亮、示例选择和编译加载。编译结果生成反汇编指令列表，可查看指令地址、机器码和当前执行位置，并设置断点。编译优先使用 `riscv-none-elf-gcc`，不可用时回退到内置 Python 汇编器；支持 `li`、`mv`、`la`、`j`、`ret` 等常用伪指令，编译失败时显示错误信息。

### 状态与波形查看

指令信号面板展示当前指令、操作数、控制信号、ALU、访存和写回信息，并随波次显示传播到相应阶段的内容。寄存器面板查看寄存器值，内存面板按地址查看内存数据。波形面板可选择控制信号和寄存器，比较它们在多个周期中的变化。

### 术语词典

支持查询指令、CSR、异常中断、数据通路部件和组成原理术语。提供搜索、别名匹配、词条互链和返回操作；点击数据通路部件可直接打开对应词条，便于结合图形与运行结果阅读。

### 响应式布局

根据浏览器内容区域的宽度和宽高比，在三列、上下和单视图布局之间切换。三列同时展示代码、数据通路和运行状态；上下布局将数据通路置顶；单视图通过标签切换工作区。临界范围设置缓冲，调整窗口时保留编辑内容、撤销记录、面板选择及图形视角。

顶部速度与历史按钮随工作区模式同步换行。底栏集中显示缩放、连接、程序状态、周期、PC、当前指令、波次和异常提示。图例在三列布局中默认展开，其他模式默认收起，空间不足时自动收起。

## 环境要求

| 依赖 | 版本 | 说明 |
| ---- | ---- | ---- |
| g++ | 8+ | C++17 |
| Python | 3.9+ | 中间层 |
| Node.js | 18+ | 前端构建与开发 |
| riscv-none-elf-gcc | 可选 | RISC-V 编译器 |

## 启动

### 首次从源码构建

在项目根目录执行：

```powershell
npm --prefix frontend ci
npm --prefix frontend run build
python -m pip install -r backend/python/requirements.txt
.\启动-Windows.bat
```

Linux 使用 `python3` 安装 Python 依赖，并运行 `bash 启动-Linux.sh`。

启动器会编译缺失的 C++ 核心。仓库不包含依赖及构建产物，首次检出需完成上述步骤。

### 运行已构建版本

- Windows：双击 `启动-Windows.bat`。
- Linux：运行 `bash 启动-Linux.sh`。
- 浏览器打开 http://localhost:8081/ 。

已有 `frontend/dist` 和模拟器时，运行页面无需 Node.js。

## 前端开发

先启动后端，再执行：

```bash
cd frontend
npm run dev
```

| 模式 | 页面 | 更新方式 |
| ---- | ---- | ---- |
| 正式运行 | http://localhost:8081/ | `npm run build` 后刷新 |
| 前端开发 | http://localhost:5173/ | 热更新 |

修改前端后，在 `frontend` 目录执行 `npm run build`，正式页面按 `Ctrl+F5` 刷新。

## 架构与目录

Vue 3 + TypeScript 前端 → Python 中间层 → C++17 单周期核心。

| 目录 | 内容 |
| ---- | ---- |
| `frontend/src` | 前端组件、状态、布局及词条 |
| `frontend/dist` | 前端构建产物 |
| `backend/cpp` | C++ 模拟核心 |
| `backend/python` | WebSocket、编译服务及内置汇编器 |
| `backend/asm_examples` | 汇编示例 |
| `backend/test` | 后端与差分测试 |
| `tools` | 前端及离线验证工具 |
| `docs` | 开发、版本与验证文档 |

HTTP 页面与编译 API 使用 8081，WebSocket 使用 8080。

## 指令集

| 类别 | 指令 | 数量 |
| ---- | ---- | ---- |
| R 型 | ADD SUB SLL SLT SLTU XOR SRL SRA OR AND | 10 |
| I 型算术 | ADDI SLTI SLTIU XORI ORI ANDI SLLI SRLI SRAI | 9 |
| I 型访存 | LW LH LB LHU LBU | 5 |
| 跳转 | JAL JALR | 2 |
| S 型 | SW SH SB | 3 |
| B 型 | BEQ BNE BLT BGE BLTU BGEU | 6 |
| U 型 | LUI AUIPC | 2 |
| 系统 | ECALL EBREAK MRET CSRRW CSRRS CSRRC CSRRWI CSRRSI CSRRCI | 9 |

`ecall`、`ebreak` 和非法指令触发 trap；未配置 `mtvec` 时停机。
计时器比较寄存器使用自定义 CSR `0x780`，属于模拟器扩展。
详见 [异常与中断使用说明](docs/异常与中断使用说明.md)。

## 测试

项目根目录：

```bash
python -B tools/check_all.py
```

已有状态夹具时可加 `--no-regen`，运行 15 项离线检查；跳过项不算通过。

后端测试：

```bash
cd backend/test
python test_sim.py
python test_asm.py
python test_server.py
python difftest/run.py
python difftest/roundtrip.py
python difftest/probe.py
```

Edge 验证命令与结果见 [v1.5.0 验证记录](docs/验证记录-v1.5.0.md)。

## 文档

- [工程进度](docs/工程进度.md)：交接与验证入口。
- [开发文档](docs/DEVELOPMENT.md)：架构、协议及测试。
- [响应式布局](docs/响应式布局.md)：布局规则与开发记录。
- [高亮契约](docs/HL_CONTRACT.md)：数据通路高亮判据。
- [版本管理](docs/版本管理.md)：分支、标签与发布约定。
- [变更记录](docs/CHANGELOG.md)：版本改动。
- [AI 助手须知](AGENTS.md)：项目约束。

## 实现、参考与许可

本项目独立实现，CPU 核心由项目团队编写。以下项目提供教学场景和设计思路参考：

- [riscv-pipeline-frontend](https://github.com/EverlastingSnow/riscv-pipeline-frontend)
- [RISC-V_Platform](https://github.com/EverlastingSnow/RISC-V_Platform)
- [platform_riscv](https://github.com/EverlastingSnow/platform_riscv)

上述链接是参考资料，不是本项目的源码出处。

本项目采用自定义[非商用许可](LICENSE)，仅供教学、学习和科研交流，禁止商用；不属于 OSI 开源许可证。第三方材料遵循各自许可。
