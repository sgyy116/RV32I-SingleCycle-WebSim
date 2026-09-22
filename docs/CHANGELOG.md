# 变更记录

> 本文件按「一轮工作」为粒度记录**改了什么、为什么改、怎么复验**。
> 逐条提交历史用 `git log` 看；本文件只覆盖提交粒度以上的整轮改动，从 2026-09-22 第二轮起。
> 更早的历史见文末表格。

---

## v1.2.0（2026-09-23）

### 做了什么

- 按《具体说明.md》移植 1.1.1 的界面改动：杭州电子科技大学 Logo、白色加粗控制按钮、历史步进文字、编辑器“自定义”选项、指令列表滚动条与鼠标滚轮，以及数据通路缩放滑块。
- 将数据通路中的 `taken` 从 BEQ 专用输入改为通用条件分支输入；`w_dec_branch` 与 `state.branch.taken` 覆盖 BEQ、BNE、BLT、BGE、BLTU、BGEU。
- 调整数据通路高亮线型、字号、去阴影效果，并将波形数值标注移到高电平线下方，避免文字压线。
- 在独立 Git 工作树 `release/v1.2.0` 中维护本正式版本，原 0922 目录保持不改。

### 复验

- `backend/test/test_sim.py`
- `backend/test/test_branch_conditions.py`
- `tools/test_branch_visual.mjs`
- `tools/check_layout.py`
- 前端生产构建

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
