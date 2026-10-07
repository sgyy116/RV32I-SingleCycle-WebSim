# 变更记录

## 2026-10-07：v1.4.1 界面二次修正

根据用户反馈，在原 1.4.1 工作树内修正四处：左右标签改为等宽分布、缩小两侧留白；图例“线的类别”改为“线条类别”；缩放与周期条改为白底深色字的直角长方形，滑轨及高亮字色同步适配白底；右侧收起按钮由 suffix 移至 prefix，位于该栏左端。

版本号保持 1.4.1，不新建工作树、不修改后端、不推送。新增真实浏览器断言先在旧实现上观察四项失败，再验证修订后样式、标签占宽与按钮位置。用户明确要求跳过后续 brainstorming 重复确认，已记录项目须知。

## 2026-10-07：本地修订 v1.4.1

按 1.4.0 的《具体说明.md》补齐历史界面规范：标签居中加粗、部件名黑色与端口灰色、波形增大字号和长数值省略、0.6～3 倍缩放。工具条统一深色胶囊、图区背景统一。部件框不再继承虚线，真实参与传输的端口同周期闪烁；离线高亮 SVG 同步。

左右收起仅保留浮动按钮，不再占整条竖栏；组件状态继续保留。波形去掉 PC/ALU 选项与轨迹，其余信号不变。

真实浏览器复现并修复：手动单步遇 mtvec=0 的停机异常，最后一条动画未完成就被停机状态锁死；异常横幅一律声称跳转，即使后端已经停机。仅修改前端动画可用条件与显示，不改变核心语义。

只读审查进一步发现停机后补播再暂停会解除执行保护。回归复现后，停机判定保留最新执行快照，暂停与浏览历史不解除后端停机；step 增加保护，避免覆盖异常快照。复位／新加载程序仍正常解除保护。

新增异常／中断使用说明与 UI 回归脚本，更新 VERSION、包版本、Git 管理和两份版本说明。版本从 f22ea12 建立 fix/ui-v1.4.1，保留 1.4.0，不合入 main、不推送、不改已有标签。复验详情见 `docs/验证记录-v1.4.1.md`。

## 2026-10-03：本地主库整合 v1.4.0

从主库 v1.3.1 及其出处更正提交 9405392 建立功能工作树，接入小组交付版本的词典、六类配色和静态托管，同时恢复已有 UI：无控制按钮悬停说明、编辑器内唯一示例选择、带文字历史按钮、缩放滑块与 1:1、指令列表滑块、无阴影流动高亮、波形字号与高位数值避让。

保留 0/1 圆框、译码器端口避让、ADD/ALU 统一凹口和 src1_rdata 标签。侧栏折叠保留实例，避免丢失撤销记录与面板选择。页脚恢复窄屏换行和安全区；顶栏、底栏实测高度同步给词典浮层，避免工具栏换行后遮挡。

恢复 VERSION、两份版本说明、Git 忽略规则与 SVG 参考图，增加行尾规则、版本命名与管理说明；前端包版本同步为 1.4.0。该版本为本地整合工作，尚未合入 main 或推送。小组下方的轮次记录保留为来源历史，不能据其提交号推断本主库历史。

验证记录见 `docs/验证记录-v1.4.0.md`。

---

> 本文件按「一轮工作」为粒度记录**改了什么、为什么改、怎么复验**。
> 逐条提交历史用 `git log` 看；本文件只覆盖提交粒度以上的整轮改动，从 2026-09-22 第二轮起。
> 更早的历史见文末表格。

---

## 2026-10-01（第九轮）界面三改：响应式 / 连线配色标准 / 顶栏

### 为什么

用户提了三件事，查完发现**三个问题的真实原因都和表面现象不是一回事**：

| 表面现象 | 真实原因 |
|---|---|
| 「改变浏览器的长宽比之后，界面会变成很小的一块」 | `#app{height:100%}` 与 `App.vue` 根 div 之间隔着 naive-ui 的 `.n-config-provider`，**它没有任何 height 规则** → `h-full` 的百分比高度退化成 auto → 整条高度链断裂 → SVG 按 viewBox 固有比例 2405:1620 反推高度，图区一变窄整个界面就跟着缩 |
| 「顶栏近黑深蓝底上『单步』等按钮文字看不清」 | **不是底色太深。** naive-ui 默认型按钮是「透明底 + 深灰字 `#333639` + 浅灰描边」，为浅色背景设计，压在近黑底上对比度 **1.46:1**；而把底色改浅到 `#334155` 反而降到 **0.85:1**（更差）——只改底色是无效的，必须同时翻按钮主题 |
| 「传送什么类型的数据用什么颜色，这一点请你规范标准，在图例里标注」 | 标准**部分存在**（`data`/`control`/`clock` 三类），但只写在两处散文注释里，从未告诉学生；线色被抄在 **3 个文件**；`style.css` 里还留着一套**完全冲突的旧配色**；`trap` 是 0 条线的死配置 |

### 做了什么

**1. 响应式**

- `n-config-provider` 加 `abstract`。已核实 `ConfigProvider.mjs:210` 在 `abstract: true` 时只返回默认插槽、**不渲染任何包裹 div**。这是本项**唯一的防回归手段**（没有断言能覆盖它），所以在那一行留了注释写明「删掉它高度链会断」。
- `style.css` 加 `--rv-header-h: 3.5rem` / `--rv-footer-h: 2rem`，`html,body` 加 `height:100%; overflow:hidden`，`#app` 加 `height:100dvh`（移动端地址栏收起/展开时 `100%` 会和可视高度对不上；不支持的浏览器退回上一行）。
- **修 naive-ui tabs 的假滚动。** `.n-tabs` 本身是 `display:flex; flex-direction:column`，但 `.n-tabs-pane-wrapper` 只有 `position:relative; overflow:hidden`，既不是 flex 项也不 grow，高度永远等于内容高——pane 上的 `flex-1 min-h-0 overflow-y-auto` 全部失效。修法放进 `style.css` 全局，同时删掉 `App.vue` 与 `AppSidebar.vue` 里两份重复的 `:deep` 块。
- 左右栏可折叠，状态放新建的 `stores/layout.ts`：折叠按钮分属 `AppSidebar` 与 `App.vue`，是兄弟关系，够不到对方的 `ref`。展开态宽度用 `clamp`（左 `clamp(240px,26vw,380px)`、右 `clamp(240px,22vw,340px)`），窄屏自动收窄，不必等用户去点折叠。
- **折叠态不用 `display:none` / `v-show`，用「窄宽度 `w-10` + `overflow-hidden`」。** CodeMirror 在 `display:none` 容器里测量得 0，而 `createEditor` 只在 `onMounted` 跑一次，重新展开会白屏。让它继续参与布局、只是被裁掉，就没这个问题。
- `GlossaryOverlay` 的硬编码 `top-14 bottom-8` 改成 `top-[var(--rv-header-h)] bottom-[var(--rv-footer-h)]`，并加 `max-w-[92vw]`（宽度上限 760px，1024 屏会把中央列全盖住）。
- **`DatapathView` 刻意不加 `ResizeObserver`。** `preserveAspectRatio="xMidYMid meet"` + 每次事件现取 `getBoundingClientRect()`，意味着容器任何尺寸变化后 pan / zoom / 点击命中**本来就已自动正确**；加它去「自动 fit」反而会在用户缩放平移后一 resize 就把视角弹回整图。所以以上全部只改祖先盒模型，`view` / `mapping` / `toSvg` / `setPointerCapture` 一行没动。

**2. 顶栏**

- 底色 `#0f172a` → `slate-700`（`#334155`）+ 白字；分隔线从 `slate-700` 改 `slate-600`（原来的值正好等于新底色，留着等于没有）。页脚保持 `slate-900`，形成「顶栏=操作区更亮、底栏=状态区更沉」的层次。
- **顶栏 5 个按钮改原生 `<button>` + Tailwind。** naive 默认型按钮要覆盖 `color/colorHover/colorPressed/colorFocus/colorDisabled + textColor×5 + border×5` 十几个键，漏一个就在 hover 时露出浅底深字；而顶栏是唯一的深色区，需要的就是「白字 + 透明底 + 浅描边 + 5 种状态」。代价是失去 naive 的 ripple / focus 动画，自己写 `focus-visible` ring 和 `disabled:` 态。`n-tooltip` 包裹保留，文案不动。
- `App.vue` 加全项目**第一处** `themeOverrides`，把 naive 主色从默认的**绿色 `#18a058`** 改成页面主色蓝 `#2563eb`——它同时修掉 `CodeEditor` 那个绿色「编译 & 加载」按钮和顶栏 `n-slider` 的绿色滑轨。速度滑块用局部嵌套 `provider` 单独给深底上的浅色。
- 窄屏**分级隐藏，不做 `flex-wrap`**：顶栏是固定高，换行必然竖向溢出，而 `body{overflow:hidden}` 会**静默裁掉第二行**——不报错、不出滚动条。

**3. 连线配色标准**

- 新建 `frontend/src/data/datapathPalette.ts` 作**唯一真相源**：`WIRE_KINDS` / `wireSpec` / `wireKindLabel` / `NET_KIND` / `netKind` / `HILITE`。图例由它 `v-for` 渲染，所以「图例说什么颜色」与「图上画什么颜色」不可能再各自漂移。
- 判定口径先立规则再落条目：**`address` = 一切「位置编号」**（PC 值、下一条 PC、跳转目标、访存地址、**寄存器号**）；**`control` = 一切「决定 / 开关」**（判据、选择端、写使能、ALU 操作码）；**`imm` = 立即数与图上字面常量**；**`trap` = 异常 / 中断**。这条规则顺带修掉一处旧瑕疵：`ra1`/`ra2`/`waddr` 传的是寄存器编号（位置），原来却被归为 `control`。
- 改 24 条 wire 的 `kind`，最终 **60 条线的分布：`address` 18 / `control` 18 / `data` 12 / `clock` 6 / `imm` 5 / `trap` 1**。几处刻意的教学判断：`w_imem_dec`（指令码）留 `data`（32 位数值，不是开关量）；`alu.f_out` 的三条去向**故意不同色**——当存储器地址 / 当跳转目标 → `address`，当写回值 → `data`，同一根 ALU 输出三种用途一图看清。
- **`trap` 不再是死配置。** 全图 134 个端口里 26 个没有 wire 对象、靠 `net` 名字连接（trap 子系统正是这样表达的，实测真悬空 0 个）。给网络标签补 `NET_KIND` 映射后，红色从「1 条线」变成「1 条线 + 11 个网络标签常亮」。**新增 wire 0 条**，不碰 `check_layout.py` 的任何几何断言。
- **激活态不丢类别信息。** `.dp-lit` 原先**同时**覆盖 `stroke-width:4.5` 和 `stroke-dasharray:none`——任何靠线型编码的类别，在被激活的瞬间（恰恰是学生最需要辨识的时候）退化成同一根实线。修法是给每条 wire path 多挂一个 `wk-<kind>` class，再加 `.dp-svg .wk-control.dp-lit { stroke-dasharray: 8 5 }`（权重 (0,3,0) 压过 `.dp-svg .dp-lit` 的 (0,2,0)）。这条**必须写在 `.dp-lit.dp-fresh` 之前**，同权重下后写的赢，顺序反了会把「本波新到」的流动动画压成静态虚线——效果看着「也能用」，只是逐波播放时看不出信号在流动。
- 图例原地重建为两块（**线的类别** 6 项由调色板驱动 / **高亮状态** 4 项），可折叠（`innerWidth < 1280` 默认折叠），点线类别色块打开词典的「线型」词条。容器保持 `pointer-events:none`，**只给可点的色块和折叠按钮**加 `auto`，否则会挡住图区左下角的平移与连线 hover。
- 新建 `tools/_palette_check.mjs` 并注册进 `check_all.py`（第 9 步）。

**4. 配色的三轮返工（用户反馈「有些线的颜色不一样，但是比较相像」之后）**

旧版追求「所有线都比所有模块描边色暗」，6 个色全被压进 Tailwind 700 级那一条窄明度带里。后果是**蓝 `#1d4ed8` 和紫 `#6d28d9` 在 CIEDE2000 下只差 12.32，在红绿色盲模拟下只差 0.66**——图上就是同一个颜色，而 60 根线里有 30 根是这两类。用户看到的「相像」就是这个。而「线比框暗」这条规则本来也没守住：`data` 蓝 vs 圆形部件框实测只差 5.9。所以这一版放弃明度迁就，改为**同时用色相和明度拉开**：

| | 正常视觉最小 ΔE | 色盲模拟最小 ΔE | 白底对比度最低 |
|---|---|---|---|
| 旧版 | 12.32 | 0.66 | 4.76:1 |
| 重做第一版 | 28.28 | 7.89 | — |
| 重做第二版 | 27.94 | 11.62 | — |
| **最终版（用户点名的六色系）** | **28.03** | **10.67** | **3.25:1** |

最后这六个色是**用户指定的语义色系**（金黄 / 翠绿 / 紫 / 赤红 / 青 / 深蓝，赤红必须给异常 / 中断），所以不是「自由搜索出的最优六色」，而是**在这六个色系的窗口内搜出的最优组合**。代价写在文件顶部注释里：

- **金黄只能做成暗金，这是物理限制不是偏好。** 亮金黄在白底上过不了可见性下限：`#FACC15` 只有 1.53:1、`#EAB308` 1.92:1、`#CA8A04` 2.94:1，2.5px 细线会糊掉。能用的最早一档是 `#B8860B`（DarkGoldenrod）3.25:1。`MIN_CONTRAST` 因此定在 **3.2 而不是 3.5**——这一条专门为金黄让的，其余五色实测都在 3.68:1 以上。
- **翠绿和青天生挨得近，是本方案的瓶颈。** 六个色系在色环上不是均匀分布：翠绿(163°) / 青(192°) / 深蓝(224°) 三个挤在 60 度里，而金黄(43°) 到翠绿中间空着 120 度。色盲模拟下的瓶颈对因此是「地址 / PC 青 vs 时钟 / 复位 紫」(deutan 10.67) 和「地址 / PC 青 vs 控制信号 翠绿」(tritan 13.57)。试过把青压深来躲当时的 MUX 青框，代价是分离度崩盘（`#0E7490` 掉到 4.33），所以青停在 `#0891B2`。

**5. 顺手修掉的一处线框撞色（用户问「MUX 的边框」时发现）**

地址 / PC 的青 `#0891B2` 与 MUX 模块描边色 `#0284c7` 只差 **ΔE 10.94**（两者色相只差 7 度）——青色地址线插进青色边框的 MUX 时，线框分不干净，是全图最差的一对。而 MUX 的青色本来也没传达什么：它想说的「这是 MUX」，胶囊形状本身就说完了，而 10 个 MUX 是带框模块里最大的一片（24 个里的 10 个）。

改成把它归进和其它矩形一样的灰档 `#475569`（**填充色不动**，仍是 `#f1f5f9`，和纯白矩形的区别留着）。改后线 vs 框的最差升到 **11.94**，而且那一对是 trap 线 `#be123c` vs trap 框 `#dc2626`——是**故意**留的一档明度差，用来区分「这是线还是框」。这套部件描边色（橙=运算部件 / 靛=圆圈 / 红=TRAP 分组 / 灰=其余含 MUX）图例里从来不提，属于辅助分组，所以每一档都得自己站得住。

### 复验

| 检查 | 结果 |
|---|---|
| `python tools/check_all.py` | **18 步全部通过**，无跳过 |
| `node tools/_palette_check.mjs` | 退出 0；8 组断言全过 |
| JS 版 CIEDE2000 ↔ Python 参考实现 | 最差对 **10.67 两边完全一致**（`tools/_palette_check.mjs` 与 `tools/out/ui/color_search.py` 各算一遍） |
| **变异测试**（证明断言是活的） | 深蓝→`#3b82f6` 被 deutan 1.03 抓住；紫→`#7e22ce` 被 10.24 抓住；MUX 框改回 `#0284c7` 被第 8 组 10.94 抓住。每次改完 `cmp` 确认文件按字节还原 |
| `npm run build` | 通过，`vue-tsc` 零错 |
| **渲染后的真实页面**（`--dump-dom` + 注入探针读计算样式，1920×1080） | 见下 |

渲染验证的具体数字：

| 项 | 实测 |
|---|---|
| 高度链 | `innerHeight` / `body.scrollHeight` / `#app` 三者**都是 985**，页面无滚动；`#app` 第一个子元素**不是** `.n-config-provider` |
| 顶栏 | 底色 `rgb(51,65,85)`＝`#334155`，字色 `rgb(248,250,252)`，高 56px，1920 宽下 `clientWidth == scrollWidth`（无溢出、没有被右边缘吞掉的元素） |
| 顶栏按钮 | 已是原生 `<button>`；「运行」蓝底白字 `#2563eb`/白，「单步」透明底 + `#f8fafc` 字 + `#64748b` 描边 |
| tabs 假滚动 | `.n-tabs-pane-wrapper` 计算值 `display:flex; flex:1 1 auto; min-height:0`，高 863 = 父容器 897 − 标签栏，pane 高度跟随 |
| 连线 | **132 条 `path`**，每类**只有一种色值**：data 21 条 `#1e3a8a`、address 36 条 `#0891b2`、imm 9 条 `#b8860b`、control 49 条 `#047857`、clock 13 条 `#a855f7`、trap 4 条 `#be123c` |
| 部件框 | 28 个模块：灰 `#475569` **16 个**（6 个普通矩形 + 10 个 MUX）、橙 `#ea580c` 3 个、靛 `#4f46e5` 1 个、红 `#dc2626` 4 个、无框纯文字 4 个 |
| 图例 | 在场、在视口内、容器 `pointer-events:none`；6 个色块色值与调色板**逐个吻合**，其中**恰好 1 个虚线**（control） |
| 青色残留 | `0284c7` 在整个渲染页面里出现 **0 次** |
| 构建产物 | `frontend/dist` 里 `0284c7` 出现 0 次 |
| 窄屏五档（1920 / 1280 / 1024 / 768 / 640） | 每档顶栏 `scrollWidth == clientWidth`、**没有任何元素越过右边缘**、`body.scrollHeight == innerHeight`（无滚动）、图例不越界；`innerWidth < 1280` 时图例如期自动折叠（1235 / 979 / 723 / 595 四档均折叠） |

### 遗留

- **纯灰度打印下 6 类分不开。** 6 个颜色塞不进一维亮度空间，这是数学限制，不是调参问题。兜底的三条通道是：`control` 是唯一的虚线、图例常驻、悬停 tooltip 显示中文类别名。若「灰度可分」要变成硬指标，唯一办法是给每类再叠不同的 dash pattern，代价是密集图上很噪，且与「本波新到」的流动虚线语义打架——**不推荐**。
- **色盲下仍有一处线框撞色，本轮未修。** 立即数的金黄 `#b8860b` 与加法器 / ALU 的橙 `#ea580c`，在二代色盲（deutan）模拟下 ΔE 只有 **1.03**——等于同一个颜色（正常视觉下两者差 24.12，完全没问题）。也就是说色盲学生看 `w_immadd_m4`/`w_immadd_m3` 插进立即数加法器那一段，线框会糊在一起。要修就得动「金黄」或「橙」其中之一，而这两个都是用户点名的语义色，所以**先记在这里，没有动**。`_palette_check.mjs` 第 8 组把它算出来打印、但**不拦**（打印时标了「已知旧问题」），免得它被静默无视、也免得被误读成已通过。
- 三栏折叠的默认值只按 `window.innerWidth < 1100` 在首屏算一次，**不跟随窗口变化**（项目里至今没有 `matchMedia`）。
- 窄屏只在**五种窗口宽度**下实测过（1920 / 1280 / 1024 / 768 / 640 各跑一次探针：顶栏 `scrollWidth == clientWidth`、无元素越过右边缘、页面无滚动、图例不越界，且 `innerWidth < 1280` 时图例如期自动折叠）。**没有做真机 / 触屏验证**，也没有覆盖浏览器缩放与系统字号放大。

---

## 2026-10-01（第八轮）内容审计：修掉 15 条会误导学生的词条，补上 26 个搜不到的词

### 为什么

第七轮把词条写满之后，用户要求「检查然后修改之后上传」。这一版的 T0 是**正确性**，而 158 条正文
靠通读是查不干净的——**「看着对」和「对」是两回事**。于是派了两个互不重叠的独立审计：

| 审计 | 范围 | 对照物 |
|---|---|---|
| 甲 | `instruction` / `encoding` / `isa` 三类共 75 条 | `rv_control.hpp`、`rv_alu.hpp`、`rv_immgen.hpp`、`rv_disasm.cpp`、`rv_core.cpp`、`asm.py` |
| 乙 | `scope: 'project'` 或正文含自指措辞（本模拟器/本模型机/本项目/本仓库/本图/图上）共 56 条 | `backend/cpp/src/`、`backend/python/`、`frontend/src/` |

两轮的判定**没有直接采信**：每一条都自己回源码复核过再改。

同时，把「学生搜不到」也当成可量化的指标来查：拿一份 118 词的组成原理常见词表
（时钟时序、数据编码、指令编码、CPU 部件、流水线性能、异常中断、调用约定、存储层次）
逐词丢进检索函数，看有多少够不到收录阈值。

### 做了什么

**1. 修掉 9 处判定为「错」的表述。** 按危险程度排：

- **`funct7`「移位类立即数指令里这 7 位并没当功能码用」——与译码器正面相反。**
  `rv_control.hpp:97-98` 里 `funct3==101` 正是按 `funct7==0x20` 分 SRA / SRL，`asm.py:257`
  给 `srai` 编的 `f7` 就是 `0x20`。这一条还与同一文件的 `srli` / `srai` 两条自相矛盾。
  位 30 判 sra/srl、srli/srai 是必考点，照旧文答会**直接答反**。
- **`immediate`「唯一的例外是 CSR 指令的 5 位立即数」——漏了移位量。** `asm.py:254-259` 与
  `rv_alu.hpp:25,29-30`（`b & 31`）都表明 `shamt` 是零扩展的 5 位字段；U 型也不符号扩展
  （`rv_immgen.hpp` 只做 `& 0xFFFFF000`）。「12 位立即数一律符号扩展」是编码题最常埋的坑。
- **`funct3` 拿 add/sub 当例子——方向正好反了。** `rv_control.hpp:114` 里 ADD 与 SUB 同为
  `funct3=000`，只差 `funct7`。改成 `addi / xori / ori / andi` 共用操作码 `0010011`。
- **`extension`「不含任何扩展」——假的。** `rv_disasm.cpp:229-272` 实现了六条 CSR 指令，属 Zicsr。
- **`reset-signal`「它也不清空内存」——假的。** `rv_core.cpp:164` 的 `reset()` 调了 `m_mem.reset()`，
  寄存器堆、CSR、整块内存一起清零。
- **`mcause` 只列三个值——漏了 ebreak 的 `0x00000003`。** `rv_core.cpp` 有四处 `raise_trap`
  （270 / 276 / 390 / 394），且该词条与自己的 `ebreak` 条冲突。
- **`mip`「界面上这一栏恒为 0」——不成立。** `csr_write` 只把 `0xC00/0xC01/0xC02` 当只读，
  程序写 `0x344` 仍会生效。
- **`base-address`「内存面板里改的就是这个值」——指错了。** 那个框是**内存查看的起始地址**
  （`MemoryView.vue:49,62`），改它并不改变加载基址。
- **`constant`「标 ADD 部件旁边的 0 和 4」——0 不在那儿。** `const0` 在 `y=536`，紧挨的是
  指令存储器（`y=456`），它的两条出线接的正是 imem 的数据与写使能。

**2. 修掉 6 处判定为「表述不准确」的地方。**

- `halt` 说「执行到内存末尾就停机」：核心没有末尾检查，实情是取到全 0 的字被判非法指令、
  触发陷阱后 `mtvec=0` 无处可跳才停机。结论对，机制写错了。
- `instruction`「RISC-V 指令固定为 32 位」缺 RV32I 限定（C 扩展是 16 位）。
- `rs1` 暗示 JAL 有 `rs1` 字段——J 型根本没有，位 19:15 本来就是立即数的一部分。
- `assembler` 把标准工具链的「汇编器→链接器」当成本产品的行为；`compile_server.py:112`
  实际优先用 gcc，只有没装交叉工具链时才回退到内置汇编器。
- `write-back` 说「LUI 与 AUIPC 来自立即数」；AUIPC 的写回值其实是 `pc+立即数`，
  由 ALU 算出（`HL_CONTRACT.md` §4.2 的 `muxa`）。
- `xori` 提 `not` 伪指令却没说本模拟器没实现（9 条伪指令里没有 `not`），学生照着写会报错。

**3. 修掉本轮新写词条自身的 5 处毛病**（写完再复读一遍抓出来的）：

- `控制器` 的出处里写了「`LABEL_GLOSSARY` 把「译码器」映到本条」——**假的**，实际映到 `decoder`。
- `锁存器` 正文写「本模拟器的寄存器因此由触发器构成」——**误导**。本模拟器是 C++ 行为模型，
  `regs` 就是一个数组，代码里没有触发器；这句会让学生以为模拟器是门级搭的。
- 三处 `sources` 拿 `glossary.ts` 里**别的词条**当出处（循环引用），换成 `rv_memory.hpp` 等真实文件。

**4. 补上 26 个「学生按常见组成原理词汇去搜却搜不到」的词。** 118 词的词表原先落空 28 个：

- **正文其实已经讲了、只是没挂别名（8 组，只改 aliases、不动正文）**：`系统调用`→ECALL、`双字`→字、
  `建立时间`/`保持时间`/`亚稳态`→触发器、`调用约定`→ABI、`上升沿`/`下降沿`/`时钟沿`→时钟信号、
  `偏移量`→立即数、`递归`→子程序、`转发`/`前递`/`阻塞`/`停顿`→冒险。
  其中立即数、子程序、冒险三条顺带补了一句正文，让搜进去的人**真能读到那个词**，
  而不是落在一个通篇不提它的条目上。
- **真缺词条（13 条）**：汇编语言、寻址方式、控制器、总线、三态门、上下文、主存（挂 `内存`/`RAM`）、
  锁存器、原码与反码、存储层次、缓存（挂 `命中率`）、虚拟内存、加速比。
  后 5 条**本模拟器并未实现**，正文按 T0 逐条写明「本模拟器没有缓存 / 没有 MMU / 只有寄存器与主存两层」，
  免得学生以为这个模型机有这些部件。

词条 **158 → 171**，覆盖词表 118 词里的 **116** 个。

**5. 同步文档。** `README.md`、`使用说明.md`、`docs/DEVELOPMENT.md` 里的词条数改为 171。

### 复验

| 项 | 结果 |
|---|---|
| `python tools/check_all.py` | **17 步全通过**，无跳过 |
| `node tools/_glossary_check.mjs` | 0 失败；171 条 / 11 分类；图上 28 个部件 28/28 |
| 组成原理常见词表 118 词 | 落空 **28 → 2**（剩余 2 个是刻意不收的界面操作词） |
| 新增与修改词条的可见字数 | 全部 ≤150（`constant` 恰好 150） |
| 每处改动的依据 | 改前逐一回源码复核，未直接采信审计结论 |
| `cd frontend && npm run build` | 通过，新词条已进 `dist` |

### 遗留

- 词表里没覆盖的 2 个词是「单步」「示例程序」。它们是**界面操作**，按既定的收录边界（只收专业名词）
  不收——这是刻意留白，不是漏。
- 搜 `ABI` 时首位是「寄存器 ABI 名」而非「应用程序二进制接口」：`term` 会按空格拆词，
  「寄存器 **ABI** 名」拆出的 `ABI` 按 term 精确拿 1000 分，压过 `abi` 条的 id 精确 980 分。
  两者都正确、不误导，属排序偏好，本轮不动（改它要动打分规则，风险大于收益）。
- `trapunit` 标题里的「判据」仍搜不到（第七轮已记录），理由同前：泛义中文词，没有对应的
  专业名词，硬塞别名会误导。
- 本轮只改了词条数据与文档，**UI 组件未动**；但新增 13 条词条后的界面表现仍建议人工点一遍。

---

## 2026-10-01（第七轮）百科全书补齐：13 → 158 条；修两处会误导学生的检索并列

### 为什么

第六轮做的是框架 + 13 条样条。用户看过文字风格与交互效果后给了一条覆盖性指令：

> **「一切按照最真实的情况写，内容越丰富越好，不要让学生搜不到东西」**

这条推翻了早先「首批约 25 条就够」的范围设想。于是本轮把词条补满，并**把「学生搜得到」
当成一条能用机器检查的指标**来对待——不再是「写完了随手搜几个试试」。

### 做了什么

**1. 词条 13 → 158 条，11 个分类。** 覆盖面：46 条 RV32I 指令（含 6 条 CSR）+ `MRET`
+ 9 条伪指令；图上 28 个部件全部有词条；编码字段（`rd`/`rs1`/`rs2`/`funct3`/`funct7`/opcode）；
CSR 与异常中断全族（`mtvec`/`mepc`/`mcause`/`mstatus`/`mie`/`mip`、特权级、五类异常原因）；
通用组成原理概念（指令集与扩展、CPI、时钟频率、字节/半字/字、小端序、补码、溢出、
传播延迟、关键路径、触发器、冒险、微架构）；调用约定（ABI 名、调用者保存、被调用者保存、
栈指针、返回地址、帧指针、零号寄存器、子程序）；五个阶段的独立词条（取指/译码/执行/访存/写回）。

**2. 修掉两处「检索给出错误答案」的并列。** 两处都不是数据写错，是打分规则让错的赢：

- **加 `id` 精确档**（`term 1000 > id 980 > en 920 > alias 880`）。`fieldCandidates` 原先把
  词条 id 当 `en` 字段推入，于是 `alu-flags` 的 `en`（`ALU Flags · ZF / LT`）会拆出一个裸词
  `ALU`，和 `alu` 自己拆出的 `ALU` 同为 920 分；并列后按 `term` 长度升序决胜，`标志位`（3 字）
  压过 `算术逻辑单元`（6 字）——**学生敲 `ALU` 落到「标志位」**，而 ALU 是图上最醒目的部件之一。
  新规则说得清：查询正好等于某条词条的 slug 时，那条胜出。
- **反向包含要求命中串盖住查询的 1/4 以上**（`REVERSE_MIN_COVER = 4`）。原规则只要求候选串
  ≥2 字符，于是 `registor`（`register` 的错拼）里恰好含着 `or`，「OR 指令」按反向包含拿到
  300+60=360，**高过收录阈值 260**；系统据此判定「找到了」，把真正的答案挤出去——而 `register`
  本身走拼写近似只有 240 分，低于阈值被过滤。**学生看到的是 OR / XOR / ORI 指令，且不知道
  系统其实没把握。** 修后 `registor` 退回「未收录 —— 你是不是想找：寄存器、rd、rs1」。
  阈值取 1/4 而非更大，是为了不误伤「中文里夹短缩写」：`pc是啥` 里 `pc` 占一半、
  `我想用sw存` 里 `sw` 占三分之一，照常命中。

**3. 术语表自检注册进 `tools/check_all.py`（第 13 步）并默认 `--strict`。**
图上 28 个部件现已全部有词条，映射表不该再有悬空项，`--strict` 把「映射目标词条不存在」
从警告升级为失败。

**4. 新增「界面字符串可检索率」报表。** 把图上真正渲染出来的字符串（线名、部件标题、
部件副标题）按分隔符**拆成词**后逐条丢进检索函数，列出够不到阈值的。学生看到
`mtvec/mepc/mcause/...` 会敲其中一个，不会粘整串——原来不拆也全绿，是因为整串里含着
`mtvec`，靠**低覆盖的反向包含**凑巧够到阈值，正是本轮刚收紧的那种假绿。当前
**59 个字符串、58 个搜得到**，唯一落空是部件 `trapunit` 标题「trap 判据」里的 `判据`。

**5. 补齐文档。** `使用说明.md` 与 `README.md` 原先**一个字都没提**这个功能——学生拿到交付包
根本不知道顶部有这本词典。本轮补上了「遇到不认识的词：百科全书」一节、特性条目、目录结构；
并修正 `使用说明.md` 里两处过期内容（`check_all.py` 写成「16 步」，实际 17 步；「最后一步会跳过」
但跳过的那步现在排第 12）与 `五 → 七 → 六` 的章节乱序。

### 复验

| 项 | 结果 |
|---|---|
| `python tools/check_all.py` | **17 步全通过**（`--no-regen` 时 13 步） |
| `node tools/_glossary_check.mjs --strict` | 0 失败；98 条警告 = 81 同级互链 + 17「别名与自身 id 重复」，均为刻意保留 |
| 没标出处的词条 | 0 |
| 检索探针（寄存器 ABI 名 / 端口名 / 线名 / 部件标题 / 大小写等价 / 未收录降级） | 77 个全中 |
| 图上 28 个部件 → 词条 | 28/28 直达 |
| `cd frontend && npm run build` | 通过（`vue-tsc` 无类型错） |
| 交付包「用后不变」 | 解压 → 启动 → 真编译一次 → 关闭，连做两轮，均 0 新增 / 0 删除 / 0 变化 |

**同级互链警告 81 条为什么不算问题**：它表示两条词条难度同级、却互相引用，脚本没法判断
该不该链，交给人确认。逐条看过：都是像 `register ↔ register-file`、`alu ↔ mux` 这种
「严格说不上谁更基础」的正常关联。

**17 条「别名与自身 id 重复」**：形如 `fetch` 词条写了别名 `fetch`。无害但冗余，留着是因为
这些别名同时承担「英文变体」的角色（如 `wire type` 归一后等于 id `wire-type`），删掉会让
「学生敲英文名」这条路少一层保障。

### 遗留

- `trapunit` 部件标题里的 `判据` 搜不到。它是泛义中文词，没有对应的专业名词，硬塞一个
  别名反而会误导——按「不确定不要瞎编」留白，只在报表里报出来。
- 本机没有无头浏览器驱动（`node_modules` 里无 puppeteer / playwright），**浮层的交互改动
  只能人工点**。本轮只改了词条数据与检索逻辑，UI 组件未动，但新词条的界面表现仍建议人工过一遍。

---

## 2026-10-01（第六轮）百科全书：面向零基础新生的术语词典（框架 + 13 条样条）

> 词条已在本轮之后的**第七轮**补齐到 158 条，又在**第八轮**审计后增补与修订为 171 条。

### 为什么

功能定位来自一句很具体的话：新生看到一个信号进了名叫「寄存器」的方块，但不知道那是什么。
界面上到处是这类词（寄存器、ALU、时钟周期、ADDI、CSR……），而目标用户是**零基础新生**，
所以需要一本内置的字典——用到的一切专有名词都能查到，解释短、准、能互相跳转。

本轮**只做框架 + 一小批样条**，不追求词条齐：把数据模型、浮层、搜索、互链、图上点击、
自动校验全部建好，正文只写 13 条，覆盖每个分类和各条交互路径。看过文字风格与交互效果后，
再按同一标准批量补足。

**正确性是 T0，优先于其余一切。** 这条具体落成三件事：每条正文必须能追溯到 `sources`；
本项目自创的东西必须标 `scope: 'project'` 并在正文里点明；正确性与 150 字冲突时正确性优先。

### 做了什么

**1. 数据层**（`frontend/src/data/glossary.ts` + `glossaryQuery.ts`）
分类用 `as const` 数组而不是 `enum`——本文件要被 Node 直接 import（类型剥离），`enum` 不可擦除。
正文互链用 `[[id]]` / `[[id|显示文字]]` 语法。**刻意不做**「自动识别正文里的术语再加链接」：
中文没有词边界，「寄存器」会命中「寄存器堆」、「指令」会命中「伪指令」，自动加链必然链错。

**2. 检索**（`searchGlossary`，零依赖自写）
归一化（大小写 / 全角半角 / 分隔符）+ 别名表 + 整串前缀包含 + 拉丁串编辑距离。
**中文刻意不用编辑距离**：「寄存器」与「寄存器堆」距离=1，会把语义上的包含关系误判成拼写错误；
更坏的是 `mtvec`/`mepc`/`mcause` 这类只差几个字母、语义完全不同的 CSR 会互相误配。
拼写近似只在「纯 ASCII 查询 + 长度 ≥4 + 一条精确/前缀/包含都没命中」时才启用。

**3. 界面**（`stores/glossary.ts` + `components/glossary/` 5 个组件）
自建浮层，**不用 `NModal`/`NDrawer`**：必须非模态（学生要能边读边点「单步」，
`NModal` 的遮罩会拦指针事件），必须能拖宽且持久化，且项目零先例（唯一用过的
naive-ui 组件是 `NTooltip`）。`fixed right-0 top-14 bottom-8` 正好卡在页头(h-14)与页脚(h-8)之间。
**不做**「点外部关闭」——学生要在浮层外面点图上的部件，那个动作会跟它打架。

**4. 图上点击**（改 `DatapathView.vue` 一个文件）
坑：`onDown` 里的 `setPointerCapture` 会让浏览器把派生出的 `click` **重定向到捕获元素 `<svg>`**，
挂在部件 `<g>` 上的 `@click` 静默失效。也不能用 `event.target`——连线和线名画在部件**之上**，
点框内很可能落在压着它的线上。所以改成：`onDown` 记手势、`onMove` 超 4px 标为拖动、
`onUp` 判定「没移动才算点击」后做几何命中，多个命中时取面积最小者。
既有 pan 逻辑一行未改。`check_layout.py` 已断言部件矩形互不重叠，所以命中不存在歧义。

**5. 自动校验**（`tools/_glossary_check.mjs`，注册为 `check_all.py` 第 8 步）
机器查不了「这条解释对不对」，但格式与引用这一层可以做到 100% 可靠，人工复核就只剩内容要盯：
字数、互链目标存在且更基础、别名撞车、图上映射覆盖率、正文雷同。
「150 字」的口径**只有一份实现**（`glossaryQuery.visibleLength`），检查脚本 import 同一个函数。

### 本轮发现并处理的三个具体风险

| 风险 | 事实 | 处理 |
|---|---|---|
| **图上画两块存储、实现只有一块** | `datapathLayout.json` 的 `imem.tip` 自己写着「示意图画成独立的一块（哈佛），后端其实只有一块 `m_mem` 同时供取指与访存（冯·诺依曼）」。已在 `rv_core.hpp:116`（只有 `rv_memory m_mem`）、`rv_core.cpp:245`（取指）、`rv_core.cpp:344-362`（全部访存）逐条核实 | 「指令存储器」词条正文里**明写**这件事，不留给学生自己去撞 |
| **「波次」是本项目自创的记号** | 单周期 CPU 里一条指令就是一个时钟周期，不能再分；「波」是把组合逻辑传播延迟切片的可视化手段。学生若把它当成标准术语，就是根本性的概念错误 | `scope: 'project'` + 界面「本项目自定义」徽章 + 正文第一句点明「不是标准术语，也不占时间」；`clock-cycle` 词条正面强调单周期 |
| **`MUX` 是 12 个不是 11 个** | `pcmux1-6` + `muxa`/`muxb`/`muxa0` + `wbmux`/`wbmux0`/`wbmux1` | 映射按 module **id** 精确写满 28 个，另加一层按框内标题的兜底 |

### 顺手修的一个既有缺陷

`tools/check_all.py` 在中文 Windows 上会崩：Python 3.14 的 stdout 默认 GBK，
而第 7 步的描述里有 `↔`(U+2194)，`print` 直接抛 `UnicodeEncodeError`。
表现是「跑不完」，看着像断言失败，其实只是打印失败（子进程由 `run()` 设了
`PYTHONIOENCODING`，父进程自己没设）。已改成显式 `reconfigure(encoding='utf-8', errors='replace')`。

### 复验

```bash
python tools/check_all.py          # 17 步全通过（末步为术语表自检）
node tools/_glossary_check.mjs     # 也可单跑：看覆盖率报表与待补清单
cd frontend && npm run build       # vue-tsc 类型检查 + 出 dist
```

覆盖率：图上 28 个部件，已收录 16 个、待补 12 个（`constant`/`adder` 等词条尚未写，
点了走「未收录 → 相近词条」的降级视图，这恰好当场验证了那条降级路径）。

**尚未验证**：所有浏览器内的交互（浮层开关 / 搜索大小写 / 互链跳转与返回栈 / 图上点击 /
拖动调宽持久化 / 与平移不打架）。本机无无头浏览器驱动，只能静态验证，**必须人工点一遍**。

本轮**不重打桌面交付包**（内容仍是样条），只重建 `frontend/dist` 让 8081 用上新代码。

---

## 2026-10-01（第五轮）零副作用交付：前端静态化 + 输出移出源码树

### 为什么

起因是一个交付标准：**交付的东西用完之后不应该发生变化——打开、关掉，如此往复**。

实测（从干净 zip 解压副本、启动中间层、连用三次）不满足：

| 副作用 | 触发时机 | 规模 |
|---|---|---|
| 首次启动 `npm install` | `启动-Windows.bat` 第 2 步 | 22038 文件 / 173.87 MB |
| 写 `__pycache__` | 每次启动中间层（首次写入，之后收敛） | 6 文件 |
| 写 `backend/compile_output/prog.bin` | **每次点「编译 & 加载」都覆盖写** | 1 文件 |

前两条是一次性的，第三条每次编译都发生，所以包**永远不会**回到干净状态。

### 做了什么

**1. 前端改预构建 + 由中间层静态托管（8081）**

`compile_server.build_app()` 挂载 `frontend/dist`。前端请求编译用的是相对路径
`/api/compile`（`simulator.ts:15`），所以静态文件必须与 API **同源**——挂在 8081 即可；
WebSocket 那行取 `location.hostname` + 固定 8080，页面挪到 8081 后自动适配，**前端源码一行没改**。

三个 aiohttp 3.14 的行为必须绕开（均已读源码确认）：

| 行为 | 后果 | 对策 |
|---|---|---|
| `StaticResource.__init__` 对不存在的目录抛 `ValueError` | 没构建过 dist 时连编译 API 都起不来 | 先 `is_dir()` 判断再注册 |
| 静态处理器**不会**自动服务 `index.html`（`show_index=False` 时对目录请求 raise `HTTPForbidden`）| `GET /` 变 **403** | 显式注册 `GET /` 返回 index.html |
| `GET /` 与 `add_static("/")` 同在路由索引 `/` 键下 | 顺序错则首页 403 | `add_get("/")` 必须**先于** `add_static` 注册 |

而 `add_static("/")` **不会**吞掉 `/api/compile`：`UrlDispatcher.resolve` 按路径从具体到模糊
逐级回退，`/api/compile` 在第一层就命中 PlainResource，根本轮不到 `/` 那一层。

**2. 启动器：单进程单窗口，python 加 `-B`**

两个启动器删掉 npm install 整段与前端服务进程，只在缺模拟器时编译，然后
`python -B server.py` 前台运行，提示打开 `http://localhost:8081`。
`-B` 阻止写 `__pycache__`——写在启动器里才覆盖得住「用户把包放在任意路径、用任意 Python 启动」。

`server.py` 顶部另加 `sys.dont_write_bytecode = True` 兜底：`test_server.py` 会自己
spawn `server.py`，不经过启动器，只靠 `-B` 挡不住（实测那行生效：`ws_handler.pyc` 等的
mtime 在跑完测试后仍是 9/22）。

**3. 编译输出移到系统临时目录**

`config.py`：`COMPILE_OUTPUT_DIR` 由 `backend/compile_output` 改为
`Path(tempfile.gettempdir()) / "rv32i-compile"`，并删掉模块顶层那行
`COMPILE_OUTPUT_DIR.mkdir(...)`——它让「import config」本身就产生文件系统副作用。
创建改由 `compile_source` 内的 `out_dir.mkdir(parents=True, exist_ok=True)` 按需完成。
WebSocket 那条路径本来就传 `session_dir`（`tempfile.mkdtemp`），不受影响；
回传的 `elf_path` 是绝对路径，前端 `load_elf` 照常工作。

### 保留开发轨

前端源码**一个字没改**，Vite 开发模式原样保留：`cd frontend && npm run dev` → 5173，
`/api` 由 Vite 代理到 8081。改了 `frontend/src` 后需 `npm run build` 才会反映到 8081。
`start.sh` 未动（它是仓库自带的开发脚本，用 `-std=c++20`，且不进交付包）。

### 怎么复验

```bash
cd backend/test
python -B test_sim.py      # 126 通过
python -B test_asm.py      # 55 通过
python -B test_server.py   # 11 通过
python -B difftest/run.py  # 55/55
cd ../.. && python -B tools/check_all.py   # 16 步（源码树里有 node_modules，全过）
```

静态托管端到端（单起 `python -B server.py` 之后）：

| 请求 | 期望 |
|---|---|
| `GET /` | **200**，内容即 `dist/index.html`（若见 403，说明根 handler 没生效或注册顺序反了）|
| `GET /assets/index-*.js` | 200，字节数与磁盘文件一致 |
| `POST /api/compile` | 200 JSON（证明静态没吞掉 API）|
| `GET /不存在的路径` | **404**（单页无路由，刻意不做 fallback）|

「用后不变」的量化验证：把包解压到干净临时目录 → 快照文件集合 → 启动 → **编译一次** →
关掉 → 再快照，要求**零新增、零变化**；同时确认 `%TEMP%\rv32i-compile\` 下确实产出了文件
（证明编译真的跑过，而不是没走到那一步）。

### 实测结果（2026-10-01）

打包后解压到干净临时目录，**用启动器本身**（执行 `启动-Windows.bat`，不是直接跑
`python server.py`）在**同一份副本**上连开三次，每次开关都真的走完「编译 → 加载 → 运行到停机」：

| 次数 | 新增 | 消失 | 内容变化 |
|---|---|---|---|
| 第 1 次 | 0 | 0 | 0 |
| 第 2 次 | 0 | 0 | 0 |
| 第 3 次 | 0 | 0 | 0 |

起止均为 117 个文件；`__pycache__`、`backend/compile_output/`、`frontend/node_modules`
三者始终不存在。同一次实测里的功能检查：

| 检查 | 实测值 |
|---|---|
| `GET /` | 200，476 字节 |
| `GET /assets/index-XmE8VcNZ.js` | 200，941012 字节 |
| `GET /assets/index-BhV4gD2J.css` | 200，17551 字节 |
| `GET /api/compile`（POST-only） | 404 —— 证明静态托管没吞掉 API |
| `POST /api/compile` | `success=true` |
| WebSocket `hello` | → `ready` |
| `trap_roundtrip` | 跑到 halted，exit=2，**a0=2 / a1=99**，trap 命中 2 周期 |
| `timer_intr` | 跑到 halted，exit=0，trap 命中 9 周期 |
| `cycle_state` 字段 | `instruction_fields` / `control_signals` / `regfile` / `csr` / `trap` 齐全 |

编译产物落在 `%TEMP%\rv32i-compile\prog.bin`，证明编译确实发生（而非没走到那一步）。

> **★ 本版尚未覆盖的一点：Linux 首次运行会变。**
> 包里只有 `rv32i_sim.exe`（Windows 二进制）。`启动-Linux.sh` 找不到
> `backend/cpp/build/rv32i_sim`，会走 g++ 分支编译，**新增这一个文件**；
> 第二次起才稳定。此结论来自读脚本，**未在 Linux 上实跑验证**。

打包数据：目录 `RV32I-SingleCycle-WebSim-2026-10-01` + 同名 zip
（**703,753 字节 / 117 个条目**；上一版 2026-09-23 为 401,469 字节 / 114 文件）。
包内 117 个文件与工作树**逐字节一致**（sha256 全同，0 差异、0 缺失）。
本次打包**不能用 `git archive`**：`frontend/dist/` 与 `*.exe` 都在 `.gitignore` 里，
只能用「按排除清单从工作树复制 + 手工补 exe」的老配方。

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
本轮改动另有 4 个提交推送至 `origin/main`（`ecd21e9` → `404d4c6`）。

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
| `94956d9` | 2026-09-22 | 清理：删除死代码与过时资源 |
| `ecaf53d` | 2026-09-22 | 数据通路图 JSON 化 + 接入前端逐周期高亮 |
| `e4e2dc5` | 2026-09-03 | 交付文件入库：双系统启动器 + 使用说明 |
| `b07fa39` | 2026-09-03 | 开发文档 + 中断演示程序入库 |
| `b87e401` | 2026-09-03 | 前端：新增波形图面板（GTKWave 风格）|
| `1792819` | 2026-09-02 | 前端显示中断/异常 + 修复加载器小文件 bug |
| `1ce6cf3` | 2026-09-02 | 测试与文档：test_server.py Windows 修复 + README 更新 |
| `726ab74` | 2026-09-02 | 中间层：修复 Windows 下选错 Linux 旧模拟器的问题 |
| `d759260` | 2026-09-02 | 后端中断/异常 第⑥步：JSON 输出 trap 信息与 CSR 快照 |
| `4338f57` | 2026-09-02 | 后端中断/异常 第②⑤步：非法指令 trap + 计时器中断，并修复不跳转分支 bug |
| `d24546d` | 2026-09-02 | 后端中断/异常 第③步：加 mret + 修复 CSR 寄存器版 bug |
| `d5ae084` | 2026-09-02 | 后端中断/异常 第①步：ecall/ebreak 改为真 trap |
| `8a6f5a5` | 2026-09-01 | 添加教学用途 LICENSE |
| `b746668` | 2026-09-01 | 导入 RV32I 单周期项目基线 + Windows 兼容性修复 |
| `ce4956a` | 2026-08-02 | Initial commit |
