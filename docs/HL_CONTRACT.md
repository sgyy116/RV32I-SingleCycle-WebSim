# 数据通路高亮的「点亮契约」

> 这是判断「哪根线该亮」的**唯一判据来源**。`frontend/src/data/datapathHighlight.ts` 的
> `WIRE_SIGNAL` / `NET_SIGNAL` 按它写，`tools/_hl_check.mjs` 与 `tools/_wave_check.mjs`
> 的断言也按它写。两边独立写、互相交叉验证，而不是拿实现去验实现。

---

## 1. 一句话

**一根线本周期亮 ⟺ 这一拍它真的在传值；一个部件亮 ⟺ 至少有一根相邻的线、或一个挂在它端口上的网络亮。**

## 2. 四种线，四种判据

| 类别 | 判据 | 例子 |
|---|---|---|
| 电源线 | 常亮。**只点亮电源自己，不点亮受驱端** | `w_clk_dmem`（否则 dmem 每条指令都亮） |
| 数据线 | 显式写死的条件 | `w_alu_dmem` ⟺ `mem_read \|\| mem_write` |
| 控制线 | 显式写死的条件 | `w_ctl_sw` ⟺ `mem_write` |
| 端口注解网络 | `NET_SIGNAL` 按网络名判；`pc` / `pc+4` 常亮（见 §5） | `csr_we`、`mtvec`、`mepc` |

部件的点亮不是手写的：`computeHighlight` 从「激活的线 → 两端端口 → 部件」反查出来。
所以只要线写对，部件就跟着对；线的条件写错，部件一定跟着错。

## 3. MUX 规则（本项目的拍板结论）

**每个 MUX 只点亮它本周期选中的那一路数据输入，另一路灭。**

判据落在**端口**上，不落在线上：一根线只要汇入 `X_0` / `X_1` 这样的数据输入端口，
它的亮灭就由 **X 自己的 sel** 决定，与 X 的输出下游有没有被用到**无关**。

形式化：线 `w` 汇入 MUX `X` 的第 k 路数据输入（k ∈ {0,1}）⟹
`w 亮 ⟺ X 本周期选中第 k 路`。四选一通路上的 MUX，因此永远恰好亮一路数据输入——
这一条可以直接写成互斥断言（`tools/_wave_check.mjs` 的 `MUX_DATA` 表）。

### 为什么不用「递归」那条读法

另一条可能的读法是：只点亮最终从 PC / 写回端反推出来的那条**有效通路**。否决理由：

1. 一条 `addi` 会让整条 PC 目标链（pcmux1..4、pcimmadder、jalrclean）全灭；`jal` 会让
   `pc4adder` 灭——可 `jal` 的写回值**正是** pc+4，图上反而看不到它在干活。
2. `pc+4` 在布局里是挂在端口上的注解网络（`wbmux.wb_1`），不是线；递归判据没法只作用于
   「MUX 的数据输入」这一层，会把注解网络也卷进来。
3. 局部规则能直接写成互斥断言；递归规则要把「有效通路」再实现一遍，等于给断言引入
   第二套语义——**断言与被测实现同源，就抓不到错**。

### 已知副作用（接受）

非跳转指令下 `w_add4_m4`、`w_immadd_m3` 也会亮：pcmux4 的 sel 是 `taken`（=0）确实选了
pc+4 那一路，pcmux3 的 sel 是 `is_jalr`（=0）确实选了 pc+imm 那一路。这是组合逻辑的事实，
不是错。「这一拍谁在干活」由各自的 **sel 线**回答，不由数据线回答。

## 4. 逐条判据表

### 4.1 PC 目标链（五选一：pcmux4 → pcmux3 → pcmux2 → pcmux1 → pcmux6 → pcmux5）

| 线 | 从 → 到（MUX 的哪一路） | 亮 ⟺ | 用户可见含义 |
|---|---|---|---|
| `w_add4_m1` | pc4adder.out → pcmux1.m1_0 | `!pcSel` | pcmux1 选了 pc+4 |
| `w_m2_m1` | pcmux2.m2_out → pcmux1.m1_1 | `pcSel` | pcmux1 选了 pcmux2 |
| `w_m4_m2` | pcmux4.m4_out → pcmux2.m2_0 | `!jumpOrJalr` | pcmux2 选了 pcmux4 |
| `w_m3_m2` | pcmux3.m3_out → pcmux2.m2_1 | `jumpOrJalr` | pcmux2 选了 pcmux3 |
| `w_immadd_m3` | pcimmadder.out → pcmux3.m3_0 | `!is_jalr` | pcmux3 选了 pc+imm |
| `w_jalr_m3` | jalrclean.out → pcmux3.m3_1 | `is_jalr` | pcmux3 选了 &~1 后的目标 |
| `w_add4_m4` | pc4adder.out → pcmux4.m4_0 | `!(branch && taken)` | pcmux4 选了 pc+4 |
| `w_immadd_m4` | pcimmadder.out → pcmux4.m4_1 | `branch && taken` | pcmux4 选了 pc+imm |
| `w_m1_m6` | pcmux1.m1_out → pcmux6.m6_0 | `!isMret` | pcmux6 选了 pcmux1 |
| `w_m6_m5` | pcmux6.m6_out → pcmux5.m5_0 | `!trap.taken` | pcmux5 选了 pcmux6 |
| `w_m5_pc` | pcmux5.m5_out → PC.pc_next | 常亮 | PC 一定取 pcmux5 的结果 |

sel 线（各自挂在对应 MUX 的 `_sel` 端口上）：

| 线 | 亮 ⟺ |
|---|---|
| `w_sel_m1` | `pcSel = branch \|\| jump \|\| is_jalr` |
| `w_sel_m2` | `jumpOrJalr = jump \|\| is_jalr` |
| `w_sel_m3` | `is_jalr` |
| `w_taken_m4` | `taken = branch && branch.taken` |
| `w_alu_jalr`（alu.f_out → jalrclean.in） | `is_jalr` |
| `w_ctl_link`（decoder.link_out → wbmux.wb_sel） | `jumpOrJalr` |

pcmux6 的 sel 是注解网络 `is_mret`，pcmux5 的 sel 是注解网络 `trap_taken`，
两者的 1 口分别是注解网络 `mepc` / `mtvec`（不画线，见 §5）。

### 4.2 EX / MEM / WB 的 MUX

| MUX | 0 口（亮 ⟺） | 1 口（亮 ⟺） |
|---|---|---|
| muxa0（sel=`is_lui`） | `w_rf_ma0` ⟺ `!is_lui` | `w_imm_muxa0` ⟺ `is_lui` |
| muxa（sel=`is_auipc`） | `w_muxa0_muxa` ⟺ `!is_auipc` | 注解网络 `pc`（常亮） |
| muxb（sel=`alu_src`） | `w_rf_mb1` ⟺ `!alu_src` | `w_imm_muxb` ⟺ `alu_src` |
| wbmux0（sel=`mem_to_reg`） | `w_alu_wb0` ⟺ `!mem_to_reg` | `w_dmem_wb0` ⟺ `mem_to_reg` |
| wbmux1（sel=`is_csr`） | `w_wb0_wb` ⟺ `!isCsr` | 注解网络 `csr_old` ⟺ `isCsr` |
| wbmux（sel=`jumpOrJalr`） | `w_wb1_wb` ⟺ `!jumpOrJalr` | 注解网络 `pc+4`（常亮） |

### 4.3 taken 单元

`taken` 的输出（进 pcmux4 的 sel）：

```
base  = funct3[2] ? alu.less : alu.zero      // f3[2] 在「小于」与「相等」之间选一路
taken = branch && ( funct3[0] ? !base : base ) // f3[0] 选极性
```

所以六条分支恰好都由这两位组出来，`funct3[1]` 不参与（它只决定后端选 SLT 还是 SLTU，
那个差别落在 `alu_op` 里，图上没有对应的线）：

| funct3 | 指令 | base | 极性 |
|---|---|---|---|
| 000 | beq | ZF | 不取反 |
| 001 | bne | ZF | 取反 |
| 100 | blt | LT（SLT，有符号） | 不取反 |
| 101 | bge | LT（SLT） | 取反 |
| 110 | bltu | LT（SLTU，无符号） | 不取反 |
| 111 | bgeu | LT（SLTU） | 取反 |

对应的线：

| 线 | 亮 ⟺ |
|---|---|
| `w_dec_branch`（decoder.branch_out → taken.branch_in） | `branch` |
| `w_dec_f3sel` → taken.f3sel_in | `branch`，值 `f3[2]=0/1` |
| `w_dec_pol` → taken.pol_in | `branch`，值 `f3[0]=0/1` |
| `w_alu_zf`（alu.zf_out） | `branch && funct3[2]==0` |
| `w_alu_lt`（alu.lt_out） | `branch && funct3[2]==1` |
| `w_taken_m4` | `taken = branch && branch.taken` |

`branch` 是六条线共同的门，`w_dec_branch` 在每条分支上都亮，因此
**taken 部件被点亮 ⟺ 这条指令是分支**，两个方向都成立（这条等价性是断言，不是观察）。

## 5. 故意不守规则的地方（都是注解网络）

`net` 字段是「这条端口接的是这个信号」的标注，不画线。所以：

- `pc`（挂在 `pcimmadder.a_pc`、`muxa.ma_1`）与 `pc+4`（挂在 `wbmux.wb_1`）**常亮**：
  它们表示端口的接线对象，不表示这一拍被选中。
- `mepc` / `mtvec` / `csr_old` 有条件（⟺ `isMret` / `trap.taken` / `isCsr`），与它们所挂
  MUX 的 sel 一致。
- 因此 **wbmux 与 muxa 的一对输入不构成「线级互斥」**：1 口是注解网络，不是线。这两处
  只能断言「0 口那一侧」的条件，`MUX_DATA` 表里也刻意没放它们。

## 6. 谁在守这条契约

| 脚本 | 守什么 |
|---|---|
| `tools/_hl_check.mjs` | 逐条线/网络/部件的**双向**断言（`must` / `mustNot`），含六条分支正反 12 种组合、jal/jalr 分道、CSR 写使能与 rd=0 反例 |
| `tools/_wave_check.mjs` | MUX 互斥（`MUX_DATA`）、taken 的 ZF/LT 二选一、pcmux5/6 的 mepc/mtvec 分道、dmem / csr / trapunit 反向断言、波次非空、切片回归（播到底 == 静态高亮） |
| `tools/check_layout.py` | 几何：间距/重叠/端口位置（管不到语义） |
| `tools/check_dangling.py` | 悬空端口（没线也没网络标签的输入） |
| `tools/_lang_check.mjs` | 前端关键字表 ↔ `asm.py` 实际能力 |
| `tools/check_all.py` | 一条命令跑完上面全部（含从夹具重新生成状态流） |

**加线/改线的规矩**：先在本文件里写下它该满足的条件 → 再改 `datapathHighlight.ts`
→ 再往上面任一个 check 里加断言。没有断言的线，等于没人看着。
