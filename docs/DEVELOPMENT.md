# 单周期 RV32I 网页仿真器 —— 开发文档

> 本仓库基于学长（Acai113 / 杭州电子科技大学教学团队）的原始单周期 RISC-V 仿真器做**继承式开发**：
> 在原 RV32I 单周期核心上**补全机器模式中断/异常机制**，并适配 Windows（含中文路径）。
> 版权与出处见仓库根 `README.md` 顶部声明。

---

## 1. 项目总览

教学导向的**网页版单周期 RV32I CPU 仿真器**：学生在浏览器写汇编 → 编译 → CPU 单步/连续执行 →
数据通路动画 + 寄存器/内存/信号面板 + **波形图**实时展示每个周期的信号流动，并支持**中断/异常**。

## 2. 三层架构

```
浏览器前端 (Vue3 + TypeScript + Vite, :5173)
   │ WebSocket(:8080)    HTTP 编译(:8081)
   ▼
Python 中间层 (websockets + aiohttp)
   │ 逐行 JSON (stdin/stdout)
   ▼
C++ 单周期模拟核心 (rv32i_sim.exe)
```

- 前端**只做展示**，不计算：CPU 全部行为在 C++ 核心中模拟，每周期以 `cycle_state` JSON 送出。
- 中间层负责：WebSocket 消息路由、汇编编译、C++ 子进程生命周期、协议翻译。

## 3. 快速启动

前置：g++ 8+、Python 3.9+（`pip install websockets aiohttp`）、Node 18+（前端）。

```bash
# 1) 编译 C++ 核心（Windows 输出 rv32i_sim.exe）
cd backend/cpp && g++ -std=c++17 -O2 -I src src/main.cpp src/rv_core.cpp src/rv_disasm.cpp -o build/rv32i_sim.exe

# 2) 启动 Python 中间层（两个端口 8080 WS / 8081 HTTP）
cd backend/python && python server.py

# 3) 启动前端开发服务器
cd frontend && npm install && npm run dev
# 浏览器打开 http://localhost:5173
```

> 改动 C++ 前先关闭网页（否则运行的 rv32i_sim.exe 会锁住文件导致编译 Permission denied）。

## 4. 后端设计（C++）

### 4.1 单周期核心与五步

`rv32i_core::step()` 一个周期内完成 **IF → ID → RegRead → EX → MEM → WB → 更新 PC**：

1. **取指**：`memory.load_word(PC)`
2. **译码**：`decode()` 认指令 + `control_decode()` 产控制信号（RegWrite/ALUSrc/ALUOp…）
3. **执行**：`alu_compute()`（10 种运算）；分支在此判定跳不跳
4. **访存**：仅 load/store 指令读写内存（地址 = ALU 结果）
5. **写回**：把 ALU/内存/返回地址写进目标寄存器

### 4.2 后端文件职责

| 文件 | 职责 |
|---|---|
| `rv_common.hpp` | 类型别名、opcode 枚举、指令位域 union、寄存器 ABI 名 |
| `rv_alu.hpp` | ALU 10 种运算 |
| `rv_immgen.hpp` | 立即数重组 + 符号扩展 |
| `rv_regfile.hpp` | 32 个寄存器（x0 恒 0）|
| `rv_control.hpp` | 控制信号真值表 |
| `rv_memory.hpp` | 128KB 字节寻址内存 |
| `rv_elf_loader.hpp` | ELF/裸二进制加载 |
| `rv_disasm.*` | 反汇编 |
| `rv_core.*` | ★ 核心：step()/trap/中断 |
| `main.cpp` | stdin/stdout 逐行 JSON 命令循环 |
| `json_writer.hpp` | JSON 序列化辅助 |

### 4.3 中断/异常机制（★ 本项目核心增量）

#### 异常源与中断源

| 源 | 触发 | mcause |
|---|---|---|
| ecall（机器模式环境调用）| 执行 ecall | 11 |
| ebreak（断点）| 执行 ebreak | 3 |
| 非法指令 | 解不出指令 | 2 |
| 计时器中断 | mtime ≥ mtimecmp（异步）| 0x80000007 |

#### CSR 布局（`m_csr[4096]`，按地址索引）

| 地址 | 名 | 说明 |
|---|---|---|
| 0x300 | mstatus | bit3=MIE(总闸)，bit7=MPIE(旧闸暂存) |
| 0x301 / 0x304 / 0x344 | misa / mie / mip | mie 的 bit7=MTIE 计时器使能 |
| 0x305 | mtvec | 处理程序入口地址 |
| 0x340 / 0x341 / 0x342 / 0x343 | mscratch / mepc / mcause / mtval | 现场保存 |
| 0xC00 / 0xC01 / 0xC02 | cycle / time / instret | 只读计数（time 兼作 mtime）|
| **0x780** | **mtimecmp** | ★ 模拟器自定义：计时器闹钟值（非 RISC-V 标准）|

#### trap 流程（`raise_trap(cause, mtval)`）

```
mepc   = 当前 PC          ← 回来要执行的指令（异常=出错那条；中断=被打断那条）
mcause = cause
mtval  = 附加信息
mstatus: MPIE ← MIE，MIE 清零      ← 关总闸，防 trap 套 trap
若 mtvec ≠ 0：PC = mtvec（跳处理程序）
若 mtvec == 0：停机兜底            ← 兼容旧程序用 ecall 结束的写法
```

#### 返回（`mret`）

```
PC = mepc
MIE ← MPIE（恢复总闸）
```

#### 计时器中断的"三道门"

中断真正被处理需同时满足：
```
mtime(0xC01) ≥ mtimecmp(0x780)   ← 事件"到了"（挂起）
&& mie.MTIE(bit7) == 1            ← 允许计时器中断
&& mstatus.MIE(bit3) == 1         ← 总闸开着
```
程序须自行：设 mtvec、设 mtimecmp、开 MTIE、开 MIE。**处理程序要先把 mtimecmp 调大再 mret**，
否则立刻又到点（中断风暴）。

> **异常**不需要过三道门——指令自身出错必须立刻处理。

#### 周期报告的 trap 信息

每周期 `cycle_state` 带出：
- `csr`：mtvec/mepc/mcause/mstatus/mie/mip/mtime/mtimecmp 八个值
- `trap`：本周期是否取 trap（taken/cause/mepc/mtval）

### 4.4 修复的原始代码 bug

| # | 现象 | 根因 | 后果 |
|---|---|---|---|
| 1 | csrrw/csrrs/csrrc 写错值 | 把 rs1 **寄存器编号**当**值**用 | 写 mtvec/mepc 全错 |
| 2 | 循环无法退出 | 分支**不满足条件**时 target 未回退 PC+4，所有分支无条件跳 | 任何不跳的分支死循环 |
| 3 | <16 字节程序加载失败 | 加载器把"≥16 字节"检查放在 ELF 判断**之前** | 小裸程序被误杀 |
| 4 | 中间层选错模拟器 | config 候选路径先命中学长残留的 Linux 版 `rv32i_sim` | WinError 193 |

> 前三个在学长原代码里潜伏多年——旧测试全用"必然成立的分支/足够大的程序/只读 CSR"，从没触发；
> 我们写真实程序（循环、8 字节程序、写 mtvec）把它们逼了出来。这就是"真实用例 + 回归测试"的价值。

### 4.5 Windows 兼容

- `main.cpp`：`poll.h`（Linux）→ `#ifdef _WIN32` 用 `PeekNamedPipe` 非阻塞查 stdin
- `rv_elf_loader.hpp`：`std::ifstream` 打不开中文路径 → Windows 用 `CreateFileW` 宽字符 API 读文件
- Python 与 C++ 通信用**二进制管道 + `ensure_ascii=False`**（天然规避 GBK 与 `\uXXXX` 转义问题）
- 测试脚本输出 emoji → ASCII，GBK 控制台可跑

## 5. 中间层设计（Python）

| 文件 | 职责 |
|---|---|
| `server.py` | asyncio 入口：WebSocket(:8080) + 每客户端独立 C++ 子进程；同事件循环起 HTTP(:8081) |
| `ws_handler.py` | 单连接消息路由：load/step/run/pause/reset/断点/内存/反汇编 |
| `cpp_bridge.py` | C++ 子进程管理 + 逐行 JSON 通信（协议见 `backend/cpp/src/main.cpp`）|
| `compile_server.py` | HTTP POST /api/compile：优先 riscv-gcc，缺失回退内置 asm.py 汇编器 |
| `asm.py` | 微型汇编器（支持 addi/lw/sw/分支/jal/csr*/la/mret/ecall…）|
| `config.py` | 端口、模拟器路径（按平台选 .exe）|

每个浏览器连接对应**独立 C++ 模拟器进程**（进程级隔离），连接关闭自动清理。

## 6. 前端设计（Vue3 + TS + Vite）

### 6.1 数据流

```
后端 cycle_state → WebSocket(useWebSocket.ts) → Pinia store(simulator.ts: stateHistory/cycleState)
   → wave.ts 算波次并切片 → 各组件读 store 渲染：数据通路图/寄存器/内存/指令信号/波形
```

前端**不计算 CPU 语义**，只消费后端每周期状态并展示；唯一的例外是**波次**
（`data/datapathWave.ts`，纯前端、纯函数，见 §6.3.3）。`stateHistory` 保留每一周期快照，
支持回退/前进与波形图。

### 6.2 文件结构速查

| 文件 | 作用 |
|---|---|
| `App.vue` | 布局：左侧编辑器、中央数据通路、右侧四个标签页 |
| `stores/simulator.ts` | 仿真核心状态 + 消息处理（**刻意没有 run()/runTimer**，见 §6.3.3）|
| `stores/wave.ts` | ★波次播放状态：`index`/`playing`/`speed` + 自持 `setTimeout` 链 |
| `composables/useWebSocket.ts` | WebSocket 连接/自动重连/分发 |
| `data/datapathHighlight.ts` | 由 `cycle_state` 算出全图高亮（哪条线/哪个部件/哪个网络亮）|
| `data/datapathWave.ts` | ★把高亮按「波」切片：`computeWaves` / `sliceHighlight` / `gateOf` |
| `components/datapath/DatapathView.vue` | 数据通路 SVG 容器 |
| `components/datapath/SceneNode.vue` | 单个图元的渲染（亮/暗/新生）|
| `components/panels/InstructionPanel.vue` | 指令信号 + ★中断/异常卡片（按波次门控）|
| `components/registers / memory` | 寄存器/内存面板（按波次门控）|
| `components/panels/WaveformPanel.vue` | ★波形图（见下。**不跟波次**）|
| `types/simulation.ts` | 与后端 JSON 对应的类型（含 csr/trap）|

### 6.3 本项目新增功能

1. **中断/异常显示**：`InstructionPanel` 底部新增"中断/异常"卡片——
   trap 发生那拍显示红色横幅（cause/mepc），并实时显示 8 个 CSR 值。
2. **波形图**：右侧新增"波形"标签页，GTKWave 风格——
   - 电平信号（控制信号/TRAP）画**方波**；数值信号（PC/ALU/寄存器）画**阶梯骤变**（离散时钟语义）
   - 「选择信号」可勾选内置信号或任意寄存器 x0~x31
3. **★信号逐波传播动画**（`data/datapathWave.ts` + `stores/wave.ts`）

   单周期 CPU 里**一条指令 = 一个时钟周期**，所以动画模拟的不是时钟节拍，而是这条指令
   **内部组合逻辑的传播延迟**。做法是把 `computeHighlight()` 的结果按拓扑深度切成若干"波"，
   页面只显示前 k 波（`sliceHighlight(hl, plan, k)`），k 由 `wave.index` 驱动。

   **波次怎么算**：数据通路里有反馈环（`wbmux → regfile.wdata`、`wbmux1 → PC.pc_next`、
   `csr → wbmux → csr`），环上最长路径无定义。解法是**把时钟沿切开的写端口当汇点**，环就断了——
   读端口是组合的，不切：

   ```ts
   const SINK = {
     PC:      ['pc_next'],
     regfile: ['wdata', 'wen', 'waddr'],
     dmem:    ['d', 'we'],
     csr:     ['wdata_in', 'we_in'],
   }
   const nodeOf = (m, p) => (SINK[m] || []).includes(p) ? m + '#in' : m
   ```

   分层只在**本周期激活的连线**（`hl.wires`）上算，所以每层非空，且 `lui`/`jal` 这类短路径
   指令波数天然更少（实测一条指令 8～14 波）。常量模块（`clkmod`/`const0`/`const4`/`reset`）
   在 `ALWAYS_LIT` 里，不占波次、全程点亮。

   **三个按钮的语义**（`stores/wave.ts`）：【单步】前进一波，已全亮则执行下一条并亮它第 1 波；
   【单条指令】把这条剩余的波播完；【运行】播完一条自动走下一拍。
   `sim.step()` 是 WebSocket 往返、**异步**，所以"需要后端走一拍"的动作要挂 `pending` 标记，
   等新 `cycleState` 到达再动画面——这是 `pending` 存在的全部理由。
   中途改速用 `setTimeout` 自递归、每拍重读 `speed`（不是 `setInterval`，否则每拖一下滑块就重置节奏）。

   **`simulator.ts` 因此删掉了 `run()` / `runTimer` / `runSpeed`**：原先那个 `setInterval`
   会绕过波次只顾发 `step`，两个定时器同时发 `step` 更是灾难。连续播放改由 `wave` 独占驱动。

   **面板门控**（`gateOf()`）：右侧三个面板按**卡片**（不是按字段）门控——40 来个字段逐个标波次
   必然漂移，而且学生看的是"这一栏到了没有"。有一处**不能只看门**：CSR 那张卡片要先问图
   （`wave.raw.modules.has('csr')`），因为后端每周期都发 `csr` 快照，`gateOf` 的 `open()`
   在"本周期没用到这个部件"时按设计返回"开"。

## 7. 通信协议（cycle_state 关键字段）

后端每周期输出 `{"type":"cycle_state","cycle":N,"state":{...}}`，`state` 含：

```jsonc
{
  "pc": "0x80000000", "next_pc": "0x80000004", "instruction": "0x00100513",
  "disassembly": "addi a0, zero, 1",
  "instruction_fields": { "opcode": "...", "rd": 10, "funct3": "...", ... },
  "control_signals": { "reg_write": true, "alu_src": true, "alu_op": "ADD", ... },
  "reg_reads": { "rs1": {"index":10,"value":1}, ... },
  "alu": { "op1":0, "op2":1, "result":1, "zero":false },
  "memory": { "addr": "0x0", "access_type": "NONE", ... },
  "writeback": { "active": true, "reg_index": 10, "data": 1, "source": "ALU" },
  "branch": { "taken": false, "target_addr": "0x80000004" },
  "csr":  { "mtvec": "0x00000000", "mepc": "...", "mcause": "...", "mstatus": "...",
            "mie": "...", "mip": "...", "mtime": "...", "mtimecmp": "..." },
  "trap": { "taken": true, "cause": 11, "mepc": "0x80000004", "mtval": "0x00000000" },
  "regfile": [0,0,...], "halted": false
}
```

## 8. 测试与验证

```bash
# C++ 核心端到端（22 项断言：算术/访存/分支/跳转/lui/auipc/停机）
cd backend/test && python test_sim.py

# 中间层集成（11 项：hello/load/step/run/断点/内存）
cd backend/test && python test_server.py
```

### 前端离线断言（几何 / 高亮 / 波次）

`tools/` 下的脚本直接用 Node 24 的**类型剥离** `import` 前端的 `.ts`，
不需要起浏览器就能验"图上亮的东西跟后端状态一致"。**改动高亮或波次后必跑。**

```bash
# 1) 先吐一组逐周期状态（三份覆盖不同指令组合的汇编）
python tools/_states.py tools/_hl_test.s    tools/out/_hl_states.jsonl
python tools/_states.py tools/_hl_ecall.s   tools/out/_hl_ecall_states.jsonl
python tools/_states.py tools/_csr_test.s   tools/out/_csr_states.jsonl

# 2) 高亮：每条指令必须点亮哪些连线/网络
node tools/_hl_check.mjs tools/out/_hl_states.jsonl

# 3) 波次：每波非空、物理顺序（PC 早于 imem、alu 早于 wbmux…）、
#    dmem/trapunit/csr 只在真正用到它们的指令上有波次。
#    ★ 最关键的一条：sliceHighlight(hl, plan, plan.count) 必须与原始 hl
#      完全相等——证明动画只是把同一份高亮切片，没改任何语义。
node tools/_wave_check.mjs tools/out/_hl_states.jsonl

# 4) 几何与 CSS（后者会 throw 如果 datapath.css 里混进了 < 或 &，SVG 按 XML 解析）
python tools/check_layout.py
node tools/hl_preview.mjs tools/out/_csr_states.jsonl 0
```

> 这两条 `.mjs` 能 `import` `.ts` 的前提：**值导入必须写字面后缀**
> （`from '../frontend/src/data/datapathWave.ts'`），且那些 `.ts` 只能用
> **可擦除语法**（禁 `enum` / `namespace` / 构造器参数属性）。
> 另外**不要改 `computeHighlight` 的签名**——`_hl_check.mjs` 直接调它，会当场炸掉。

验证策略说明：本项目未做与 Spike（Linux 官方参考模拟器）的差分测试——Windows 环境不可行；
以「断言回归 + 中间层集成测试 + 网页手测 + 真实 demo」覆盖，且这些测试真实抓出并修复了 4 个潜伏 bug。

## 9. 中断/异常演示（网页操作步骤）

演示程序在仓库内 `backend/asm_examples/`（`trap_roundtrip.s`、`timer_intr.s`），可直接在网页编辑器粘贴运行；命令行可用 `backend/python/asm.py` 汇编后用模拟器逐周期查看。

### 9.1 ecall trap 往返（证明"跳过去又跳回来"）

```asm
    la    t0, handler
    csrrw zero, mtvec, t0      # mtvec = handler
    addi  a0, zero, 1
    ecall                      # ★ trap → 跳 handler（mepc=ecall 地址）
    addi  a1, zero, 99         # mret 后回到这里 → a1=99
    csrrw zero, mtvec, zero
    ecall                      # mtvec=0 → 停机
handler:
    addi  a0, a0, 1            # a0=2
    csrrs t1, mepc, zero       # 读 mepc
    addi  t1, t1, 4            # +4 跳过 ecall
    csrrw zero, mepc, t1       # 写回 mepc
    mret
```
网页操作：编译&加载 → 执行到 `ecall` 那一条（点【单条指令】最省事）→ 看"指令信号"页的红色
TRAP 横幅（它跟着陷阱部件那一波才弹出）；最终 a0=2、a1=99。

### 9.2 计时器中断（异步打断）

```asm
    la    t0, handler
    csrrw zero, mtvec, t0
    addi  t0, zero, 20
    csrrw zero, mtimecmp, t0   # 闹钟定在第 20 周期
    addi  t0, zero, 128
    csrrs zero, mie, t0        # 开 MTIE（bit7 需用寄存器版，5 位立即数装不下）
    addi  t3, zero, 0          # 计数清零（须在开总闸前！）
    addi  t2, zero, 60
    csrrsi zero, mstatus, 8    # ★ 最后开总闸 MIE
spin:
    addi  t2, t2, -1
    bne   t2, zero, spin       # 空转（期间被异步打断，t3 递增）
    addi  a1, t3, 0            # a1 = 中断次数
    csrrci zero, mstatus, 8
    addi  t0, zero, 128
    csrrc zero, mie, t0
    csrrw  zero, mtvec, zero
    ecall
handler:
    addi  t3, t3, 1
    csrrs t0, mtimecmp, zero
    addi  t0, t0, 20           # 推迟闹钟，防中断风暴
    csrrw zero, mtimecmp, t0
    mret
```
网页操作：运行 → 在"波形"页勾选 `TRAP` 与 `t3(x28)`，可看到每次被中断打断那拍 TRAP 跳高、t3 阶梯递增。

### 9.3 教学提示

- 中断是**异步**的，可能在任何指令边界打断 → 初始化代码必须放在开总闸**之前**。
- 异常（ecall/非法指令）处理程序通常要 `mepc += 4` 跳过出错指令，否则 mret 回去又触发 → 死循环。
- `csrrsi/csrrci` 的立即数只有 5 位，操作 CSR 的 bit≥5 必须用寄存器版 `csrrs/csrrc`。

---

*本开发文档与代码同步维护；功能以实际代码为准。*
