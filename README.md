# RV32I 单周期模型机

在浏览器中编写 RISC-V 汇编，观察指令执行、数据通路和寄存器变化。

- **版本**：v1.5.0
- **正式页面**：http://localhost:8081/
- **主库**：[sgyy116/RV32I-SingleCycle-WebSim](https://github.com/sgyy116/RV32I-SingleCycle-WebSim)
- **本地分支**：`release/v1.5.0`，尚未推送 GitHub

## 功能

- RV32I 指令、CSR、异常及计时器中断，支持常用伪指令。
- 单周期数据通路、连线高亮、实时数值与逐波传播动画。
- 单步、单条指令、连续运行、暂停、复位及历史回看。
- 汇编编辑器、反汇编列表、断点、寄存器、内存及波形面板。
- 术语词典，支持搜索和点击部件查阅。
- 三栏、上下和单视图布局，统一底栏显示缩放与执行状态。
- 优先使用 `riscv-none-elf-gcc`，缺失时使用内置 Python 汇编器。

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
