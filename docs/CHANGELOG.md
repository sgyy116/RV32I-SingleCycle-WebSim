# 变更记录

> 本文件按「一轮工作」为粒度记录**改了什么、为什么改、怎么复验**。
> 逐条提交历史用 `git log` 看；本文件只覆盖提交粒度以上的整轮改动，从 2026-09-22 第二轮起。
> 更早的历史见文末表格。

出处更正：早期 README 和文末表格把参考项目称作「原始代码仓库」，并写过「导入学长 RV32I 单周期项目」。项目团队现确认 CPU 核心由自己编写，参考项目并非本项目的源码出处。表格保留当时的记录用语；现行来源说明以仓库根目录的 `README.md` 和 `LICENSE` 为准。

---

## v1.3.1（v1.3.0 的界面维护更新）

- 去掉顶部控制按钮的悬停解释；合并指令状态与缩放控件，并调整数据通路中的 0/1 标识、译码器、ADD/ALU 外形和 `src1_rdata` 标注。
- 左右侧栏可收起；窄窗口默认收起，顶栏换行，底栏贴合浏览器视口底部并适配安全区。
- 补齐版本谱系：v1.2.0 融合 v1.1.1 与 0922 原始稿，v1.3.0 在 v1.2.0 基础上融合 0923 原始稿。两份日期目录分别更名为 `RV32I-SingleCycle-WebSim-v1.2.0-原始快照` 和 `RV32I-SingleCycle-WebSim-v1.3.0-原始快照`；正式版仍以 `v1.2.0`、`v1.3.0` 标签区分。
- FPGA 接口仍在独立实验分支，不属于 v1.3.1。
- 本版本复验：模拟器 126 项、汇编器 55 项、差分 55/55、往返 9/9、离线综合检查 16 步和前端生产构建均通过。

---

## v1.3.0（基于 2026-09-23 版本）

本版本从 `release/v1.2.0` 派生，正式同步 0923 版的正确性修复和验证体系。主要包括：

- 修复 AUIPC、CSR 写回、非法编码处理和 gcc 错误回退。
- 完整实现并可视化 BEQ、BNE、BLT、BGE、BLTU、BGEU 六类条件分支。
- 补全微型汇编器伪指令、标签、十六进制偏移、`jalr` 写法和输入校验。
- 增加独立参考模型差分测试、汇编/反汇编往返测试、非法编码扫描和前端综合检查。

---

## 2026-09-23（第四轮）正确性审计：把「怎么知道自己是错的」补上

### 为什么

这一轮的起因是一句话：**正确性必须一丝不差，功能健全是硬性要求**。于是把整个产品
（后端 C++ 核心 / `asm.py` / 前端点亮语义 / 几何）从头审了一遍。

审出来的不是一个 bug，而是一个**结构性现象**：

> 后端算错 → 前端忠实映射这个错 → 断言全绿，三者可以长期共存。

标本是 AUIPC：`rv_control.hpp` 把它的 `AluOp` 写成 `PASS_A`（只透传 A），算出来的结果是
`pc` 而不是 `pc+imm`；而 `test_sim.py` 的期望值写的是 `st["state"]["pc"]`——**从被测对象
自己的 trace 里反查**，而错误实现恰好就是「结果 = pc」。再叠加 `test_basic.s` 用的
`auipc s5, 0`（imm=0 时正确与错误实现同值），这个 bug 潜伏至今。

**独立判据不能从被测对象的输出里取。** 这一轮补的三样东西（自写参照模型 / 汇编↔反汇编
往返 / 无法编码组合全扫描）都不是「多几条断言」，而是三类互相独立的判据。

### 做了什么

**1. 后端 6 个真 bug**

| # | 缺陷 | 修法 |
|---|---|---|
| 1 | **AUIPC 结果 = pc**，imm 被丢弃 | `rv_control.hpp` 由 `PASS_A` 改 `ADD`（一处枚举）|
| 2 | CSR 指令**真的写了寄存器**，图上「寄存器写使能」却灭着 | `rv_core.cpp` CSR 分支补 `out.ctrl.reg_write`（信号传递正确性问题，不是观感）|
| 3 | `taken` 判据只建模 BEQ（对另外 5 条分支**结构性错误**）| `rv_alu.hpp` 加 `less` 标志；`OP_BRANCH` 按 funct3 选 `SUB`/`SLT`/`SLTU`；`rv_core.cpp` 用两标志 + funct3 组出 taken |
| 4 | `rv_disasm.cpp` 把 RV32M 保留编码**静默当 RV32I 执行**（`mul` 被当 `add`，**不报错的错值**）| 按 RV32I 收口为非法指令 |
| 5 | 非法编码的反汇编文本拼成 `" gp, ra, sp"` 这类没指令名的碎片 | 出口守卫改用 `kind == INVALID`（原用 `text.empty()`，被非空垃圾绕过）|
| 6 | `compile_server.py` 在 gcc 编译失败时**静默回退**到微型汇编器 | 回退只在 gcc 不存在时启用；gcc 在就把它自己的报错原样交回 |

**2. 前端 11 根线的判据错了或恒亮**

`taken` 一族 3 根（`w_alu_zf` 曾写成 `active: () => true`，于是**每条指令**——addi、lw、jal——
都把 taken 点亮）+ PC 目标链 8 根（`w_immadd_m3` 正好接反、`w_m3_m2`/`w_m4_m2` 漏判 jal、
`w_m2_m1` 漏判不跳的分支、`w_add4_m1`/`w_add4_m4`/`w_m1_m6` 恒亮、`w_immadd_m4` 少了 branch 门）。
这和前两轮修掉的 `csr_we`/`dmem`/`csr` 是同一类病：**恒亮与接反都躲得过「必须包含」型断言。**

**3. `asm.py` 全量重写（这是产品功能，不是测试工具）**

本机与学生机器都**没有** `riscv-*-gcc`，`compile_server.py` 必然回退到 `asm.py`——
**它不支持什么，产品就不支持什么。** 实测 19 个用例：OK 7 / FAIL 12。补：`li`/`mv`/`nop`/
`ret`/`call`/`beqz`/`bnez` 伪指令、访存偏移收 `0x`（原来写 `0x10(sp)` 报
`'NoneType' object has no attribute 'group'`）、标签可行内、`jalr` 三种写法、`fp` 别名、
寄存器号校验、错误带**真实行号**。伪指令在**第一遍扫描**里展开 ⇒ PC 计数自动正确。
前端 `riscvLang.ts` 的 `MNEMONICS` 与 `asm.py` 逐条对齐（原先是双向不一致：前端高亮
`li` 而后端不支持，后端支持 `mret` 而前端不高亮）。

要特别注意：**代码必须改对，代码要能跑**——编码核心 `enc_r/i/s/b/u/j` 逐位核对过，
本身符合规范，缺陷全在入口解析。

**4. 验证体系（这一轮真正的主角）**

| 新增 | 作用 |
|---|---|
| `backend/test/difftest/`（7 文件，零依赖）| 自写 RV32I 参照模型 + 语料生成器 + 锁步比对（55/55）+ 汇编↔反汇编往返（9/9）+ 非法编码全扫描 |
| `docs/HL_CONTRACT.md` | 点亮契约——图上每根线/每个部件「本周期该不该亮」的判据，前端全部断言的**唯一来源** |
| `tools/check_all.py` | 一条命令跑完 16 步离线断言（原先 `_csr_test.s` 的状态流生成了却没人吃，那 4 条 CSR 反向断言**等于没跑**）|
| `tools/_hl_branch.s` | 补夹具缺口：`jalr` 整条通路此前**从未被点亮验证过**（`_hl_check.mjs` 里它是一条空条目）|

**5. 交付包 2026-09-23**

旧包 `RV32I-SingleCycle-WebSim-2026-09-22` 里那个预编译 `rv32i_sim.exe` **是修复前的旧代码**
（`启动-Windows.bat` 的逻辑是「有 exe 就跳过编译」⇒ Windows 学生会直接跑到错核心）。
根因是打包用 `git archive HEAD`，而 exe 在 `.gitignore` 里、不在 git 里，只能手工补一个。
本轮重打，并把打法改成：**工作树不干净时按 `diff -rq` 清单直接拷，不要用 `git archive`**
（它导出的是旧的已提交版本，会把本轮改动全丢掉）。

### 怎么复验

```bash
cd backend/test
python test_sim.py            # 126 通过
python test_asm.py            # 55 通过
python difftest/run.py        # 55/55
python difftest/roundtrip.py  # 9/9 组
cd ../.. && python tools/check_all.py   # 16 步
```

详细报告见 `docs/修复报告-2026-09-22.md`（11 节，每节按「症状 → 证据(文件:行) →
为什么原来没被发现 → 修法 → 怎么复验」写）。

---

## 2026-09-22（第三轮）分支判断单元重画 + PC 目标链信号修正

### 为什么

起因是「分支判断画错了」。查下去发现是两层问题叠在一起：

1. **后端**：`taken` 的判据原先是一张 `switch (d.kind)` 表——功能上对，但图上那个只有
   `branch` / `zf` 两个输入的 circle 完全表示不出来它。学生照着图学不到 `blt`/`bge` 是
   怎么判的。而且原图对 `bne`/`blt`/`bge`/`bltu`/`bgeu` 是**结构性错误**：只建模了 BEQ。
2. **前端**：PC 目标链上有 8 根线的判据是错的或恒亮（`w_immadd_m3` 正好接反、`w_m3_m2` /
   `w_m4_m2` 漏判 jal、`w_m2_m1` 漏判不跳的分支、`w_add4_m1` / `w_add4_m4` / `w_m1_m6` 恒亮、
   `w_immadd_m4` 少了 `branch` 这道门），学生看 jal / jalr / mret 的 PC 来路会得到错误结论。
   这和上一轮修掉的 `csr_we` / `dmem` / `csr` 是同一类病：
   **恒亮与接反都躲得过「必须包含」型断言。**

### 做了什么

**1. `taken` 单元的判据重新推导（后端 + 几何 + 语义三层一起改）**

先证明「小改不可能」：没有任何二元 ALU 运算的零标志能表示「不相等」，所以只要
`alu_op` 按 funct3 分派，零标志最多只能编码 BEQ/BNE 这一对且极性固定。要覆盖六条分支，
图上必须多出两条输入线和一个 ALU 输出。最终编码：

```
base  = funct3[2] ? alu.less : alu.zero        // f3[2] 在「小于」与「相等」之间选一路
taken = branch && ( funct3[0] ? !base : base ) // f3[0] 选极性
```

`funct3[1]` 不参与 taken——它决定后端在 `SLT` / `SLTU` 之间选哪个 `alu_op`，
有符号/无符号的差别就落在那里（`rv_control.hpp` 的 `OP_BRANCH`）。

| 层 | 改动 |
|---|---|
| 后端 | `rv_alu.hpp` 新增 `less` 标志（`result & 1`）；`rv_control.hpp` 的 `OP_BRANCH` 按 funct3 选 `SUB`/`SLT`/`SLTU`；`rv_core.cpp` 用两个标志位 + funct3 组出 taken；JSON 增发 `alu.less` |
| 几何 | `taken` 由 circle 改 rect（circle 的上下端口被 `check_layout.py` 强制在 `w/2` 处，放不下 5 个输入）；新增 3 条线（`w_dec_f3sel` / `w_dec_pol` / `w_alu_lt`）、3 个端口，`w_dec_beq` 更名 `w_dec_branch`，`decoder.beq_out` 更名 `decoder.branch_out`；`alu` 的 `sub` 标签由 `ZF OF F` 改为 `ZF LT F` |
| 语义 | `datapathHighlight.ts` 新增 `f3bit()`；`w_alu_zf` 收紧为 `branch && !f3[2]`；新增 `w_alu_lt` ⟺ `branch && f3[2]` |

**2. PC 目标链的 6 根线按统一规则修正**

定下**点亮契约**（新文档 `docs/HL_CONTRACT.md`）：一个 MUX 只点亮它本周期选中的那一路
数据输入，另一路灭；判据落在**端口**上（线汇入 `X_0`/`X_1` 就由 X 自己的 sel 决定），
与下游有没有用到无关。四选一通路因此永远恰好亮一路，可以直接写成互斥断言。

修正的线：`w_immadd_m3`（`is_jalr` → `!is_jalr`，原来正好接反）、`w_m3_m2`（→ `jumpOrJalr`）、
`w_m4_m2`（→ `!jumpOrJalr`）、`w_m2_m1`（→ `pcSel`）、`w_add4_m1`（→ `!pcSel`）、
`w_add4_m4`（→ `!(branch && taken)`）、`w_immadd_m4`（→ `branch && taken`）、
`w_m1_m6`（恒亮 → `!isMret`）。

**3. C9：`compile_server.py` 不再静默回退**

原逻辑是「gcc 在但编不过 → 悄悄改用微型汇编器」，学生拿到的是另一个编译器报的、
行号措辞都对不上的错误，甚至可能被宽松语法「编成功」跑出另一个程序。现在 gcc 存在时
失败即失败，回退只在 gcc 根本不存在时启用。⚠ 本机没有 RISC-V gcc，这条分支**跑不到**，
只在代码层改对。

### 验证

```bash
python tools/check_all.py          # 16 步全过（几何 + 高亮 + 波次 + 语言表 + 4 份夹具）
                                   # 本轮新增：check_all.py 本身，把散落的断言串成一条链
cd backend/cpp && g++ -std=c++17 -O2 -Wall -Wextra -I src src/main.cpp src/rv_core.cpp \
    src/rv_disasm.cpp -o build/rv32i_sim.exe    # 零警告
cd backend/test && python test_sim.py           # 126 通过（新增测试 6：六条分支 × 正反）
python test_asm.py                              # 55 通过
python test_server.py                           # 11 通过
cd frontend && npm run build                    # vue-tsc 无错
```

新增夹具 `tools/_hl_branch.s`：六条分支各一正一反（同一助记符、同一对操作数，只差跳与
不跳）、jal、jalr、lui、auipc。`x3 = -1 = 0xFFFFFFFF` 让 `blt` 与 `bltu` 结论相反——
这是 `SLT`/`SLTU` 有没有选错的唯一判据。

断言侧的补强：

- `_hl_check.mjs` 的 EXPECT 由「必须包含」升级为 `{must, mustNot, when}` 三元组，
  并报告「本条断言一次都没匹配上」——空断言（原 `jalr` 那条）就是这么躺过好几轮的。
- `_wave_check.mjs` 新增 MUX 互斥表（7 个 MUX）与 taken 的 ZF/LT 二选一断言、
  pcmux6/pcmux5 的 mepc/mtvec 分道断言。
- 新文档 `docs/HL_CONTRACT.md`：契约与逐条判据表，断言按它写。

### 顺带查清的一件事（原先报错了，更正）

`w_wb0_wb`（⟺ `!isCsr`）与 `w_wb1_wb`（⟺ `!jumpOrJalr`）判据不同，上一轮怀疑是缺陷。
本轮核对布局后确认**没问题**：`w_wb0_wb` 是 wbmux1 的 0 口（sel=`is_csr`），
`w_wb1_wb` 是 wbmux1 的**输出**、汇入 wbmux 的 0 口（sel=`jumpOrJalr`），两者本来就是
不同级的 MUX，判据不同是对的。

### 本轮未做（诚实标注）

- **自写独立参照模型 + 差分测试**（原计划的 B 项）：这是唯一能证伪「后端整体正确」的
  手段，本轮没做。当前后端正确性由 126 条断言覆盖，而断言与实现同源——`auipc` 那类
  「实现错 + 断言自证」的错，只有独立判据能抓。
- 波次顺序断言只覆盖 7 对固定顺序（ALU 操作数链、写回链内部次序无检查）。
- 端口没有 `dir` 字段，线的 from/to 画反了没有任何断言管。
- 几何只验「自洽」，没有与原图 `示意图.png` 叠加比对。

---

## 2026-09-22（第二轮）数据通路「信号逐波传播」动画

### 为什么

数据通路图原先只能看**结果**：`computeHighlight(state, layout)` 一次吃下整个 `cycle_state`，
返回全图高亮——整条通路在同一瞬间点亮，没有「谁先于谁通」的维度。学生看不出信号是在组合
逻辑里一级一级传下去的。单周期 CPU 里**一条指令 = 一个时钟周期**，所以缺的不是「指令周期
vs 时钟周期」，而是**一条指令内部组合逻辑的传播延迟**。

### 做了什么

**1. 波次计算（纯前端、纯函数）**

新增 `frontend/src/data/datapathWave.ts`：把高亮按拓扑深度切成若干「波」。

难点是数据通路里有反馈环（`wbmux → regfile.wdata`、`wbmux1 → PC.pc_next`、`csr → wbmux → csr`），
环上最长路径无定义。解法是**把时钟沿切开的写端口当汇点**，环就断了——读端口是组合的，不切：

```ts
const SINK = {
  PC:      ['pc_next'],
  regfile: ['wdata', 'wen', 'waddr'],
  dmem:    ['d', 'we'],
  csr:     ['wdata_in', 'we_in'],
}
const nodeOf = (m, p) => (SINK[m] || []).includes(p) ? m + '#in' : m
```

分层只在**本周期激活的连线**（`hl.wires`）上算，所以每层非空，且 `lui`/`jal` 这类短路径指令
波数天然更少。常量模块（`clkmod`/`const0`/`const4`/`reset`）在 `ALWAYS_LIT` 里，不占波次、全程点亮。

**2. 播放状态机**

新增 `frontend/src/stores/wave.ts`，持有 `index`（已点亮波数）/ `playing` / `speed`，
以及一个**自持有的 `setTimeout` 链**。

`sim.step()` 是 WebSocket 往返、**异步**，所以「需要后端走一拍」的动作要挂 `pending` 标记，
等新 `cycleState` 到达再动画面。中途改速用 `setTimeout` 自递归、每拍重读 `speed`
（不是 `setInterval`，否则每拖一下滑块就重置节奏）。

**3. 按钮语义**（`AppHeader.vue`）

| 按钮 | 行为 |
|---|---|
| 【单步】 | 前进一波；本条已全亮则执行下一条并亮它第 1 波 |
| 【单条指令】 | 把这条剩余的波按设定速度播完，停在「全亮」态 |
| 【运行】 | 播完一条自动走下一拍，直到停机或暂停 |
| 【暂停】 | 停在当前波 |
| 【复位】 | 复位 CPU，波次一并清空 |

「流动速度」滑块复用原 `runSpeed`，单位改为**波/秒**（1～20，默认 5）。

**4. `simulator.ts` 删掉 `run()` / `runTimer` / `runSpeed`**

原先那个 `setInterval` 会绕过波次只顾发 `step`，两个定时器同时发 `step` 更是灾难。
连续播放改由 `wave` 独占驱动，每播完一条才发一次 `step`。
（后端仍接受 `{"type":"run"}`，Python 中间层与 C++ 核心**一字未改**。）

**5. 面板门控**

右侧三个面板按**卡片**（不是按字段）门控——40 来个字段逐个标波次必然漂移，
学生看的也是「这一栏到了没有」。映射见 `datapathWave.ts` 的 `gateOf()`。
波形图**不跟波次**：它是跨周期视图，同一列只画该周期的最终值，没有「波内」概念。

### 顺手修掉的 3 个高亮 bug

三个都在 `frontend/src/data/datapathHighlight.ts`，是**改面板门控时顺着查出来的**，
按依赖顺序一层层剥开：

| # | 症状 | 根因 |
|---|---|---|
| 1 | `csr_we` 网络**从来没亮过** | `bin()` 忘了切 `"0b"` 前缀。`parseInt("0b001", 2)` 在 `b` 处停下返回 **0**——`"0b001"/"0b010"/"0b111"` 全变 0。后端的 `bin_str()`（`json_writer.hpp:50-56`）发的正是带前缀写法；与之对称的 `u32()` 不用切，因为 `parseInt(v,16)` 本身就认 `0x`，当初照抄时漏了这层差异 → `csrWe()` 恒为 false |
| 2 | `lw` / `sw` / `lui` 误亮 CSR | `csrWe()` 没判「必须是 SYSTEM 型」。后端的整张 `do_write` 表套在 `if (in.op.opcode == OP_SYSTEM)` 里（`rv_core.cpp:379`），而 `funct3` 只是第 [14:12] 位：`lw`/`sw` 的 funct3 恰好是 `0b010`（= CSRRS）、`lui 0x80001` 的 bits[14:12] 恰好是 `0b001`（= CSRRW），于是「CSR 写使能」在一条 load 上亮了起来 |
| 3 | `csr` 部件**每条指令都亮** | `src1_rdata` 写成 `active: () => true`，它挂在 `csr.wdata_in` 上，把 CSR 寄存器组拖成恒亮——和 `dmem` 被时钟线 `w_clk_dmem` 点亮是**同一类病** |

bug 1 之所以长期没人发现，是因为当时所有断言都是「**必须包含**」型，
而 `csr_we` 从来没进过任何 EXPECT 清单——**「本该亮却没亮」不在任何清单里**。

### 验证

```bash
# 1) 吐逐周期状态（三份覆盖不同指令组合的汇编）
python tools/_states.py tools/_hl_test.s    tools/out/_hl_states.jsonl
python tools/_states.py tools/_hl_ecall.s   tools/out/_hl_ecall_states.jsonl
python tools/_states.py tools/_csr_test.s   tools/out/_csr_states.jsonl

# 2) 高亮断言：每条指令必须点亮哪些连线/网络
node tools/_hl_check.mjs  tools/out/_hl_states.jsonl        # 10 周期，失败 0

# 3) 波次断言：每波非空、物理顺序（PC 早于 imem、alu 早于 wbmux…）、
#    dmem/trapunit/csr 只在真正用到它们的指令上有波次
node tools/_wave_check.mjs tools/out/_hl_states.jsonl       # 10 周期，失败 0，波数 8~14
node tools/_wave_check.mjs tools/out/_hl_ecall_states.jsonl #  7 周期，失败 0，波数 10~14
node tools/_wave_check.mjs tools/out/_csr_states.jsonl      # 13 周期，失败 0，波数 8~11

# 4) 几何与 CSS
python tools/check_layout.py                                # exit=0
node tools/hl_preview.mjs tools/out/_csr_states.jsonl 0     # 不 throw 即证明 CSS 无 < 和 &

# 5) 前端能编译
cd frontend && npm run build                                # vue-tsc + vite ✓
```

最关键的一条护栏在 `_wave_check.mjs`：`sliceHighlight(hl, plan, plan.count)` 必须与原始 `hl`
的 wires/modules/nets **完全相等**——它证明动画只是把同一份高亮**切片**，没动任何语义。

`tools/_csr_test.s` 是新加的用例，把 6 个 CSR 变体 + `do_write` 真/假 + 非 CSR 指令摆了一遍，
每行注明期望的 `src1_rdata` 状态。`_wave_check.mjs` 里新增的 4 条断言刻意**不重抄后端那张
`do_write` 表**，只挑能独立成立的事实，尤其是「本该亮却没亮」这一类。

### 人工验收

**浏览器里的实际点击观感**无法离线验证：无头 Edge 点不了按钮，`node_modules` 里既无
puppeteer 也无 playwright。离线断言只能证明**每一波点亮了什么**是对的，证明不了观感。

**2026-09-22 已由用户人工点过一遍，确认效果无误**（逐波流动、按钮时序、面板随波次出现）。
本轮改动另有 4 个提交推送至 `origin/main`（`f74cf21` → `4ddf710`）。

`tools/out/` 在 `.gitignore` 里，上述验证产物（SVG/PNG/jsonl）不入库，用命令随时可重新生成。
逐波看图：`node tools/hl_preview.mjs tools/out/_hl_states.jsonl <周期号> <波次k>`，
输出 `tools/out/hl-cycle<周期号>.svg`，参数 4 从 1 递增就是离线版的【单步】。

### 文档

- `使用说明.md` §三：原写「点**单步**一条条执行」，已重写为新按钮语义，并新增小节
  「数据通路图是怎么「动」的」
- `README.md`：特性段拆出「信号逐波传播动画」；通信协议删掉 `{"type":"run"}`
  （后端仍支持，本前端不再发）并加注说明
- `docs/DEVELOPMENT.md`：§6.1「前端**不计算**」已不成立（波次是纯前端算的），改为
  「不计算 CPU 语义」；§6.2 文件表补 `stores/wave.ts` / `data/datapathWave.ts`，
  并修正一处**既存错误**（表里写的 `DatapathCanvas.vue` 并不存在，实际是 `DatapathView.vue`）；
  新增 §6.3.3 讲波次算法；§8 补前端离线断言的用法

---

## 2026-09-22（第二轮·收尾）交付打包与换行符陷阱

### 为什么重打包

上一个交付包 `RV32I-SingleCycle-WebSim-2026-09-21` 已经在三个方面过期：

1. 它是**删死代码之前**打的，仍含 `figma/` 和 5 个已解除引用的组件文件；
2. 它**没有逐波传播动画**（不含 `datapathWave.ts`）——即本轮的主体功能；
3. `README.md` 里还写着 `./start.sh`，而交付包按惯例会剔掉 `start.sh`，是个指不到的死指令。

**交付包与 GitHub 的分工**（常有误解）：GitHub 是给**会用 git 的人**的源码仓库；zip 是给
**不会 git 的人**双击即用的包。仓库里**什么都不缺**（被 ignore 的只有可再生成的产物），
zip 唯一的实质优势是**内置了预编译的 `rv32i_sim.exe`**——因为 exe 不入库，非 git 用户拿到源码也跑不起来。

### 打法（照抄即可）

```bash
# 1) 导出：git archive 会自动排除所有被 ignore 的东西
git archive HEAD | tar -x -C <包目录>

# 2) 手工补 backend/cpp/build/rv32i_sim.exe   ← exe 不在 git 里，必须单独拷
# 3) 剔掉 start.sh 与 .gitignore             ← 09-21 起交付包的惯例
# 4) 逐文件修换行（见下）：.bat 保 CRLF，其余文本一律 LF，二进制跳过
# 5) 压 zip（Git Bash 没有 zip 命令，用 PowerShell 的 4 参数 .NET 重载）
```

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $src, $dst,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $true)   # 第 4 参 = 包一层同名文件夹
```

### ★ CRLF 大坑（本轮踩过）

`git archive` 会应用 `core.autocrlf=true`，把导出内容里的 LF **全部**转成 CRLF。`.bat` 正好转对，
但 **`.sh` 一起被转成 CRLF，Linux 上直接 `bad interpreter: /bin/bash^M` 跑不起来**。
这个问题只有跟旧包逐文件对比行尾才发现——看文件名和体积完全正常。

修法是导出后过一道 Python：**前 8KB 含 `\x00` 视为二进制跳过；`.bat` 强制 CRLF；其余一律 CRLF→LF**。

**根因已修**：仓库加了 `.gitattributes` 钉死这两类文件的行尾（`*.bat text eol=crlf` / `*.sh text eol=lf`）。
此后一次干净的 `git archive` 导出即为 `.bat`=CRLF、`.sh`=LF，不必再手工校正；反方向也一并修好——
此前 `.bat` 的 blob 存的是纯 LF，**在 Linux 上 clone 会拿到 LF 行尾的坏 `.bat`**。

**没做的那一刀**：没有加 `* text=auto eol=lf`。加了它，`git archive` 对所有非 `.bat` 文本都直接出 LF，
上面那道手工步骤就能彻底删掉；但代价是**仓库里 96 个文件在 Windows 上的检出行为全部改变**。
权衡下来不值——CRLF 对 `.py` / `.ts` / `.vue` / `.md` / `.json` 在两个平台上都无害（Python 照读、
Vite 照编），当初真正会**跑不起来**的只有 `.sh` 一类，而它在源头已经钉死。
所以那道手工转 LF 现在**只剩美观意义，不再修 bug**。

### 验证手法

```bash
# 逐文件与 git blob 比对（中文名必须关掉 quotepath，否则被转义成 "\344..." 造成假报警）
git -c core.quotepath=false ls-tree -r HEAD --name-only

# 直接读 zip 里的字节查换行符 + 算 exe 的 sha256 + 数条目
```

判定标准：包内文件与 git blob **96/96 一致**，多出来的只有**故意补进去的 exe**，
且 exe 的 sha256 与仓库内那份相同；无 `node_modules` / `.git` / `__pycache__`；中文文件名完好。

### 结果

包 `Desktop\工互院项目\RV32I-SingleCycle-WebSim-2026-09-22`（+ 同名 zip，279.3 KB / 97 条目）：
内容 96/96 与 git blob 一致，`.sh`=LF、`.bat`=CRLF，exe sha256 吻合。**09-21 那版原样保留，未动。**

> ⚠️ **这版已被 2026-09-23 那版取代，不要再用**：它的预编译 exe 是修复前的旧代码
> （AUIPC 算错、`taken` 只认 BEQ、非法编码照跑），原因见上面第四轮的第 5 条。
> 三版包都原样保留在 `Desktop\工互院项目\` 下。

### 未能验证的

**包内端到端跑一遍没做**：需要 `npm install`，且开发用的 5173 / 8080 / 8081 三个端口被本机开发环境占着。
所以 `.sh` / `.bat` 的正确性是**字节级**验证的（行尾、可执行位、语法是肉眼过的），不是**执行级**验证的。

---

## 更早的历史

提交粒度以上未单独记录，逐条见 `git log`：

| 提交 | 日期 | 内容 |
|---|---|---|
| `1e3ea4d` | 2026-09-22 | 清理：删除死代码与过时资源 |
| `a4bf8ae` | 2026-09-22 | 数据通路图 JSON 化 + 接入前端逐周期高亮 |
| `70e213d` | 2026-09-03 | 交付文件入库：双系统启动器 + 使用说明 |
| `5e2ba72` | 2026-09-03 | 开发文档 + 中断演示程序入库 |
| `83244b9` | 2026-09-03 | 前端：新增波形图面板（GTKWave 风格）|
| `8dee13b` | 2026-09-02 | 前端显示中断/异常 + 修复加载器小文件 bug |
| `aa52cff` | 2026-09-02 | 测试与文档：test_server.py Windows 修复 + README 更新 |
| `d1b144d` | 2026-09-02 | 中间层：修复 Windows 下选错 Linux 旧模拟器的问题 |
| `ab3e3ed` | 2026-09-02 | 后端中断/异常 第⑥步：JSON 输出 trap 信息与 CSR 快照 |
| `d3d2a00` | 2026-09-02 | 后端中断/异常 第②⑤步：非法指令 trap + 计时器中断，并修复不跳转分支 bug |
| `7139df6` | 2026-09-02 | 后端中断/异常 第③步：加 mret + 修复 CSR 寄存器版 bug |
| `feddcee` | 2026-09-02 | 后端中断/异常 第①步：ecall/ebreak 改为真 trap |
| `c0e20df` | 2026-09-01 | 添加版权出处声明（README）与教学用途 LICENSE |
| `5196044` | 2026-09-01 | 导入学长 RV32I 单周期项目 + Windows 兼容性修复 |
| `177849d` | 2026-08-02 | Initial commit |
