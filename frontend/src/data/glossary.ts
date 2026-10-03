// ============================================================================
// glossary.ts —— 百科全书（术语词典）的词条数据。唯一真相源。
//
// 分工：本文件只放「形状 + 数据」。搜索、正文解析、字数口径、图上映射查询都在
// glossaryQuery.ts；界面在 components/glossary/。本文件不 import 任何东西，
// 这样 tools/_glossary_check.mjs 能用 Node 类型剥离直接 import 它做离线断言。
//
// 语法约束（同 datapathScene.ts）：本文件被 Node 直接 import，只能用可擦除语法，
// 禁 enum / namespace / 构造器参数属性。分类用 as const 数组而不是 enum。
//
// ---------------------------------------------------------------- 写作规矩
//
// 【T0】正确性优先，不得对学生有任何误导。配套的三条硬规矩：
//   1. 每条正文必须能追溯到 sources 里列的出处。标准术语引 RISC-V 规范或教材；
//      与「本模拟器怎么做」有关的事实引本仓库文件，不能凭印象写。
//   2. 凡本模拟器自创、或只在教学模型里成立的设定，scope 一律标 'project'，
//      并在正文里用「本模拟器」「本图」这类限定语点明 —— 这类限定语一删，
//      就从准确变成误导，宁可超字数也不要删。
//   3. 正确性与 150 字冲突时，正确性优先。细节挪到 related 或 sources.locator。
//
// ---------------------------------------------------------------- 正文互链
//
// 语法 [[id]] 或 [[id|显示文字]]。缺省显示文字 = 目标词条的 term。
// 只许链接「已收录且更基础」的词条（level 不大于自己），_glossary_check.mjs 会断言。
// 不用「自动识别正文里的术语再加链接」——中文没有词边界，「寄存器」会误命中
// 「寄存器堆」、「指令」会误命中「伪指令」，那样必然链错。
//
// 字数口径见 glossaryQuery.ts 的 visibleLength（≤150），检查脚本 import 同一个函数。
// ============================================================================

// ---------------------------------------------------------------- 分类

export const GLOSSARY_CATEGORIES = [
  { id: 'concept', label: '基本概念' },
  { id: 'unit', label: '原件' },
  { id: 'timing', label: '单位时间' },
  { id: 'instruction', label: '指令' },
  { id: 'encoding', label: '指令编码' },
  { id: 'register', label: '寄存器' },
  { id: 'signal', label: '控制信号' },
  { id: 'memory', label: '存储' },
  { id: 'csr', label: 'CSR' },
  { id: 'trap', label: '异常与中断' },
  { id: 'isa', label: '指令集与工具' },
] as const

export type GlossaryCategoryId = (typeof GLOSSARY_CATEGORIES)[number]['id']

// ---------------------------------------------------------------- 词条形状

export interface GlossarySource {
  /** 出处短名。本仓库文件写相对路径，外部资料写规范/教材名 */
  label: string
  /** 可点链接，没有就只显示文字 */
  url?: string
  /** 具体章节或条目 */
  locator?: string
}

export interface GlossaryEntry {
  /** 稳定英文 slug，只含小写字母/数字/连字符。正文互链与图上映射都用它 */
  id: string
  /** 中文主标题，全局唯一 */
  term: string
  /** 英文名或缩写，详情页副标题显示，同时参与搜索 */
  en?: string
  category: GlossaryCategoryId
  /** 'project' = 本项目自创或只在本教学模型里成立，界面显示徽章，正文必须点明 */
  scope: 'standard' | 'project'
  /** 难度层级，越小越基础。互链只许指向 level 不大于自己的词条 */
  level: number
  /** 搜索别名：ABI 名、缩写、常见说法。大小写与连字符都会被抹平后再比 */
  aliases?: string[]
  /** 正文。互链语法 [[id]] / [[id|显示文字]]。可见字数 ≤150 */
  body: string
  /** 正文里塞不下的近义词条，详情页底部渲染成小按钮 */
  related?: string[]
  /** 出处小字，只显示在详情页末尾，不计入 150 字 */
  sources?: GlossarySource[]
}

// ---------------------------------------------------------------- 词条

export const ENTRIES: GlossaryEntry[] = [
  {
    id: 'cpu',
    term: '中央处理器',
    en: 'CPU · Central Processing Unit',
    category: 'concept',
    scope: 'standard',
    level: 1,
    aliases: ['处理器', '微处理器', '模型机'],
    body:
      '计算机中负责取指令、译码并执行指令的部件，由运算器与控制器组成。它从存储器取出指令，按指令的要求做运算或读写数据，再决定下一条指令的地址。本模拟器演示的是单周期模型机：一条指令在一个时钟周期内执行完；真实 CPU 普遍采用多周期或流水线。',
    sources: [
      {
        label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）',
        locator: '第 1 章 计算机抽象与技术',
      },
    ],
  },
  {
    id: 'clock-cycle',
    term: '时钟周期',
    en: 'Clock Cycle / Clock Period',
    category: 'timing',
    scope: 'standard',
    level: 1,
    // 别名里原先有「时钟信号」，现已被 clock-signal 词条占用，撤掉
    aliases: ['时钟', '周期'],
    body:
      '[[clock-signal|时钟信号]]完成一次完整高低电平变化所需的时间，是 CPU 内部计时的最小单位，等于时钟频率的倒数。单周期 CPU 中一条指令恰好用一个时钟周期执行完，因此周期必须长到能容纳这条指令最长的组合逻辑传播延迟。',
    sources: [
      {
        label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）',
        locator: '第 4 章 处理器',
      },
    ],
  },
  {
    id: 'riscv',
    term: 'RISC-V',
    en: 'RISC-V Instruction Set Architecture',
    category: 'isa',
    scope: 'standard',
    level: 1,
    aliases: ['RV32I', 'RISC-V 指令集', '第五代精简指令集'],
    body:
      '一种开放、免费、模块化的指令集架构，源于加州大学伯克利分校，任何人实现它都不需要授权费。它由基础指令集与可选扩展组成，名字里的 V 表示第五代。本模拟器实现 32 位基础整数指令集 RV32I，并补上了机器模式的中断与异常机制。',
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 1 章 引言' },
    ],
  },
  {
    id: 'instruction',
    term: '指令',
    en: 'Instruction',
    category: 'instruction',
    scope: 'standard',
    level: 2,
    // 别名里原先有「伪指令」，现已被 pseudo-instruction 词条占用，撤掉（撞车会被检查脚本判失败）
    aliases: ['汇编语句', '机器指令', '机器码', '助记符', 'inst'],
    body:
      '[[cpu|CPU]] 执行一个基本操作的命令，由[[opcode|操作码]]与操作数组成，在机器里以固定长度的二进制表示。本模拟器实现的 RV32I 指令固定为 32 位（C 扩展会引入 16 位指令）。汇编里写的助记符（如 ADD、ADDI）必须由[[assembler|汇编器]]翻译成机器码；而 li、mv、ret、nop 这类[[pseudo-instruction|伪指令]]并不对应任何机器码，会被展开成一条或多条真指令。',
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 RV32I 基础整数指令集' },
    ],
  },
  {
    id: 'datapath',
    term: '数据通路',
    en: 'Datapath',
    category: 'concept',
    scope: 'standard',
    level: 2,
    aliases: ['数据通路图', '通路'],
    body:
      '[[cpu|CPU]] 内部传送与加工数据的部件和连线的总称：数据从程序计数器出发，经指令存储器、译码器、寄存器堆、ALU、存储器，最后写回寄存器。控制器按指令产生控制信号，决定各多路选择器走哪一路；整条通路在一个[[clock-cycle|时钟周期]]内走完一遍。',
    sources: [
      {
        label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）',
        locator: '第 4 章 处理器',
      },
    ],
  },
  {
    id: 'register',
    term: '寄存器',
    en: 'Register',
    category: 'register',
    scope: 'standard',
    level: 2,
    // x0 归 zero-register 词条，这里不重复占用
    aliases: ['通用寄存器', 'GPR', 'registers'],
    body:
      '[[cpu|CPU]] 内部用于暂存数据的极小块存储，读写比内存快得多。RISC-V 有 32 个 32 位通用寄存器，编号 x0–x31；x0 的值被硬件固定为 0，写它没有任何效果。ra、sp、a0 这些名字只是软件约定的别名，不是硬件的规定。寄存器在[[clock-cycle|时钟周期]]的边沿更新。',
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 2.1 基础整数 ISA 的程序员模型' },
    ],
  },
  {
    id: 'register-file',
    term: '寄存器堆',
    en: 'Register File',
    category: 'unit',
    scope: 'standard',
    level: 3,
    aliases: ['寄存器组', 'regfile', '寄存器文件'],
    body:
      '[[cpu|CPU]] 里存放全部通用寄存器的部件，图上是标着「寄存器堆」的那个方框。它有两个读端口和一个写端口，所以一条指令能同时读出两个源操作数、写回一个结果。读是组合的——地址一给，数据立刻出来；写则发生在[[clock-cycle|时钟周期]]的边沿。',
    sources: [
      {
        label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）',
        locator: '第 4 章 处理器',
      },
    ],
  },
  {
    id: 'alu',
    term: '算术逻辑单元',
    en: 'ALU · Arithmetic Logic Unit',
    category: 'unit',
    scope: 'standard',
    level: 3,
    aliases: ['运算器', '算术运算单元'],
    body:
      '[[datapath|数据通路]]中执行算术与逻辑运算的部件，按控制信号完成加、减、与、或、异或、移位和比较。它有两个操作数输入和一个结果输出：操作数来自寄存器堆或立即数；结果或作为访存地址送存储器，或写回[[register|寄存器]]。',
    sources: [
      {
        label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）',
        locator: '第 4 章 处理器',
      },
    ],
  },
  {
    id: 'mux',
    term: '多路选择器',
    en: 'MUX · Multiplexer',
    category: 'unit',
    scope: 'standard',
    level: 3,
    aliases: ['数据选择器', '选择器', '多路复用器'],
    body:
      '在[[datapath|数据通路]]上按选择信号从多路输入中挑出一路送到输出的部件，相当于一个电子开关。图上有许多个 MUX，分别用于选择下一条 PC 的来源、ALU 的两个操作数、以及写回寄存器的数据来源。它本身不做运算，只做选择。',
    related: ['alu', 'pc'],
    sources: [
      {
        label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）',
        locator: '第 4 章 处理器',
      },
    ],
  },
  {
    id: 'pc',
    term: '程序计数器',
    en: 'PC · Program Counter',
    category: 'unit',
    scope: 'standard',
    level: 3,
    aliases: ['指令指针', 'instruction pointer', 'program counter', 'pc_next', 'pc+4', 'pc+imm'],
    body:
      '存放当前正在执行的[[instruction|指令]]地址的寄存器，图上是标着 PC 的方框。每执行完一条指令就更新它：顺序执行时加 4（RISC-V 指令长 32 位，即 4 字节），遇到跳转或分支则改成目标地址。复位时，本模拟器把它置为设定的起始地址 0x80000000。',
    related: ['clock-cycle'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 2.1 基础整数 ISA 的程序员模型' },
      { label: '本仓库 backend/cpp/src/rv_core.cpp（reset 实现）' },
    ],
  },
  {
    id: 'wave',
    term: '波次',
    en: 'Wave',
    category: 'concept',
    scope: 'project',
    level: 3,
    aliases: ['波', '逐波', '波次动画', '本波'],
    body:
      '本模拟器自创的可视化记号，不是计算机组成原理的标准术语。单周期 [[cpu|CPU]] 中一条指令只占一个[[clock-cycle|时钟周期]]，无法再分；为了让[[datapath|数据通路]]上的传播过程看得见，本模拟器把这条指令内部组合逻辑的传播延迟切成若干「波」，按信号到达的先后逐波点亮。波不占用时间。',
    related: ['datapath'],
    sources: [
      { label: '本仓库 frontend/src/data/datapathWave.ts（文件头注释）' },
      { label: '本仓库 docs/HL_CONTRACT.md（点亮契约）' },
    ],
  },
  {
    id: 'instruction-memory',
    term: '指令存储器',
    en: 'IMEM · Instruction Memory',
    category: 'memory',
    scope: 'standard',
    level: 4,
    aliases: ['IMEM', '指令内存'],
    body:
      '存放程序机器码的存储器。取指时把[[pc|程序计数器]]的值送进去，它立刻读出那一条[[instruction|指令]]。本图按经典单周期示意图，把它和数据存储器画成两块独立存储（哈佛结构）；但本模拟器的核心只有一块内存，同时承担取指与访存（冯·诺依曼结构），分开画只是为了对应示意图的传统画法。',
    sources: [
      { label: '本仓库 frontend/src/data/datapathLayout.json（imem 部件的 tip）' },
      { label: '本仓库 backend/cpp/src/rv_core.hpp / rv_core.cpp（只有一块 m_mem）' },
    ],
  },
  {
    id: 'addi',
    term: 'ADDI 指令',
    en: 'Add Immediate',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['加立即数', '立即数加法'],
    body:
      '[[instruction|指令]]中的一种：把[[register-file|寄存器堆]]里 rs1 的值加上[[immediate|立即数]] imm，结果写入 rd，形如 ADDI rd, rs1, imm，属于[[instruction-format|I 型格式]]。汇编里常用 ADDI rd, x0, imm 把常数装进寄存器——x0 恒为 0，加上它就等于直接赋值。',
    related: ['alu'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 RV32I 整数计算指令' },
    ],
  },

  // ==========================================================================
  // 第二批（2026-10-01）：指令与工具、存储与编码
  //
  // 这一批的来源规矩：标准术语引 RISC-V 规范或 Patterson & Hennessy；
  // 与「本模拟器怎么做」有关的事实一律引本仓库文件，不凭印象写。
  // 规范章节号只标到「章 + 节名」一级——本机无法打开 PDF 逐页核对，
  // 标了精确页码就是编。
  // ==========================================================================

  {
    id: 'pseudo-instruction',
    term: '伪指令',
    en: 'Pseudo-instruction',
    category: 'instruction',
    scope: 'standard',
    level: 2,
    aliases: ['伪操作', 'pseudo'],
    body:
      '[[assembler|汇编器]]为了方便书写而接受的助记符，硬件并不实现它，也不对应独立的机器码。汇编时它被展开成一条或多条真[[instruction|指令]]。例如 nop 展开为 addi x0,x0,0，ret 展开为 jalr x0,0(x1)；而 li、la、call 可能展开成多条，展开结果还取决于立即数大小。',
    related: ['instruction', 'assembler'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 2 章 汇编器' },
      { label: '本仓库 backend/python/asm.py（expand 函数，本项目实现的 9 条伪指令）' },
    ],
  },
  {
    id: 'assembler',
    term: '汇编器',
    en: 'Assembler',
    category: 'isa',
    scope: 'standard',
    level: 2,
    aliases: ['汇编程序'],
    body:
      '把汇编语言源程序翻译成机器码的程序。它还负责展开[[pseudo-instruction|伪指令]]、把标签换成具体地址。标准工具链里它产出的是目标模块，还要由链接器合并、重定位才成为可执行文件；本模拟器在没装 RISC-V 交叉工具链时用内置的简化版教学汇编器，直接产出可加载的镜像，没有链接这一步。',
    related: ['instruction', 'disassembly'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 2 章 翻译并启动程序' },
      { label: '本仓库 backend/python/asm.py（简化版教学汇编器，直接产出可加载镜像，无链接步骤）' },
    ],
  },
  {
    id: 'disassembly',
    term: '反汇编',
    en: 'Disassembly',
    category: 'isa',
    scope: 'standard',
    level: 3,
    aliases: ['反汇编器', 'disassembler'],
    body:
      '把机器码逐条还原成汇编助记符，是汇编的逆过程。它还原不出原始源码：符号名、标签、注释在翻译时就丢了，[[pseudo-instruction|伪指令]]的写法也已被展开成真[[instruction|指令]]，而且机器码里分不出哪段是指令、哪段是数据。本模拟器「指令列表」面板显示的就是反汇编结果。',
    related: ['assembler', 'instruction'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 2 章 解码机器语言' },
      { label: '本仓库 backend/cpp/src/rv_disasm.cpp' },
    ],
  },
  {
    id: 'single-cycle',
    term: '单周期',
    en: 'Single-cycle',
    category: 'concept',
    scope: 'standard',
    level: 2,
    aliases: ['单周期 CPU', '单周期模型机'],
    body:
      '每条[[instruction|指令]]都在一个[[clock-cycle|时钟周期]]内走完取指、译码、执行、访存、写回的全过程，所以 CPI 等于 1。代价是时钟周期必须长到容纳最慢那条指令的整条传播延迟，快的指令也只能白等，因此真实 [[cpu|CPU]] 很少这样造。本模拟器演示的就是单周期模型机。',
    related: ['pipeline', 'clock-cycle'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 一个简单的实现方案' },
    ],
  },
  {
    id: 'pipeline',
    term: '流水线',
    en: 'Pipelining',
    category: 'concept',
    scope: 'standard',
    level: 2,
    aliases: ['流水', '流水线技术'],
    body:
      '把一条指令的执行拆成若干阶段，让多条指令的不同阶段同时重叠进行，理想情况下每个[[clock-cycle|时钟周期]]完成一条指令。它提高的是吞吐率（单位时间完成的指令数），不是单条指令的延迟——单条指令走的阶段数并没有减少。对比：多周期是串行的，一条指令走完才处理下一条，不重叠。',
    related: ['single-cycle', 'clock-cycle'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 流水线概述' },
    ],
  },
  {
    id: 'harvard',
    term: '哈佛结构',
    en: 'Harvard Architecture',
    category: 'memory',
    scope: 'standard',
    level: 2,
    aliases: ['哈佛体系结构'],
    body:
      '指令与数据放在物理上分开的两个存储器、各有独立的访问通路，因此可以在同一周期里一边取指一边访存。分开的是存储器与通路，不是地址空间。本图按这个传统画法把指令存储器与数据存储器画成两块，但本模拟器的核心只有一块统一内存，真实 CPU 也多是缓存分开、主存统一。',
    related: ['von-neumann', 'instruction-memory', 'data-memory'],
    sources: [
      { label: '《数字设计与计算机体系结构》（RISC-V 版）', locator: '第 7 章 单周期处理器' },
      { label: '本仓库 backend/cpp/src/rv_core.hpp（只有一块 m_mem）' },
    ],
  },
  {
    id: 'von-neumann',
    term: '冯·诺依曼结构',
    en: 'von Neumann Architecture',
    category: 'memory',
    scope: 'standard',
    level: 2,
    aliases: ['普林斯顿结构', '存储程序结构'],
    body:
      '指令和数据存在同一块存储器里、共用同一套访问通路，靠地址而不是靠类型区分。[[riscv|RISC-V]] 规定一个处理器核心只有一个按字节寻址的地址空间，属于这种结构。因为取指和访存争用同一条通路，会形成「冯·诺依曼瓶颈」——这个说法出自 Backus 1977 年的图灵奖演讲。',
    related: ['harvard', 'memory-map'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 1 章 执行环境与 hart' },
      { label: 'Backus, Can Programming Be Liberated from the von Neumann Style?', locator: 'CACM 21(8), 1978' },
    ],
  },
  {
    id: 'memory-map',
    term: '内存映射',
    en: 'Memory Map',
    category: 'memory',
    scope: 'standard',
    level: 3,
    aliases: ['地址映射', 'MMIO', '内存映射 I/O'],
    body:
      '把处理器的地址空间划分成若干区段、规定每段用途（程序、数据、栈、外设寄存器）的一份分配表。[[riscv|RISC-V]] 不规定固定的内存映射，由具体机器决定。把外设寄存器也分到地址空间里、用普通访存指令就能读写，叫内存映射 I/O。本模拟器的内存是从 0x80000000 开始的一整块 128 KB 普通内存，没有实现外设区。',
    related: ['von-neumann', 'data-memory'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 1 章 执行环境与 hart（地址空间由执行环境决定）' },
      { label: '本仓库 backend/cpp/src/rv_memory.hpp' },
    ],
  },
  {
    id: 'immediate',
    term: '立即数',
    en: 'Immediate',
    category: 'encoding',
    scope: 'standard',
    level: 2,
    aliases: ['imm', '立即操作数', '偏移量', 'offset'],
    body:
      '直接编码在[[instruction|指令]]字里的常数值，不是寄存器内容；在访存与分支指令里，它往往就是地址的偏移量。I、S、B、J 四种格式取用时都符号扩展到 32 位；U 型不扩展，整段放到高 20 位、低 12 位补 0。移位指令的移位量与 CSR 指令的立即数则是固定 5 位的零扩展字段。',
    related: ['instruction-format', 'opcode'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 立即数编码变体、移位指令的 shamt' },
      { label: '本仓库 backend/cpp/src/rv_immgen.hpp（U 型只做掩码不符号扩展）与 backend/python/asm.py（移位量按 5 位字段编码）' },
    ],
  },
  {
    id: 'opcode',
    term: '操作码',
    en: 'Opcode',
    category: 'encoding',
    scope: 'standard',
    level: 2,
    aliases: ['opcode 字段'],
    body:
      '[[instruction|指令]]字里指明这是哪一类操作的字段，在 [[riscv|RISC-V]] 中占最低 7 位（第 0–6 位），位置在所有指令格式里都固定，便于译码。光看它不足以确定操作：所有 R 型指令共用同一个操作码，还要靠 funct3 与 funct7 再细分。另外低 2 位在基础指令集里恒为 11，那是 32 位指令的长度编码。',
    related: ['instruction-format', 'instruction'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 基础指令格式' },
    ],
  },
  {
    id: 'instruction-format',
    term: '指令格式',
    en: 'Instruction Format',
    category: 'encoding',
    scope: 'standard',
    level: 3,
    aliases: ['指令编码', 'R 型', 'I 型', 'S 型', 'B 型', 'U 型', 'J 型'],
    body:
      '[[instruction|指令]]里各字段的排布方式。规范给出四种核心格式 R/I/S/U，B 型与 J 型是[[immediate|立即数]]编码的变体（教材常合称六种）。rd、rs1、rs2 在所有格式里位置相同。B 型与 J 型的立即数位序是打散的、最低位隐含为 0 不存进指令——这样译码与符号扩展电路可以跨格式共用。',
    related: ['opcode', 'immediate'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 基础指令格式 / 立即数编码变体' },
    ],
  },
  {
    id: 'instruction-cycle',
    term: '指令周期',
    en: 'Instruction Cycle',
    category: 'timing',
    scope: 'standard',
    level: 2,
    aliases: ['指令执行周期'],
    body:
      '[[cpu|CPU]] 取出并执行一条指令所需的全部时间。它由若干[[machine-cycle|机器周期]]组成，每个机器周期又由若干[[clock-cycle|时钟周期]]组成，所以指令周期大于机器周期大于时钟周期。不同指令的指令周期长度可以不同。「指令周期／机器周期」这套分层是中文教材的讲法，英文教材的 instruction cycle 通常只指取指—译码—执行这个过程。',
    related: ['machine-cycle', 'clock-cycle'],
    sources: [
      { label: '唐朔飞《计算机组成原理》（第 2 版）', locator: '第 9 章 CPU 的工作过程与时序' },
    ],
  },
  {
    id: 'machine-cycle',
    term: '机器周期',
    en: 'Machine Cycle · CPU Cycle',
    category: 'timing',
    scope: 'standard',
    level: 2,
    aliases: ['CPU 周期', '节拍'],
    body:
      '在同步控制的机器里，完成一个基本操作（取指、访存、执行等）所需的时间，是[[instruction-cycle|指令周期]]的组成单位，通常以访存所需的时间为基准。一个机器周期含若干个[[clock-cycle|时钟周期]]。注意这个词是中文教材的概念，英文里没有严格对应，而且不同教材的定义也不完全一致，有的直接把它等同于主存存取周期。',
    related: ['instruction-cycle', 'clock-cycle'],
    sources: [
      { label: '唐朔飞《计算机组成原理》（第 2 版）', locator: '第 9 章 CPU 的工作过程与时序' },
    ],
  },
  {
    id: 'jalr',
    term: 'JALR 指令',
    en: 'Jump And Link Register',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['间接跳转', '寄存器间接跳转', '&~1'],
    body:
      '[[instruction|指令]]中的一种：把[[register|寄存器]] rs1 的值加上 12 位立即数，再把结果的最低位清零，作为跳转目标；同时把下一条指令地址 pc+4 写入 rd。它不是 PC 相对跳转，立即数也不像分支那样按 2 字节缩放。图上标着「&~1」的部件就是清零最低位这一步。',
    related: ['pc', 'instruction-format'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 控制转移指令（JALR 目标地址最低位清零）' },
      { label: '本仓库 frontend/src/data/datapathLayout.json（jalrclean 部件）' },
    ],
  },
  {
    id: 'branch-taken',
    term: '分支成立',
    en: 'Branch Taken',
    category: 'signal',
    scope: 'standard',
    level: 4,
    aliases: ['taken', '分支跳转成立'],
    body:
      '分支指令的条件为真时称分支成立，下一条 [[pc|PC]] 取「当前分支指令地址加上偏移」；条件为假则顺序执行 pc+4。[[riscv|RISC-V]] 没有分支延迟槽，分支后面的指令不会预先执行。本图把条件判断单独画成一个 taken 部件，用 [[alu|ALU]] 的 ZF 与 LT 两个标志判断成立与否。',
    related: ['pc', 'alu'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 控制转移指令' },
      { label: '本仓库 frontend/src/data/datapathLayout.json（taken 部件）' },
    ],
  },
  {
    id: 'data-memory',
    term: '数据存储器',
    en: 'DMEM · Data Memory',
    category: 'memory',
    scope: 'standard',
    level: 4,
    aliases: ['DMEM', '数据内存'],
    body:
      '单周期数据通路上供访存[[instruction|指令]]按地址读写数据的部件，图上是标着「数据存储器」的方框。它在示意图上与[[instruction-memory|指令存储器]]并列，是[[harvard|哈佛结构]]的传统画法；但本模拟器的核心只有一块内存同时承担取指与访存，属[[von-neumann|冯·诺依曼结构]]。本模拟器的内存从 0x80000000 起，共 128 KB。',
    related: ['instruction-memory', 'memory-map'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 处理器' },
      { label: '本仓库 backend/cpp/src/rv_core.hpp / rv_memory.hpp' },
    ],
  },

  // ==========================================================================
  // 第二批之二：原件与逻辑
  // ==========================================================================

  {
    id: 'adder',
    term: '加法器',
    en: 'Adder',
    category: 'unit',
    scope: 'standard',
    level: 3,
    aliases: ['全加器', '半加器', '行波进位加法器'],
    body:
      '执行二进制相加的组合电路，[[alu|ALU]] 的运算和地址计算都靠它。半加器两个输入、没有进位输入；全加器三个输入，多出来的那路是来自低位的进位，它是多位加法器的基本单元。把多个全加器串起来、进位逐级传递叫行波进位加法器，结构简单，但高位必须等低位，延迟随位宽线性增长。',
    related: ['combinational-logic', 'alu'],
    sources: [
      { label: '《数字设计与计算机体系结构》（RISC-V 版）', locator: '第 5 章 数字构件（加法器）' },
      { label: 'Wikipedia, Adder (electronics)', url: 'https://en.wikipedia.org/wiki/Adder_(electronics)' },
    ],
  },
  {
    id: 'decoder',
    term: '译码器',
    en: 'Decoder',
    category: 'unit',
    scope: 'standard',
    level: 3,
    aliases: ['指令译码器', '二进制译码器'],
    body:
      '这个词有公认的两个含义，不能混。一是通用组合逻辑译码器：n 位输入对应 2ⁿ 个输出，任一时刻只有一路有效、其余为 0，3-8 译码器即此类。二是 CPU 的指令译码器：取指后按 [[riscv|RISC-V]] 规定把指令拆成操作码、寄存器号与立即数，产出控制各部件的信号。图上标「译码器」的是后者。',
    related: ['control-signal', 'instruction-format'],
    sources: [
      { label: 'Wikipedia, Binary decoder', url: 'https://en.wikipedia.org/wiki/Binary_decoder' },
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 基础指令格式' },
    ],
  },
  {
    id: 'constant',
    term: '常量源',
    en: 'Constant',
    category: 'unit',
    scope: 'project',
    level: 3,
    aliases: ['常量', '常数模块'],
    body:
      '示意图上直接往某个输入引一个固定数值的那根线，本项目用它标加法器旁的 4、以及指令存储器写端口旁的 0。说实话，标准教材对「示意图上的常量输入」并没有统一的元件名，P&H 的图里就是直接写数字；HDL 里叫 constant（Verilog 是 parameter），标准单元库里叫 tie cell，都不是这个示意图语境的名字。它不存数据，也不参与时序。',
    related: ['adder', 'mux'],
    sources: [
      { label: '《数字设计与计算机体系结构》（RISC-V 版）', locator: '第 5 章 数字构件（值固定）' },
      { label: '本仓库 frontend/src/data/datapathLayout.json（const0 / const4 部件）' },
    ],
  },
  {
    id: 'combinational-logic',
    term: '组合逻辑',
    en: 'Combinational Logic',
    category: 'concept',
    scope: 'standard',
    level: 2,
    aliases: ['组合电路'],
    body:
      '输出只取决于当前输入、不含记忆元件的数字逻辑，加法器、多路选择器、译码器都属于它。要点两条：一是「只取决于当前输入」，二是无状态，这正是它与[[sequential-logic|时序逻辑]]的分界。还要注意它并非瞬时响应：信号要经过传播延迟才稳定，不同路径延迟不同还可能产生毛刺。',
    related: ['sequential-logic', 'alu'],
    sources: [
      { label: 'Wikipedia, Combinational logic', url: 'https://en.wikipedia.org/wiki/Combinational_logic' },
      { label: '《数字设计与计算机体系结构》（RISC-V 版）', locator: '第 2 章 组合逻辑设计' },
    ],
  },
  {
    id: 'sequential-logic',
    term: '时序逻辑',
    en: 'Sequential Logic',
    category: 'concept',
    scope: 'standard',
    level: 2,
    aliases: ['时序电路'],
    body:
      '输出不仅取决于当前输入，还取决于过去输入的历史，也就是带记忆的逻辑，基本存储元件是触发器。与[[combinational-logic|组合逻辑]]的分界就在有没有状态。多数现代时序逻辑是同步的，只在时钟边沿改变状态；但也有不依赖时钟、输入一变就响应的异步时序逻辑，所以不能把「时序逻辑」直接等同于「有时钟」。',
    related: ['combinational-logic', 'register'],
    sources: [
      { label: 'Wikipedia, Sequential logic', url: 'https://en.wikipedia.org/wiki/Sequential_logic' },
      { label: '《数字设计与计算机体系结构》（RISC-V 版）', locator: '第 3 章 时序逻辑设计' },
    ],
  },
  {
    id: 'clock-signal',
    term: '时钟信号',
    en: 'Clock Signal',
    category: 'timing',
    scope: 'standard',
    level: 1,
    aliases: ['clock', 'clk', '上升沿', '下降沿', '时钟沿', 'clock edge'],
    body:
      '数字电路里用来协调各部件动作的周期性方波，常写作 CLK，典型占空比为 50%。相邻两个上升沿之间的时间就是[[clock-cycle|时钟周期]]，频率与周期互为倒数。触发器只在有效边沿采样，采样要求输入在边沿前后分别满足建立时间与保持时间，否则可能进入亚稳态。',
    related: ['clock-cycle', 'sequential-logic'],
    sources: [
      { label: 'Wikipedia, Clock signal', url: 'https://en.wikipedia.org/wiki/Clock_signal' },
      { label: '《数字设计与计算机体系结构》（RISC-V 版）', locator: '第 3 章 时序逻辑设计' },
    ],
  },
  {
    id: 'reset-signal',
    term: '复位信号',
    en: 'Reset',
    category: 'timing',
    scope: 'standard',
    level: 2,
    aliases: ['复位', 'reset'],
    body:
      '把触发器强制到已知初始状态的控制信号，上电时必用，因为上电瞬间触发器状态不确定。同步复位要等下一个有效时钟边沿才生效，异步复位一有效立即生效、与时钟无关。复位通常不等同于清零——也可能置 1。规范意义上的复位不动内存；本模拟器为教学方便，复位时把寄存器堆、CSR 与整块内存一起清零，PC 置为 0x80000000。',
    related: ['clock-signal', 'pc'],
    sources: [
      { label: 'Wikipedia, Reset (computing)', url: 'https://en.wikipedia.org/wiki/Reset_(computing)' },
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '复位行为：pc 置为实现定义的复位向量' },
      { label: '本仓库 backend/cpp/src/rv_memory.hpp（RESET_VECTOR）' },
    ],
  },

  // ==========================================================================
  // 第二批之三：异常与 CSR
  //
  // 这一批里有三处必须对学生讲明白的「本项目与规范不一致」，都不是小事：
  //   · mtime / mtimecmp 规范里是内存映射寄存器，不是 CSR，也没有规定地址，
  //     本项目为了让面板能显示把它们当 CSR 用（0xC01 / 0x780）
  //   · 0x780 落在规范留给未来标准的 0x780–0x79F 区段，自定义区是 0x7C0–0x7FF
  //   · MRET 只做了 PC←mepc 与 MIE←MPIE，没做规范要求的 MPIE←1、MPP←最低级
  // 学生拿这些地址去真机上用会直接吃非法指令，所以正文必须点名。
  // ==========================================================================

  {
    id: 'csr',
    term: '控制状态寄存器',
    en: 'CSR · Control and Status Register',
    category: 'csr',
    scope: 'standard',
    level: 4,
    aliases: ['控制和状态寄存器', 'csr 寄存器'],
    body:
      'CPU 内部一组按编号读写的专用寄存器，用来控制运行状态或读回状态，例如中断总开关、trap 入口地址、出错原因。[[riscv|RISC-V]] 给它们 12 位地址空间，共 4096 个。只能用 csrrw / csrrs / csrrc 等[[instruction|指令]]读写，普通访存指令够不着。地址最高两位为 11 的（0xC00 起）是只读区。',
    related: ['machine-mode', 'mstatus'],
    sources: [
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 2 章 控制状态寄存器（CSR 地址空间与只读区）' },
    ],
  },
  {
    id: 'machine-mode',
    term: '机器模式',
    en: 'Machine Mode · M-mode',
    category: 'csr',
    scope: 'standard',
    level: 4,
    aliases: ['M 模式', 'M-mode', '机器态'],
    body:
      '[[riscv|RISC-V]] 权限级别中最高的一级，能访问全部 [[csr|CSR]] 与内存，也是唯一必须实现的级别。规范规定复位后必定进入机器模式。本模拟器只实现这一级：没有用户模式，没有特权级切换，所以 [[mstatus|mstatus]] 里记录上一级权限的 MPP 字段始终用不上。',
    related: ['csr', 'trap'],
    sources: [
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 1 章 特权级' },
      { label: '本仓库 backend/cpp/src/rv_core.cpp（未实现特权级切换）' },
    ],
  },
  {
    id: 'mstatus',
    term: 'mstatus',
    en: 'Machine Status Register',
    category: 'csr',
    scope: 'standard',
    level: 4,
    aliases: ['0x300', '机器状态寄存器'],
    body:
      '机器模式的状态寄存器，地址 0x300。要认出三个位：MIE（第 3 位）是中断总开关；MPIE（第 7 位）在进 trap 时保存原来的 MIE；MPP（第 11–12 位）记 trap 前处在哪个权限级。进 trap 时 MPIE 取 MIE、MIE 清 0；mret 时 MIE 取回 MPIE。本模拟器不写 MPP。',
    related: ['csr', 'mie'],
    sources: [
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 3 章 机器模式（mstatus 字段）' },
      { label: '本仓库 backend/cpp/src/rv_core.cpp（raise_trap / MRET）' },
    ],
  },
  {
    id: 'mtvec',
    term: 'mtvec',
    en: 'Machine Trap Vector',
    category: 'csr',
    scope: 'standard',
    level: 4,
    aliases: ['0x305', 'trap 入口'],
    body:
      'trap 处理程序的入口地址寄存器，地址 0x305。最低 2 位是模式：0 为直接模式，所有 trap 都跳到基地址；1 为向量模式，中断跳到「基地址加 4×原因编号」，但同步异常仍跳到基地址——也就是说只有中断会被向量化。本模拟器只用直接模式；mtvec 为 0 时停机兜底。',
    related: ['trap', 'mcause'],
    sources: [
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 3 章 机器模式（mtvec 的 MODE 字段）' },
      { label: '本仓库 backend/cpp/src/rv_core.cpp（mtvec 为 0 则停机）' },
    ],
  },
  {
    id: 'mepc',
    term: 'mepc',
    en: 'Machine Exception Program Counter',
    category: 'csr',
    scope: 'standard',
    level: 4,
    aliases: ['0x341', '异常返回地址'],
    body:
      '地址 0x341，保存触发 trap 的那条指令的地址——不是它的下一条。所以 mret 会回到同一条指令重新执行；对 ecall、ebreak 这类由指令自身触发的 trap，处理程序必须先把它加 4，否则会原地死循环。本模拟器记的就是触发时刻的 PC，与规范一致。',
    related: ['trap', 'mret'],
    sources: [
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 3 章 机器模式（mepc）' },
      { label: '本仓库 backend/cpp/src/rv_core.cpp（raise_trap 中 mepc = m_pc）' },
    ],
  },
  {
    id: 'mcause',
    term: 'mcause',
    en: 'Machine Cause Register',
    category: 'csr',
    scope: 'standard',
    level: 4,
    aliases: ['0x342', 'trap 原因'],
    body:
      '地址 0x342，记录 trap 的原因编号。最高位（RV32 是第 31 位）是中断位：1 表示中断，0 表示异常；低位那一段叫 Exception Code，即使对中断也沿用这个叫法。本模拟器会出现四个值：0x00000002 非法指令，0x00000003 机器模式的 ebreak，0x0000000B 机器模式的 ecall，0x80000007 定时器中断。',
    related: ['trap', 'mtvec'],
    sources: [
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 3 章 机器模式（mcause 与原因编号表）' },
      { label: '本仓库 backend/cpp/src/rv_core.cpp（raise_trap 的四处调用：非法指令 2、ebreak 3、ecall 11、定时器 0x80000007）' },
    ],
  },
  {
    id: 'mie',
    term: 'mie',
    en: 'Machine Interrupt Enable',
    category: 'csr',
    scope: 'standard',
    level: 4,
    aliases: ['0x304', '中断使能'],
    body:
      '地址 0x304，按位分别使能各类中断。本模拟器只用到第 7 位 MTIE，即机器定时器中断使能。它只是分开关，还要与 [[mstatus|mstatus]] 的 MIE 总开关同时为 1，中断才真的能进——两者是「与」的关系。软件中断、外部中断等其他位本项目未实现。',
    related: ['mstatus', 'mip'],
    sources: [
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 3 章 机器模式（mie 的 MTIE 位）' },
      { label: '本仓库 backend/cpp/src/rv_core.cpp（定时器中断的三道门槛）' },
    ],
  },
  {
    id: 'mip',
    term: 'mip',
    en: 'Machine Interrupt Pending',
    category: 'csr',
    scope: 'standard',
    level: 4,
    aliases: ['0x344', '中断挂起'],
    body:
      '地址 0x344，按位记录哪些中断正等待处理，位的位置与 mie 一一对应。规范里它通常是只读的。这一点要说清楚：本模拟器的核心从不写它，所以只要程序不主动去写，界面上这一栏就一直是 0，那是模型机没有实现该功能，不代表真实机器也如此——真实机器上定时器到点会把对应位置 1。',
    related: ['mie', 'mtimecmp'],
    sources: [
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 3 章 机器模式（mip）' },
      { label: '本仓库 backend/cpp/src/rv_core.cpp（核心从不写 0x344；但 csr_write 只把 0xC00/0xC01/0xC02 当只读，程序写 0x344 仍会生效）' },
    ],
  },
  {
    id: 'mtime',
    term: 'mtime',
    en: 'Machine Timer',
    category: 'csr',
    scope: 'project',
    level: 4,
    aliases: ['0xC01', '机器定时器', 'time 寄存器'],
    body:
      '机器定时器，记录自复位起经过的时间。规范把它定义为机器级内存映射寄存器（MMIO），不是 [[csr|CSR]]，也没有规定地址，SiFive 的 CLINT 用 0x200BFF8 只是事实标准。本模拟器为教学把它当 CSR 读：地址 0xC01。这个编号原本属于标准 time 寄存器，标准里 time 正是 mtime 的只读影子。',
    related: ['mtimecmp', 'mcause'],
    sources: [
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 3 章 机器级内存映射寄存器（机器定时器）' },
      { label: '本仓库 backend/cpp/src/rv_core.cpp（finalize_step 写 0xC01）' },
    ],
  },
  {
    id: 'mtimecmp',
    term: 'mtimecmp',
    en: 'Machine Timer Compare',
    category: 'csr',
    scope: 'project',
    level: 4,
    aliases: ['0x780', '定时器比较值'],
    body:
      '定时器比较值：mtime 大于等于它时，若 mie 的 MTIE 与 mstatus 的 MIE 都为 1，就触发机器定时器中断，mcause 为 0x80000007。规范里它和 mtime 一样属于内存映射寄存器、没有规定地址。本模拟器自定义放在 [[csr|CSR]] 0x780——而 0x780–0x79F 规范留给未来标准，自定义区其实是 0x7C0 起。',
    related: ['mtime', 'interrupt'],
    sources: [
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 3 章 机器级内存映射寄存器（mtimecmp）与 CSR 地址分配' },
      { label: '本仓库 backend/cpp/src/rv_core.cpp（定时器中断门槛，0x780 为自定义）' },
    ],
  },
  {
    id: 'trap',
    term: '陷阱',
    en: 'Trap',
    category: 'trap',
    scope: 'standard',
    level: 4,
    aliases: ['陷入'],
    body:
      'trap 指控制权被转移给处理程序这件事本身，不是原因。原因分两类：与[[instruction|指令]]同步发生的叫[[exception|异常]]，如非法指令、ecall；来自外部、与指令异步的叫[[interrupt|中断]]，如定时器到点。还要注意并非所有异常都会 trap——浮点异常在 F/D 扩展里默认只置标志位，不转移控制权。',
    related: ['exception', 'interrupt'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 1 章 执行环境与 hart（trap 的定义）' },
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 3 章 机器模式（trap 的进入与返回）' },
    ],
  },
  {
    id: 'exception',
    term: '异常',
    en: 'Exception',
    category: 'trap',
    scope: 'standard',
    level: 4,
    body:
      '与某条指令同步产生、由这条指令自身引起的 trap 原因，比如非法指令、地址不对齐、ecall。它与[[interrupt|中断]]的区别就在「同步」：异常一定对应一条具体指令，处理完可以回到这条指令重新执行，[[mepc|mepc]] 记的正是它的地址。[[riscv|RISC-V]] 用 [[mcause|mcause]] 的低位区分各种异常。',
    related: ['trap', 'interrupt'],
    sources: [
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 3 章 机器模式（同步异常与原因编号）' },
    ],
  },
  {
    id: 'interrupt',
    term: '中断',
    en: 'Interrupt',
    category: 'trap',
    scope: 'standard',
    level: 4,
    aliases: ['外部中断'],
    body:
      '来自处理器外部、与当前指令不同步的事件引起的 trap 原因，比如定时器到点、外设请求。它不绑定到某条指令，因此可以在两条指令之间随时被响应。真正被响应要三个条件同时成立：事件发生、mie 里对应位使能、mstatus 的 MIE 总开关打开。[[riscv|RISC-V]] 用 [[mcause|mcause]] 最高位为 1 表示中断。',
    related: ['trap', 'exception'],
    sources: [
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 3 章 机器模式（中断与使能条件）' },
      { label: '本仓库 backend/cpp/src/rv_core.cpp（定时器中断的三道门槛）' },
    ],
  },
  {
    id: 'ecall',
    term: 'ECALL 指令',
    en: 'Environment Call',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['环境调用', '系统调用', 'syscall'],
    body:
      '[[instruction|指令]]中的一种：主动发起一次[[trap|trap]]，请求运行环境提供服务，例如系统调用。它没有操作数，靠事先把参数放进约定好的寄存器来传参。在机器模式执行时 mcause 为 0x0000000B；在用户模式执行则为 8。它属于[[exception|异常]]，因为是由这条指令同步触发的。',
    related: ['ebreak', 'mret'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 环境调用与断点' },
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 3 章 机器模式（ecall 的 mcause 值）' },
    ],
  },
  {
    id: 'ebreak',
    term: 'EBREAK 指令',
    en: 'Environment Break',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['断点指令'],
    body:
      '[[instruction|指令]]中的一种：主动发起一次给调试器用的[[trap|trap]]，通常让调试器接管程序。编码固定为 0x00100073，只有这一条指令使用它。与 ecall 的区别在用途：ecall 用于系统调用，ebreak 用于断点。本模拟器按异常处理它，mcause 为 0x00000003。',
    related: ['ecall', 'trap'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 环境调用与断点' },
      { label: '本仓库 backend/cpp/src/rv_disasm.cpp（系统指令按高 12 位区分）' },
    ],
  },
  {
    id: 'mret',
    term: 'MRET 指令',
    en: 'Machine-mode Return',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['trap 返回'],
    body:
      '[[instruction|指令]]中的一种：从[[trap|trap]] 处理程序返回。它把 PC 设为 [[mepc|mepc]]，并把 [[mstatus|mstatus]] 的 MIE 恢复成 MPIE。规范还要求它把 MPIE 置 1、把 MPP 置回权限最低的模式；本模拟器这两件都没做，属于教学简化，正常返回流程不受影响。',
    related: ['mepc', 'mstatus'],
    sources: [
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 3 章 机器模式（MRET 行为）' },
      { label: '本仓库 backend/cpp/src/rv_core.cpp（MRET 分支只改 PC 与 MIE）' },
    ],
  },

  // ==========================================================================
  // 第三批：RV32I 整数计算指令
  //
  // 出处统一是手册第 2 章「整数计算指令」下的
  // Integer Register-Register Operations 与 Integer Register-Immediate Instructions
  // 两小节。分节号只写到节名——本机打不开 PDF 逐页核，标精确编号就是编。
  //
  // 写法上刻意让每条都带一个「最容易错的地方」，而不是抄一遍定义：
  // FUNCT7 差一位（ADD/SUB、SRL/SRA）、移位量只取低 5 位、立即数符号扩展
  // （SLTIU 的 -1、ANDI 的 0xFFF、ORI 的 0x800）——这几处是学生真会栽的坑。
  // 手册本身没给这些数值例子，是从「12 位立即数一律符号扩展」推出来的。
  // ==========================================================================

  {
    id: 'add',
    term: 'ADD 指令',
    en: 'Add',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['加法指令'],
    body:
      '把[[register-file|寄存器堆]]里两个寄存器的值相加，结果写入 rd，即 rd = rs1 + rs2。溢出被静默忽略，只保留低 32 位，不产生任何异常——[[riscv|RISC-V]] 没有算术溢出标志位。它与 SUB 的编码只差 funct7 一处。',
    related: ['sub', 'instruction-format'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（寄存器-寄存器运算）' },
    ],
  },
  {
    id: 'sub',
    term: 'SUB 指令',
    en: 'Subtract',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['减法指令'],
    body:
      '把 rs1 减去 rs2，结果写入 rd，即 rd = rs1 - rs2。它是 R 型里「同操作码、同 funct3，只靠 funct7 区分」的一对之一：SUB 的 funct7 是 0100000，ADD 是 0000000，其余字段完全一样。溢出同样静默忽略。',
    related: ['add', 'instruction-format'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（寄存器-寄存器运算）' },
    ],
  },
  {
    id: 'sll',
    term: 'SLL 指令',
    en: 'Shift Left Logical',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['逻辑左移'],
    body:
      '逻辑左移：把 rs1 左移 rs2 位，低位补 0。移位量只取 rs2 的低 5 位，所以 rs2 写 33 实际只移 1 位，写 32 则一位都不移——硬件直接对 32 取模，既不报错也不饱和。这是 RV32I 的规定，RV64I 取低 6 位。',
    related: ['srli', 'instruction-format'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（移位量取 rs2 低 5 位）' },
    ],
  },
  {
    id: 'slt',
    term: 'SLT 指令',
    en: 'Set Less Than',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['有符号比较'],
    body:
      '有符号比较：rs1 小于 rs2 时 rd 置 1，否则置 0。比较时两个数都按二进制补码解释，所以 0xFFFFFFFF 被当作 -1，是最小的数而不是最大的。它与 SLTU 只差 funct3 一位（010 对 011），结论却可能完全相反。',
    related: ['sltu', 'alu'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（寄存器-寄存器运算）' },
    ],
  },
  {
    id: 'sltu',
    term: 'SLTU 指令',
    en: 'Set Less Than Unsigned',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['无符号比较'],
    body:
      '无符号比较：rs1 小于 rs2 时 rd 置 1，否则置 0。同一对位模式 0xFFFFFFFF 与 1：SLT 按有符号解释，判它是最小的数；SLTU 按无符号解释，判它是最大的数。写 SLTU rd, x0, rs2 可当「rs2 非零」用，因为 x0 恒为 0。',
    related: ['slt', 'alu'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（寄存器-寄存器运算）' },
    ],
  },
  {
    id: 'xor',
    term: 'XOR 指令',
    en: 'Exclusive Or',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['异或'],
    body:
      '按位异或：rd = rs1 ^ rs2，两位不同时该位为 1，相同时为 0。常见用法是与自身异或得到 0，以及翻转指定的位。两个操作数都是 32 位，逐位独立运算，不产生进位，也不区分有符号与无符号。',
    related: ['xori', 'or'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（寄存器-寄存器运算）' },
    ],
  },
  {
    id: 'srl',
    term: 'SRL 指令',
    en: 'Shift Right Logical',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['逻辑右移'],
    body:
      '逻辑右移：把 rs1 右移 rs2 位，空出的高位补 0。移位量也只取 rs2 的低 5 位。它与 SRA 的操作码、funct3 完全相同，只有 funct7 不同（0000000 对 0100000），也就是只差一个位，就把「补 0」换成了「补符号位」。',
    related: ['sra', 'srli'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（右移类型编码在第 30 位）' },
    ],
  },
  {
    id: 'sra',
    term: 'SRA 指令',
    en: 'Shift Right Arithmetic',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['算术右移'],
    body:
      '算术右移：把 rs1 右移 rs2 位，空出的高位复制原来的符号位，这样负数右移后仍是负数。注意它不是对每个数都等于除以 2 的幂：-1 右移任意位仍然是 -1。与 SRL 只差 funct7 一位；被移的数是正数时两者结果相同。',
    related: ['srl', 'srai'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（算术右移复制符号位）' },
    ],
  },
  {
    id: 'or',
    term: 'OR 指令',
    en: 'Or',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['按位或'],
    body:
      '按位或：rd = rs1 | rs2，两位中只要有一个为 1，该位就是 1。常用来把指定位置 1，或把两段互不重叠的位段拼成一个数。逐位独立运算，不产生进位，也不区分有符号与无符号。',
    related: ['ori', 'and'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（寄存器-寄存器运算）' },
    ],
  },
  {
    id: 'and',
    term: 'AND 指令',
    en: 'And',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['按位与'],
    body:
      '按位与：rd = rs1 & rs2，两位同时为 1 时该位才是 1。常用来做掩码、取出指定的位段。用寄存器当掩码不会遇到麻烦；若改用立即数写掩码就要当心符号扩展，见 [[andi|ANDI]]。',
    related: ['andi', 'or'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（寄存器-寄存器运算）' },
    ],
  },
  {
    id: 'slti',
    term: 'SLTI 指令',
    en: 'Set Less Than Immediate',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    body:
      '有符号立即数比较：rs1 小于立即数时 rd 置 1，否则置 0。立即数是 12 位、先符号扩展成 32 位再参与比较，所以能直接与 -1、-2048 这类负数比较，取值范围是 -2048 到 2047。',
    related: ['slt', 'immediate'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（寄存器-立即数）' },
    ],
  },
  {
    id: 'sltiu',
    term: 'SLTIU 指令',
    en: 'Set Less Than Immediate Unsigned',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    body:
      '无符号立即数比较：rs1 小于立即数时 rd 置 1。这里有个必须记住的坑——立即数先符号扩展成 32 位，再按无符号解释。所以 SLTIU rd, rs1, -1 里那个 -1 先变成 0xFFFFFFFF，含义是「小于 4294967295」，几乎总是成立，而不是「小于 -1」。',
    related: ['sltu', 'immediate'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（立即数先符号扩展再按无符号解读）' },
    ],
  },
  {
    id: 'xori',
    term: 'XORI 指令',
    en: 'Exclusive Or Immediate',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    body:
      '按位异或，第二个操作数是 12 位立即数，立即数先符号扩展。最常用的写法是 XORI rd, rs1, -1：-1 扩展后 32 位全为 1，任何数与全 1 异或都等于按位取反，这正是标准汇编器里 not 伪指令的展开形式。本模拟器没有实现 not，需要取反就直接写 xori rd, rs1, -1。',
    related: ['xor', 'immediate'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（XORI 立即数为 -1 即按位取反）' },
    ],
  },
  {
    id: 'ori',
    term: 'ORI 指令',
    en: 'Or Immediate',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    body:
      '按位或，第二个操作数是 12 位立即数，立即数先符号扩展——这一点容易吃亏：ORI rd, rs1, 0x800 里的 0x800 因第 11 位为 1，扩展后变成 0xFFFFF800，会把高 20 位全部置 1，而不是只置第 11 位。',
    related: ['or', 'immediate'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（立即数一律符号扩展）' },
    ],
  },
  {
    id: 'andi',
    term: 'ANDI 指令',
    en: 'And Immediate',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    body:
      '按位与，第二个操作数是 12 位立即数，立即数先符号扩展。这是最容易写错的一条：ANDI rd, rs1, 0xFF 能正常取出低 8 位，但 ANDI rd, rs1, 0xFFF 会因第 11 位为 1 而扩展成 0xFFFFFFFF，结果等于原值，掩码完全失效。',
    related: ['and', 'immediate'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（立即数一律符号扩展）' },
    ],
  },
  {
    id: 'slli',
    term: 'SLLI 指令',
    en: 'Shift Left Logical Immediate',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    body:
      '逻辑左移，移位量来自指令里的立即数：把 rs1 左移 shamt 位，低位补 0。shamt 取自立即数的低 5 位，范围 0 到 31，编码不出 32 及以上的移位量。它靠 funct3 = 001 与两条右移指令区分，立即数的高 7 位固定为 0000000。',
    related: ['sll', 'srli'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（移位量编码在立即数低 5 位）' },
    ],
  },
  {
    id: 'srli',
    term: 'SRLI 指令',
    en: 'Shift Right Logical Immediate',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    body:
      '逻辑右移，移位量来自立即数：把 rs1 右移 shamt 位，空出的高位补 0。shamt 取立即数的低 5 位，范围 0 到 31。它与 SRAI 共用同一个 funct3（101），只靠立即数第 11 到 5 位区分：SRLI 是 0000000，SRAI 是 0100000。',
    related: ['srl', 'srai'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（右移类型编码在立即数高 7 位）' },
    ],
  },
  {
    id: 'srai',
    term: 'SRAI 指令',
    en: 'Shift Right Arithmetic Immediate',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    body:
      '算术右移，移位量来自立即数：把 rs1 右移 shamt 位，空出的高位复制符号位。它与 SRLI 共用 funct3 = 101，靠立即数第 11 到 5 位区分，SRAI 是 0100000，也就是指令第 30 位为 1——和 SUB、SRA 用 funct7 区分时用的是同一个位。',
    related: ['sra', 'srli'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（算术右移复制符号位）' },
    ],
  },

  // ==========================================================================
  // 第四批：访存、分支、跳转、高位立即数、屏障
  //
  // 两处「学生一定会栽」的地方，每条都点破了：
  //   · 加载的符号扩展与零扩展（0xFF 经 LB 是 -1 不是 255）
  //   · 存储取的是 rs2 的低位（0x12345678 经 SH 存的是 0x5678 不是 0x1234）
  // 分支的 funct3 记法（第 2 位=小于类、第 1 位=无符号、第 0 位=取反）是
  // 真实存在的编码规律，但规范正文没这么写，所以正文里明说是「记法」。
  // ==========================================================================

  {
    id: 'lb',
    term: 'LB 指令',
    en: 'Load Byte',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['字节加载'],
    body:
      '从内存读 1 字节写入 rd，读出的字节按有符号数扩展到 32 位。所以内存里那个字节若是 0xFF，LB 得到 0xFFFFFFFF，也就是 -1，而不是 0x000000FF。有效地址是 rs1 加上符号扩展的 12 位偏移。它与 LBU 是两条独立指令。',
    related: ['lbu', 'data-memory'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 加载与存储指令（LB 符号扩展）' },
    ],
  },
  {
    id: 'lh',
    term: 'LH 指令',
    en: 'Load Halfword',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['半字加载'],
    body:
      '从内存读 2 字节拼成 16 位（小端：低地址存低 8 位），再符号扩展到 32 位写入 rd。半字 0x8000 经 LH 得到 0xFFFF8000，即 -32768；经 LHU 则得到 0x00008000。寻址用 rs1 加符号扩展的 12 位偏移。',
    related: ['lhu', 'data-memory'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 加载与存储指令（LH 符号扩展）' },
    ],
  },
  {
    id: 'lw',
    term: 'LW 指令',
    en: 'Load Word',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['字加载'],
    body:
      '从内存读 4 字节拼成 32 位写入 rd。RV32 的字长就是 32 位，所以不涉及扩展问题，它也是 RV32I 里唯一的字宽加载指令——funct3 为 011 的 LD 和 110 的 LWU 都属于 RV64I，在这里是保留编码。',
    related: ['sw', 'data-memory'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 加载与存储指令（LW 读 32 位）' },
    ],
  },
  {
    id: 'lbu',
    term: 'LBU 指令',
    en: 'Load Byte Unsigned',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['无符号字节加载'],
    body:
      '从内存读 1 字节，高 24 位全部填 0（零扩展）后写入 rd。它与 LB 是两条独立指令，不是同一条加个后缀。编码上有个便于记忆的规律：funct3 第 2 位为 1 就是无符号版（LB 是 000，LBU 是 100），但这只是记法，规范并未这样表述。',
    related: ['lb', 'lhu'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 加载与存储指令（LBU 零扩展）' },
    ],
  },
  {
    id: 'lhu',
    term: 'LHU 指令',
    en: 'Load Halfword Unsigned',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['无符号半字加载'],
    body:
      '从内存读 2 字节，高 16 位填 0（零扩展）后写入 rd。与 LH 是两条独立指令：同一个半字 0x8000，LH 得到 -32768，LHU 得到 32768。存储侧没有对应的「无符号存储」——存储只截取低位，不涉及扩展。',
    related: ['lh', 'lbu'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 加载与存储指令（LHU 零扩展）' },
    ],
  },
  {
    id: 'sb',
    term: 'SB 指令',
    en: 'Store Byte',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['字节存储'],
    body:
      '把 rs2 的最低 8 位写入内存，高 24 位直接丢弃。rs2 是 0x12345678 时 SB 只存 0x78。它没有 rd：S 型指令里 rd 的位置被立即数的低 5 位占用了。有效地址是 rs1 加上符号扩展的 12 位偏移。',
    related: ['lb', 'data-memory'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 加载与存储指令（存储取 rs2 低位）' },
    ],
  },
  {
    id: 'sh',
    term: 'SH 指令',
    en: 'Store Halfword',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['半字存储'],
    body:
      '把 rs2 的最低 16 位写入内存，高 16 位丢弃。rs2 是 0x12345678 时 SH 存的是 0x5678，也就是低半字而不是高半字，这一点容易记反。地址仍是 rs1 加符号扩展的 12 位偏移，且这条指令不写任何寄存器。',
    related: ['lh', 'sw'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 加载与存储指令（存储取 rs2 低位）' },
    ],
  },
  {
    id: 'sw',
    term: 'SW 指令',
    en: 'Store Word',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['字存储'],
    body:
      '把 rs2 的 32 位写入内存。RV32 下字长就是 32 位，所以「丢弃高位」在 SW 上根本看不出来，要举例只能用 SB 或 SH。它同样没有 rd，因为 S 型的 rd 位置被立即数低 5 位占了——这是 S 型最不合直觉的一点。',
    related: ['lw', 'data-memory'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 加载与存储指令（SW 存 32 位）' },
    ],
  },
  {
    id: 'beq',
    term: 'BEQ 指令',
    en: 'Branch if Equal',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['相等分支'],
    body:
      '条件分支：rs1 与 rs2 相等时跳转，否则顺序执行下一条。它不写任何寄存器，偏移也是相对分支指令自身的地址，不是 pc+4。偏移范围是 -4096 到 +4094 字节，因为编码进去的偏移最低位恒为 0、不占位置。',
    related: ['bne', 'branch-taken'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 控制转移指令（条件分支与偏移范围）' },
    ],
  },
  {
    id: 'bne',
    term: 'BNE 指令',
    en: 'Branch if Not Equal',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['不等分支'],
    body:
      '条件分支：rs1 与 rs2 不相等时跳转，否则顺序执行下一条。它与 BEQ 同属「只判断相等性」的一组，因此不涉及有符号无符号的问题——相等就是相等。偏移相对分支指令自身，范围 -4096 到 +4094 字节，不写任何寄存器。',
    related: ['beq', 'branch-taken'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 控制转移指令（条件分支）' },
    ],
  },
  {
    id: 'blt',
    term: 'BLT 指令',
    en: 'Branch if Less Than',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['有符号小于分支'],
    body:
      '条件分支：把 rs1 与 rs2 都当有符号数比较，rs1 较小时跳转。要注意它的 funct3 是 100 而不是 010——分支组里 010 与 011 是保留编码，用了会触发非法指令。它与 BLTU 的差别只在比较器按不按符号位解释。',
    related: ['bge', 'bltu'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 控制转移指令（有符号比较分支）' },
    ],
  },
  {
    id: 'bge',
    term: 'BGE 指令',
    en: 'Branch if Greater or Equal',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['有符号不小于分支'],
    body:
      '条件分支：把 rs1 与 rs2 都当有符号数比较，rs1 不小于 rs2 时跳转，funct3 是 101。分支组的 funct3 有个便于记忆的规律：第 2 位为 1 表示属于「小于」类比较，第 1 位为 1 表示无符号，第 0 位为 1 表示把条件取反。这是记法，规范正文没有这样写。',
    related: ['blt', 'bgeu'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 控制转移指令（条件分支的 funct3）' },
    ],
  },
  {
    id: 'bltu',
    term: 'BLTU 指令',
    en: 'Branch if Less Than Unsigned',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['无符号小于分支'],
    body:
      '条件分支：把 rs1 与 rs2 都当无符号数比较，rs1 较小时跳转。经典陷阱是 0xFFFFFFFF：无符号看它是 42 亿多，有符号看它是 -1，所以 BLTU 认为它很大而 BLT 认为它最小。举例时要挑负数的位模式才看得出来。',
    related: ['bgeu', 'blt'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 控制转移指令（无符号比较分支）' },
    ],
  },
  {
    id: 'bgeu',
    term: 'BGEU 指令',
    en: 'Branch if Greater or Equal Unsigned',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['无符号不小于分支'],
    body:
      '条件分支：把 rs1 与 rs2 都当无符号数比较，rs1 不小于 rs2 时跳转，funct3 是 111。它和 BLTU 的关系，与 BGE 和 BLT 的关系一样，只有比较器是否按符号位解释不同。BGTU 这类助记符不在 RV32I 里，是交换操作数后用 BLTU 合成的伪指令。',
    related: ['bltu', 'bge'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 控制转移指令（BGTU 等由反转操作数合成）' },
    ],
  },
  {
    id: 'jal',
    term: 'JAL 指令',
    en: 'Jump And Link',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['直接跳转'],
    body:
      '唯一一条直接跳转指令：把下一条指令的地址 pc+4 写入 rd，同时跳到「当前地址加上符号扩展的 20 位偏移」处。偏移范围可达正负 1 MiB，比分支的 4 KiB 大得多。把 rd 写成 x0 时返回地址被丢弃，这时 jal 就是伪指令 j。',
    related: ['jalr', 'pc'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 控制转移指令（JAL 写 pc+4 到 rd）' },
    ],
  },
  {
    id: 'lui',
    term: 'LUI 指令',
    en: 'Load Upper Immediate',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['装高位立即数'],
    body:
      '把 20 位立即数放到结果的高 20 位、低 12 位补 0，写入 rd。它常与 ADDI 配对构造 32 位常数，这里有个必错的坑：若目标常数的第 11 位是 1，ADDI 的 12 位立即数会被符号扩展，LUI 的立即数就得先加 1，这一步由汇编器自动完成。',
    related: ['auipc', 'immediate'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（U 型：LUI 与 AUIPC）' },
    ],
  },
  {
    id: 'auipc',
    term: 'AUIPC 指令',
    en: 'Add Upper Immediate to PC',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    body:
      '把 20 位立即数放到高 20 位、低 12 位补 0，再加到这条指令自身的地址上，结果写入 rd。它是 RISC-V 做 PC 相对寻址的基石：与 ADDI 或 JALR 配对，就能在 32 位范围内访问任意 PC 相对地址。写 auipc rd, 0 等于把当前 PC 装进 rd。',
    related: ['lui', 'jalr'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（U 型：LUI 与 AUIPC）' },
    ],
  },
  {
    id: 'fence',
    term: 'FENCE 指令',
    en: 'Fence',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['内存屏障'],
    body:
      '内存屏障：约束这条指令前后的访存操作之间的可见顺序，防止它们被重排。funct3 为 000 是 FENCE，001 是 FENCE.I（指令屏障），其余是保留编码、属非法指令。单周期模型机不存在访存重排，本项目把它当合法指令译码通过，不实现顺序约束，反汇编里也一律显示为 fence。',
    related: ['data-memory', 'instruction-format'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 杂项指令（FENCE 与 FENCE.I）' },
      { label: '本仓库 backend/cpp/src/rv_control.hpp（FENCE：无害，顺序执行）' },
    ],
  },

  // ==========================================================================
  // 第五批：CSR 指令、控制信号、伪指令
  //
  // CSR 六条的核心是两条豁免规则，学生最容易背反：
  //   · 读不读，只看 rd —— 只有 CSRRW / CSRRWI 有「rd=x0 就不读」
  //   · 写不写，只看源操作数是否为空 —— 只有 CSRRS/CSRRC/CSRRSI/CSRRCI 有这条
  // 伪指令这一批里 la 与 li 要如实写明本项目与官方定义的差别，见各自正文。
  // ==========================================================================

  {
    id: 'control-signal',
    term: '控制信号',
    en: 'Control Signal',
    category: 'signal',
    scope: 'standard',
    level: 3,
    // 这些英文名只出现在正文里，不放进别名学生就搜不到
    aliases: [
      '控制线', 'RegWrite', 'ALUSrc', 'MemtoReg',
      // 不再另列 mem_to_reg / alu_src：归一化会抹平下划线，
      // 它们与 MemtoReg / ALUSrc 是同一个串
      // 「读使能」归 read-enable 词条，这里不重复占用
      'MemRead', 'MemWrite', 'ALUOp', 'ALU 操作码', '写回选择',
      'is_lui', 'is_auipc', 'is_jalr', 'branch || jump || is_jalr', 'jump || is_jalr',
    ],
    body:
      '[[decoder|译码器]]的输出：一组告诉各部件这一拍该做什么的开关信号，例如要不要写[[register-file|寄存器堆]]、[[alu|ALU]] 的第二个操作数取自哪里。本项目后端下发 11 个：RegWrite、ALUSrc、MemWrite、MemRead、MemtoReg、Branch、Jump、is_auipc、is_lui、is_jalr、ALUOp。界面上另有一批如 is_csr、illegal、csr_we 是前端为便于作画而派生的，真实硬件里属于译码器内部的组合逻辑。',
    related: ['decoder', 'alu'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 控制单元的设计' },
      { label: '本仓库 backend/cpp/src/rv_control.hpp（11 个控制信号字段）' },
    ],
  },
  {
    id: 'csrrw',
    term: 'CSRRW 指令',
    en: 'Atomic Read/Write CSR',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    body:
      '原子地读写 [[csr|CSR]]：读出旧值写入 rd，同时把 rs1 的值写进该 CSR。关键豁免是 rd 写成 x0 时它不读这个 CSR，连读可能带出的副作用也一并免掉。但写永远会发生——rs1 是 x0 就等于把该 CSR 清零。方向是先读后写，别和 CSRRS 记反。',
    related: ['csrrs', 'csrrc'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: 'Zicsr 扩展（CSR 指令的读写行为）' },
    ],
  },
  {
    id: 'csrrs',
    term: 'CSRRS 指令',
    en: 'Atomic Read and Set Bits in CSR',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['读并置位'],
    body:
      '读 [[csr|CSR]] 并置位：读出旧值写入 rd，同时把 rs1 当掩码，把 CSR 中对应位为 1 的位置 1。它的豁免方向与 CSRRW 正好相反：无论 rs1 和 rd 是什么，它总是读；只有 rs1 为 x0 时才完全不写。所以「读一个 CSR」惯用 csrrs rd, csr, x0。',
    related: ['csrrw', 'csrrc'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: 'Zicsr 扩展（CSRRS 总是读，rs1=x0 时不写）' },
    ],
  },
  {
    id: 'csrrc',
    term: 'CSRRC 指令',
    en: 'Atomic Read and Clear Bits in CSR',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['读并清位'],
    body:
      '读 [[csr|CSR]] 并清位：读出旧值写入 rd，同时把 rs1 当掩码，把 CSR 中对应位为 1 的清 0。与 CSRRS 完全对称，同样总是读、且只在 rs1 为 x0 时不写。有个容易忽略的区别：rs1 指向一个内容恰好为 0 的寄存器仍会写回原值并触发写的副作用，与直接写 x0 不是一回事。',
    related: ['csrrs', 'csrrci'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: 'Zicsr 扩展（CSRRC 与 rs1=x0 豁免）' },
    ],
  },
  {
    id: 'csrrwi',
    term: 'CSRRWI 指令',
    en: 'Atomic Read/Write CSR Immediate',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    body:
      'CSRRW 的立即数版：把 rs1 的位置换成 5 位无符号立即数，先零扩展到 32 位再使用。豁免规则与 CSRRW 相同——rd 写成 x0 时不读该 [[csr|CSR]]。立即数只能取 0 到 31，写负数或 32 会被本项目直接报错，不能像 ADDI 那样吃负数。',
    related: ['csrrw', 'csrrsi'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: 'Zicsr 扩展（立即数版 CSR 指令）' },
      { label: '本仓库 backend/python/asm.py（uimm 校验范围 0..31）' },
    ],
  },
  {
    id: 'csrrsi',
    term: 'CSRRSI 指令',
    en: 'Atomic Read and Set Bits in CSR Immediate',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    body:
      'CSRRS 的立即数版：立即数是置位掩码，取 0 到 31 的无符号数。控制写不写的是立即数本身是否为零，而不是 rd——立即数为 0 时这条指令退化成纯读，既不写 [[csr|CSR]]，也不会因为访问只读 CSR 而报非法指令。',
    related: ['csrrs', 'csrrci'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: 'Zicsr 扩展（uimm=0 时不写 CSR）' },
    ],
  },
  {
    id: 'csrrci',
    term: 'CSRRCI 指令',
    en: 'Atomic Read and Clear Bits in CSR Immediate',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    body:
      'CSRRC 的立即数版：立即数是清位掩码，取 0 到 31 的无符号数，同样在立即数为 0 时不写 [[csr|CSR]]。它与 CSRRWI 的区别在方向：CSRRWI 是整字覆盖写，CSRRCI 只清掉掩码为 1 的那些位，其余位保持不动。',
    related: ['csrrc', 'csrrwi'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: 'Zicsr 扩展（立即数版 CSR 指令）' },
    ],
  },
  {
    id: 'nop',
    term: 'nop 伪指令',
    en: 'No Operation',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['空操作'],
    body:
      '空操作：展开为 addi x0, x0, 0。它之所以什么都不做，不是因为有什么专门的硬件，而是 rd 是 x0 丢弃了写入、rs1 是 x0 恒读 0。它照样会把 [[pc|PC]] 推进到下一条。编码固定为 0x00000013。',
    related: ['pseudo-instruction', 'addi'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '标准伪指令表' },
      { label: '本仓库 backend/python/asm.py（expand 函数）' },
    ],
  },
  {
    id: 'mv',
    term: 'mv 伪指令',
    en: 'Move',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['传送'],
    body:
      '传送：展开为 addi rd, rs, 0，把 rs 的值复制到 rd。它不检查两个寄存器是不是 x0，所以 mv x0, x1 也能通过汇编，只是写入被 x0 丢弃。本项目只实现 9 条伪指令，官方表里的 not、neg 那一批没有实现。',
    related: ['pseudo-instruction', 'addi'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '标准伪指令表' },
      { label: '本仓库 backend/python/asm.py（expand 函数）' },
    ],
  },
  {
    id: 'ret',
    term: 'ret 伪指令',
    en: 'Return from Subroutine',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['返回'],
    body:
      '从子程序返回：展开为 jalr x0, 0(x1)，跳到 ra（即 x1）里存的地址。注意它的目标寄存器是 x0，返回地址被丢弃，所以 ret 不像 call 那样会覆盖 ra——连着两次 ret 会原地死循环。编码为 0x00008067。',
    related: ['pseudo-instruction', 'jalr'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '标准伪指令表' },
      { label: '本仓库 backend/python/asm.py（expand 函数）' },
    ],
  },
  {
    id: 'j',
    term: 'j 伪指令',
    en: 'Jump',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['无条件跳转'],
    body:
      '无条件跳转：展开为 jal x0, label，也就是把返回地址写进 x0 丢掉。它走 JAL 的 J 型编码，所以跳转范围是正负 1 MiB，比条件分支的 4 KiB 大得多。跳转目标始终是 PC 相对的。',
    related: ['pseudo-instruction', 'jal'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '标准伪指令表' },
      { label: '本仓库 backend/python/asm.py（expand 函数）' },
    ],
  },
  {
    id: 'beqz',
    term: 'beqz 伪指令',
    en: 'Branch if Equal to Zero',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['为零则跳转'],
    body:
      '等于零则跳转：展开为 beq rs, x0, label。因为 x0 恒为 0，与它比较就等于判断 rs 是否为零。它由一条真指令展开而来，不额外占字。本项目只实现 beqz 与 bnez 两个，官方表里的 blez、bgez、bltz、bgtz 都没有实现。',
    related: ['pseudo-instruction', 'beq'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '标准伪指令表' },
      { label: '本仓库 backend/python/asm.py（expand 函数）' },
    ],
  },
  {
    id: 'bnez',
    term: 'bnez 伪指令',
    en: 'Branch if Not Equal to Zero',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['非零则跳转'],
    body:
      '不等于零则跳转：展开为 bne rs, x0, label，与 beqz 是同一条展开规则的两个方向，都靠 x0 恒为 0 这一点。偏移范围与普通分支一样是 -4096 到 +4094 字节，本项目还会检查偏移是否落在偶数字节上。',
    related: ['pseudo-instruction', 'bne'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '标准伪指令表' },
      { label: '本仓库 backend/python/asm.py（expand 函数）' },
    ],
  },
  {
    id: 'li',
    term: 'li 伪指令',
    en: 'Load Immediate',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['装立即数'],
    body:
      '把一个常数装进寄存器。本项目把展开方式写死了：常数在 -2048 到 2047 之间发一条 addi，其余一律发 lui 加 addi 两条，即使低 12 位恰好为 0 也照发两条。官方手册在这一条写的是 Myriad sequences，即不规定具体展开，所以占几个字要按本项目口径算。超出 32 位的常数会被静默截断。',
    related: ['pseudo-instruction', 'lui'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '标准伪指令表（li：Myriad sequences）' },
      { label: '本仓库 backend/python/asm.py（expand 函数与 _hi_lo 辅助函数）' },
    ],
  },
  {
    id: 'la',
    term: 'la 伪指令',
    en: 'Load Address',
    category: 'instruction',
    scope: 'project',
    level: 4,
    aliases: ['装地址'],
    body:
      '把符号的地址装进寄存器。这里有一处本项目与官方定义不同，必须讲明白：官方的 la 是 PC 相对的，展开成 auipc 加 addi；本项目展开成 lui 加 addi，装的是「加载基址 0x80000000 加上标签偏移」的绝对地址。在本项目固定的加载基址下结果正确，但不是同一条展开，也没有链接期重定位的概念。',
    related: ['pseudo-instruction', 'auipc'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '标准伪指令表（la 为 PC 相对）' },
      { label: '本仓库 backend/python/asm.py（la 展开为 lui + addi，基址 BASE）' },
    ],
  },
  {
    id: 'call',
    term: 'call 伪指令',
    en: 'Call Far-away Subroutine',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['远调用'],
    body:
      '远调用：展开成 auipc 加 jalr 两条，返回地址写进 ra。要注意第二条 jalr 的基址必须是第一条 auipc 的地址，而不是它自己的地址，否则落点会整体偏 4 字节。它是本项目里唯一一条两条展开结果之间存在地址依赖的伪指令，可跳转范围约正负 2 GiB。',
    related: ['pseudo-instruction', 'jalr'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '标准伪指令表' },
      { label: '本仓库 backend/python/asm.py（call 的 jalr 基址取 auipc 的 pc）' },
    ],
  },

  // ==========================================================================
  // 第六批：通用基础概念
  //
  // 这一批的词条大多"更浅"（level 2/3），但它们想引用的指令是 level 4。
  // 层级规则不许浅词条链到深词条，所以跨层级的引用一律放进 related——
  // related 只校验存在性、不校验层级，正好承担"这条通往更深的词"这个角色。
  // ==========================================================================

  {
    id: 'isa',
    term: '指令集',
    en: 'ISA · Instruction Set Architecture',
    category: 'isa',
    scope: 'standard',
    level: 2,
    aliases: ['指令集体系结构'],
    body:
      '一台处理器能执行的全部[[instruction|指令]]，加上寄存器、地址空间、寻址方式、数据类型等软件看得见的约定，合起来叫指令集体系结构。它是硬件与软件的接口：同一份[[riscv|RISC-V]] 程序能跑在不同厂商的芯片上，就是因为接口不能变、实现可以随便换。指令集只规定做什么，不规定电路怎么造。',
    related: ['extension', 'riscv'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 1 章 计算机抽象与技术' },
    ],
  },
  {
    id: 'extension',
    term: '指令集扩展',
    en: 'ISA Extension',
    category: 'isa',
    scope: 'standard',
    level: 2,
    aliases: ['扩展', 'RV32IMAC'],
    body:
      '[[riscv|RISC-V]] 把[[isa|指令集]]拆成一个个可选扩展：基础集是 I，其余各用一个字母表示，例如 M 乘除、A 原子、F 与 D 浮点、C 压缩。把字母串起来就是某块芯片支持的集合，像 RV32IMAC。本项目实现 RV32I 基础整数集，不含 M、A、F、D、C，但额外实现了 Zicsr 扩展的六条 CSR 指令。',
    related: ['isa', 'riscv'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 1 章 RISC-V 指令集体系结构命名；Zicsr 见第 2 章 CSR 指令' },
      { label: '本仓库 backend/cpp/src/rv_disasm.cpp（csrrw / csrrs / csrrc / csrrwi / csrrsi / csrrci 六条译码）' },
    ],
  },
  {
    id: 'cpi',
    term: 'CPI',
    en: 'Cycles Per Instruction',
    category: 'concept',
    scope: 'standard',
    level: 2,
    aliases: ['每条指令周期数'],
    body:
      '每条指令平均消耗多少个[[clock-cycle|时钟周期]]，等于执行程序的总周期数除以总指令数。[[single-cycle|单周期]]模型机恒为 1；[[pipeline|流水线]]理想情况下接近 1，但遇到停顿会变高。程序的执行时间大致等于指令条数乘 CPI 再乘时钟周期。',
    related: ['clock-cycle', 'single-cycle'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 1 章 性能' },
    ],
  },
  {
    id: 'clock-frequency',
    term: '时钟频率',
    en: 'Clock Frequency',
    category: 'timing',
    scope: 'standard',
    level: 2,
    aliases: ['主频', 'Hz'],
    body:
      '[[clock-signal|时钟信号]]每秒完成的周期数，单位赫兹，与[[clock-cycle|时钟周期]]互为倒数。一块电路能跑多高的频率，取决于它最慢那条通路上要经过多少级门电路，也就是关键路径有多长。所以提频常靠增加流水级数，把长通路切短。',
    related: ['clock-cycle', 'critical-path'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 时钟频率与流水线' },
    ],
  },
  {
    id: 'byte',
    term: '字节',
    en: 'Byte',
    category: 'memory',
    scope: 'standard',
    level: 3,
    aliases: ['B'],
    body:
      '8 位二进制作为一个单位。它是 [[riscv|RISC-V]] 地址空间的最小可寻址单位——每个地址对应一个字节，相邻地址的数值相差 1。在 32 位机器上一个[[word|字]]占 4 个字节、一个[[halfword|半字]]占 2 个。存储指令 SB 写的正是一个字节。',
    related: ['halfword', 'word'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 加载与存储指令（按字节寻址）' },
    ],
  },
  {
    id: 'halfword',
    term: '半字',
    en: 'Halfword',
    category: 'memory',
    scope: 'standard',
    level: 3,
    aliases: ['H'],
    body:
      '16 位，也就是 2 个[[byte|字节]]。它是 [[riscv|RISC-V]] 里介于字节与[[word|字]]之间的宽度，对应 LH、LHU、SH 三条指令。半字在内存里按小端序存放：低地址那个字节是它的低 8 位，高地址那个是高 8 位。',
    related: ['byte', 'word'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 加载与存储指令（半字）' },
    ],
  },
  {
    id: 'word',
    term: '字',
    en: 'Word',
    category: 'memory',
    scope: 'standard',
    level: 3,
    aliases: ['字长', '双字'],
    body:
      '32 位，也就是 4 个[[byte|字节]]，同时是 RV32 里[[register|寄存器]]的宽度。RISC-V 的「字」固定指 32 位，与具体机器的寄存器宽度无关——所以 RV64 上字仍然是 32 位，64 位那个叫双字，这也是 LD、LWU 等指令属于 RV64I 的原因。',
    related: ['byte', 'halfword'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 1 章 字长 XLEN 与术语约定' },
    ],
  },
  {
    id: 'little-endian',
    term: '小端序',
    en: 'Little-endian',
    category: 'memory',
    scope: 'standard',
    level: 3,
    aliases: ['小端', '端序'],
    body:
      '多字节数据在内存里存放时，把最低有效字节放在最低地址，就叫小端序。[[riscv|RISC-V]] 只允许小端序。例：把 0x12345678 存到地址 A，则 A 处是 0x78、A+1 是 0x56、A+2 是 0x34、A+3 是 0x12。反过来把高字节放低地址的叫大端序。',
    related: ['byte', 'data-memory'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 加载与存储指令（小端序）' },
    ],
  },
  {
    id: 'twos-complement',
    term: '二进制补码',
    en: "Two's Complement",
    category: 'concept',
    scope: 'standard',
    level: 2,
    aliases: ['补码', '有符号数表示'],
    body:
      '用最高位当符号位、并把负数表示成「各位取反再加一」的编码方式。同一串位模式在两种解释下数值不同：0xFFFFFFFF 按有符号读是 -1，按无符号读是 4294967295。[[riscv|RISC-V]] 的加减法只有一套电路，靠不同的比较指令来决定按哪一种方式解释。',
    related: ['slt', 'sltu'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 2 章 有符号数与无符号数' },
    ],
  },
  {
    id: 'overflow',
    term: '溢出',
    en: 'Overflow',
    category: 'concept',
    scope: 'standard',
    level: 3,
    aliases: ['算术溢出'],
    body:
      '运算结果超出该位宽能表示的范围。[[riscv|RISC-V]] 的加减法对溢出是静默忽略的：只保留低 32 位，也不设置任何标志位。所以要判断是否溢出必须自己算，常用办法是比较两个操作数与结果的符号是否自相矛盾——正数加正数得到负数，就是溢出了。',
    related: ['twos-complement', 'add'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（忽略算术溢出）' },
    ],
  },
  {
    id: 'propagation-delay',
    term: '传播延迟',
    en: 'Propagation Delay',
    category: 'concept',
    scope: 'standard',
    level: 3,
    aliases: ['门延迟'],
    body:
      '[[combinational-logic|组合逻辑]]的输入变化之后，输出要经过一段时间才稳定到正确值，这段时间就是传播延迟。它意味着组合逻辑并非瞬时响应，而且不同路径的延迟还不一样——快慢不齐就可能在中途冒出一段错误的输出，也就是毛刺。',
    related: ['critical-path', 'combinational-logic'],
    sources: [
      { label: '《数字设计与计算机体系结构》（RISC-V 版）', locator: '第 2 章 组合逻辑设计（时序）' },
    ],
  },
  {
    id: 'critical-path',
    term: '关键路径',
    en: 'Critical Path',
    category: 'concept',
    scope: 'standard',
    level: 3,
    aliases: ['最长路径', '关键通路'],
    body:
      '一段组合逻辑里延迟最长的那条从输入到输出的通路。它决定电路能达到的最快[[clock-frequency|时钟频率]]，因为[[clock-cycle|时钟周期]]必须不小于它再加上触发器要求的建立时间。优化电路时，缩短关键路径往往就是想办法把这条最长通路切断或改短。',
    related: ['propagation-delay', 'clock-frequency'],
    sources: [
      { label: '《数字设计与计算机体系结构》（RISC-V 版）', locator: '第 3 章 时序约束与关键路径' },
    ],
  },
  {
    id: 'flip-flop',
    term: '触发器',
    en: 'Flip-flop',
    category: 'unit',
    scope: 'standard',
    level: 3,
    aliases: ['D 触发器', '建立时间', '保持时间', '亚稳态'],
    body:
      '能存住 1 位、并且只在[[clock-signal|时钟信号]]边沿才更新内容的存储元件，是[[sequential-logic|时序逻辑]]的基本单元。一个 32 位[[register|寄存器]]由 32 个触发器并排构成。它只在边沿采样，因此采样前后输入必须分别稳定足够久，这就是建立时间与保持时间；不满足时触发器可能进入亚稳态。',
    related: ['sequential-logic', 'register'],
    sources: [
      { label: '《数字设计与计算机体系结构》（RISC-V 版）', locator: '第 3 章 时序逻辑设计（触发器与建立保持时间）' },
    ],
  },
  {
    id: 'alignment',
    term: '对齐',
    en: 'Alignment',
    category: 'memory',
    scope: 'standard',
    level: 4,
    aliases: ['自然对齐', '非对齐访问'],
    body:
      '访存地址能被访问宽度整除叫自然对齐，例如字访问的地址是 4 的倍数。[[riscv|RISC-V]] 保证自然对齐的访存不抛异常、而且是原子的；非对齐访问的行为由运行环境自行决定，可能失败也可能用软件模拟。本项目不做任何对齐检查：非对齐访存静默成功，也不产生指令地址不对齐异常。',
    related: ['data-memory', 'jalr'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 加载与存储指令（自然对齐与非对齐行为）' },
      { label: '本仓库 backend/cpp/src/rv_memory.hpp（无对齐检查，逐字节小端读写）' },
    ],
  },
  {
    id: 'abi-name',
    term: '寄存器 ABI 名',
    en: 'ABI Register Names',
    category: 'register',
    scope: 'standard',
    level: 4,
    // ra / sp / a0 已各自独立成条，这里不再重复占用它们的别名
    aliases: [
      'ABI 名',
      'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9', 'x10', 'x11', 'x12', 'x13', 'x14', 'x15', 'x16', 'x17', 'x18', 'x19', 'x20', 'x21', 'x22', 'x23', 'x24', 'x25', 'x26', 'x27', 'x28', 'x29', 'x30', 'x31', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 't1', 't2', 't3', 't4', 't5', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 'gp', 'tp',
    ],
    body:
      '同一批[[register|寄存器]]有两套名字：机器码里只有编号 x0 到 x31，汇编里还能用按用途起的别名，如 ra（返回地址，x1）、sp（栈指针，x2）、a0 到 a7（传参）、t0 到 t6（临时）、s0 到 s11（被调用者保存）。这些别名由[[assembler|汇编器]]翻译成编号，硬件根本不认识它们。',
    related: ['register', 'register-file'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '寄存器别名与调用约定' },
    ],
  },
  {
    id: 'privilege-level',
    term: '特权级',
    en: 'Privilege Level',
    category: 'csr',
    scope: 'standard',
    level: 4,
    aliases: ['特权模式', '权限级别'],
    body:
      '处理器运行代码时所在的权限档位。[[riscv|RISC-V]] 定义了机器、监管、用户三级，权限由高到低。级别决定了能访问哪些 [[csr|CSR]] 与哪些内存区域，切换只能靠[[trap|trap]] 与返回指令这少数几条指令完成。本模拟器只实现最高的一级，也就是[[machine-mode|机器模式]]。',
    related: ['machine-mode', 'csr'],
    sources: [
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '第 1 章 特权级' },
    ],
  },

  // ==========================================================================
  // 第七批：来自「前端可见术语扫描」的补漏
  //
  // 扫描对比的是界面真实渲染出来的字符串（datapathLayout.json 的 label/sub/group、
  // 面板标题、状态文本、示例源码），不含只给开发者看的 tip 字段。
  //
  // 这一批里两条必须点名，否则学生一定误解：
  //   · stage——单周期机器里那五个「阶段」是画图用的切分，不是流水级
  //   · waveform——它和本项目自创的「波次」不是一回事，一个跨周期一个在周期内
  // ==========================================================================

  {
    id: 'abi',
    term: '应用程序二进制接口',
    en: 'ABI · Application Binary Interface',
    category: 'isa',
    scope: 'standard',
    level: 3,
    aliases: ['ABI', '二进制接口', '调用约定', 'calling convention'],
    body:
      '规定机器码层面调用约定的那一套规则：参数放哪几个[[register|寄存器]]、返回值放哪、栈怎么用、哪些寄存器由谁负责保存。[[isa|指令集]]管「有哪些指令」，ABI 管「这些指令怎么配合起来组成一次函数调用」。编译器与链接器都按同一份 ABI 办事，不同工具链产出的目标文件才能链到一起。',
    related: ['abi-name', 'isa', 'riscv'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '调用约定' },
    ],
  },
  {
    id: 'caller-saved',
    term: '调用者保存寄存器',
    en: 'Caller-saved Registers',
    category: 'register',
    scope: 'standard',
    level: 4,
    aliases: ['临时寄存器', '参数寄存器', 'caller-saved', 't0', 't6', 'a7'],
    body:
      '调用约定里的一类[[register|寄存器]]：调用子程序之前，调用者若还想留住它们的值，必须自己先存到栈上——因为被调用者可以随意取用这批寄存器，没有替调用者保留的义务。RISC-V 里是临时寄存器 t0 到 t6 与参数寄存器 a0 到 a7，其中 a0、a1 另外还充当返回值寄存器。',
    related: ['callee-saved', 'stack-pointer', 'abi-name'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '寄存器别名与调用约定' },
      { label: '本仓库 frontend/src/utils/formatters.ts（面板寄存器分组名）' },
    ],
  },
  {
    id: 'callee-saved',
    term: '被调用者保存寄存器',
    en: 'Callee-saved Registers',
    category: 'register',
    scope: 'standard',
    level: 4,
    aliases: ['保存寄存器', 'callee-saved', 's0', 's11'],
    body:
      '调用约定里的一类[[register|寄存器]]：被调用者若要用它们，必须先把原值存到栈上、返回前再恢复。因为调用者默认这些值在整个调用前后不变，被调用者擅自改动就会破坏调用者的数据。RISC-V 里是保存寄存器 s0 到 s11，其中 s0 也常被当作帧指针 fp 使用。',
    related: ['caller-saved', 'stack-pointer', 'abi-name'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '寄存器别名与调用约定' },
      { label: '本仓库 frontend/src/utils/formatters.ts（面板寄存器分组名）' },
    ],
  },
  {
    id: 'stack-pointer',
    term: '栈指针',
    en: 'SP · Stack Pointer',
    category: 'register',
    scope: 'standard',
    level: 4,
    aliases: ['sp', '栈', '栈顶'],
    body:
      '[[register|寄存器]] x2 的别名，指向栈顶。栈是内存里一段后进先出的区域：压栈时先把 sp 减小再存，出栈时先取再增大。子程序靠它保存返回地址与原寄存器值，好让层层嵌套的调用互不干扰。本模拟器对栈没有任何特殊处理，它就是内存里普普通通的一段。',
    related: ['abi-name', 'return-address', 'subroutine'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '寄存器别名与调用约定' },
    ],
  },
  {
    id: 'return-address',
    term: '返回地址',
    en: 'RA · Return Address',
    category: 'register',
    scope: 'standard',
    level: 4,
    aliases: ['ra', '返回地址寄存器'],
    body:
      '[[register|寄存器]] x1 的别名，存的是「子程序执行完该回到哪里」。它由跳转指令自己写进去：[[jal|JAL]] 与伪指令 call 都会把下一条指令的地址一并存进目标寄存器，按惯例就是 x1。子程序返回时用伪指令 ret 跳回去。如果子程序还要再调用别人，就得先把 ra 存到栈上。',
    related: ['stack-pointer', 'subroutine', 'jal'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '寄存器别名与调用约定' },
    ],
  },
  {
    id: 'rd',
    term: 'rd',
    en: 'rd · Destination Register',
    category: 'encoding',
    scope: 'standard',
    level: 3,
    aliases: ['目标寄存器字段', 'rd 字段'],
    body:
      '[[instruction-format|指令格式]]里的一个 5 位字段，指明这条指令把结果写回哪个[[register|寄存器]]。5 位正好覆盖 x0 到 x31。不是所有指令都用它：存储指令与分支指令没有结果，这 5 位就挪去放立即数或别的字段了。写成 x0 时表示结果被丢弃。',
    related: ['rs1', 'rs2', 'instruction-format'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 指令格式' },
      { label: '本仓库 frontend/src/components/panels/InstructionPanel.vue（rd 单独一格显示）' },
    ],
  },
  {
    id: 'rs1',
    term: 'rs1',
    en: 'rs1 · Source Register 1',
    category: 'encoding',
    scope: 'standard',
    level: 3,
    aliases: ['第一源寄存器', 'rs1 字段'],
    body:
      '[[instruction-format|指令格式]]里的一个 5 位字段，指明第一个源[[register|寄存器]]是哪一个。绝大多数指令至少读一个源操作数，所以这个字段几乎无处不在。少数指令把它闲置；而 JAL 用的 J 型格式里根本没有 rs1 字段，位 19:15 本来就是立即数的一部分。',
    related: ['rd', 'rs2', 'instruction-format'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 指令格式' },
      { label: '本仓库 frontend/src/components/panels/InstructionPanel.vue（rs1 单独一格显示）' },
    ],
  },
  {
    id: 'rs2',
    term: 'rs2',
    en: 'rs2 · Source Register 2',
    category: 'encoding',
    scope: 'standard',
    level: 3,
    aliases: ['第二源寄存器', 'rs2 字段'],
    body:
      '[[instruction-format|指令格式]]里的一个 5 位字段，指明第二个源[[register|寄存器]]。只有需要两个源操作数的指令才有它，比如整数加减、移位、存储以及分支比较。移位指令还会只取它的低 5 位当移位量，高位的取值对结果没有任何影响。',
    related: ['rd', 'rs1', 'instruction-format'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 指令格式与移位指令' },
      { label: '本仓库 frontend/src/components/panels/InstructionPanel.vue（rs2 单独一格显示）' },
    ],
  },
  {
    id: 'funct3',
    term: 'funct3',
    en: 'funct3 · Function Code',
    category: 'encoding',
    scope: 'standard',
    level: 3,
    aliases: ['功能码', 'funct3 字段', 'f3[2]', 'f3[0]', 'f3'],
    body:
      '[[opcode|操作码]]之外的第二级功能编码，占 3 位，用来在同一大类指令里再区分具体是哪一条。例如 addi / xori / ori / andi 共用操作码 0010011，全靠 funct3 区分。3 位有时还不够：加减法共用一个操作码、一个 funct3，得再看 funct7。分支指令的 funct3 另有讲究：三位分别表示是否属于小于类、是否按无符号比较、条件是否取反。',
    related: ['opcode', 'instruction-format', 'decoder'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 指令格式' },
      { label: '本仓库 frontend/src/data/datapathLayout.json（图上以 f3[2] / f3[0] 作线名）' },
      { label: '本仓库 backend/cpp/src/rv_control.hpp（ADD / SUB 同为 funct3=000，仅靠 funct7 区分）' },
    ],
  },
  {
    id: 'stage',
    term: '阶段',
    en: 'Stage · IF / ID / EX / MEM / WB',
    category: 'concept',
    scope: 'project',
    level: 2,
    // 五个阶段的名称已各自独立成条，这里不再占用它们
    aliases: ['IF', 'ID', 'EX', 'MEM', 'WB', '流水级'],
    body:
      '把一条指令从头到尾分成五个环节：取指、译码、执行、访存、写回。图上用 IF、ID、EX、MEM、WB 给部件分组，面板也按这五项分卡片。这里必须讲清楚：本模型机是[[single-cycle|单周期]]的，这五个环节在同一个[[clock-cycle|时钟周期]]里依次走完，它们只是画图与讲解时的切分，并不是[[pipeline|流水线]]里的流水级。',
    related: ['single-cycle', 'pipeline', 'instruction-cycle'],
    sources: [
      { label: '本仓库 frontend/src/components/panels/InstructionPanel.vue（五张卡片的标题）' },
      { label: '本仓库 frontend/src/components/datapath/DatapathView.vue（悬停显示的「分组」）' },
    ],
  },
  {
    id: 'waveform',
    term: '波形图',
    en: 'Waveform',
    category: 'concept',
    scope: 'standard',
    // 与「波次」同层：这一条正文的主旨正是把两者区分开，
    // 链到同层的 wave 会触发人工复核提醒，这里正是想让人看一眼
    level: 3,
    aliases: ['波形', '时序图', 'waveform'],
    body:
      '把每个[[clock-cycle|时钟周期]]里各条信号的取值按时间横排画出来的图：纵轴是信号、横轴是周期，取值用高低电平表示。它是观察时序变化最直观的手段。注意它和本模拟器自创的[[wave|波次]]不是一回事——波形图记录跨周期的历史，波次是一次单步内部传播延迟的切片。',
    related: ['wave', 'clock-cycle', 'datapath'],
    sources: [
      { label: '本仓库 frontend/src/components/panels/WaveformPanel.vue（波形面板）' },
      { label: '本仓库 frontend/src/data/datapathWave.ts（波次切片的定义）' },
    ],
  },
  {
    id: 'asynchronous',
    term: '异步',
    en: 'Asynchronous',
    category: 'unit',
    scope: 'standard',
    level: 3,
    aliases: ['异步存储器', 'asynchronous'],
    body:
      '不依赖[[clock-signal|时钟信号]]、输入一变输出就跟着变的工作方式。图上两块存储器标着「异步」，意思是读操作在同一个[[clock-cycle|时钟周期]]里就能出数据，不必等到下一个边沿。真实芯片的存储器通常做不到这么快，往往需要额外的等待周期。',
    related: ['instruction-memory', 'data-memory', 'sequential-logic'],
    sources: [
      { label: '《数字设计与计算机体系结构》（RISC-V 版）', locator: '第 5 章 存储器阵列（异步与同步存储）' },
      { label: '本仓库 frontend/src/data/datapathLayout.json（两块存储器的 sub 标为「异步」）' },
    ],
  },
  {
    id: 'write-enable',
    term: '写使能',
    en: 'Write Enable',
    category: 'signal',
    scope: 'standard',
    level: 3,
    aliases: ['写使能', '写允许', 'reg_wen', 'WE'],
    body:
      '一种控制信号：只有它有效时，目标部件才把输入的数据写进去，否则内容保持原样。[[register-file|寄存器堆]]与数据存储器都带写使能，因为读操作、以及那些根本不访存的指令，都不该改动它们。图上的 reg_wen 就是寄存器堆的写使能端口。',
    related: ['control-signal', 'register-file', 'clock-signal'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 寄存器堆与写使能' },
      { label: '本仓库 frontend/src/utils/formatters.ts（「寄存器写使能」）' },
    ],
  },
  {
    id: 'alu-flags',
    term: '标志位',
    en: 'ALU Flags · ZF / LT',
    category: 'signal',
    scope: 'standard',
    level: 3,
    aliases: ['ZF', 'LT', 'ALU 标志', 'alu_zf', 'alu_lt', '零标志', '小于标志'],
    body:
      '[[alu|ALU]]除了算出结果，还顺带给出几个关于结果状态的小信号：ZF 表示结果是否为零，LT 表示第一个操作数是否小于第二个。分支指令不看具体的运算结果，只看这些标志位来判定要不要跳转。这也是为什么 ALU 要把它们单独引出一路交给分支判据。',
    related: ['branch-taken', 'alu', 'control-signal'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 ALU 与分支判据' },
      { label: '本仓库 frontend/src/data/datapathLayout.json（ALU 的 ZF / LT 端口）' },
    ],
  },
  {
    id: 'port',
    term: '端口',
    en: 'Port',
    category: 'unit',
    scope: 'standard',
    level: 3,
    aliases: [
      '端口名', 'port', '接口',
      'src1_raddr', 'src2_raddr', 'src1_rdata', 'src2_rdata',
      'reg_waddr', 'reg_wdata',
    ],
    body:
      '部件框边缘那些带名字的小接口，信号从这些地方进、也从这些地方出。图上如 src1_raddr、reg_wdata 都是端口名：前者是寄存器堆的第一个读地址输入，后者是写数据输入。端口名是电路的接口约定，本身不消耗时间，只标明这根线接在部件的哪个位置。',
    related: ['net', 'datapath', 'mux'],
    sources: [
      { label: '本仓库 frontend/src/data/datapathScene.ts（端口名逐条渲染）' },
      { label: '本仓库 frontend/src/data/datapathLayout.json（src1_raddr / reg_wdata 等端口）' },
    ],
  },
  {
    id: 'net',
    term: '网络',
    en: 'Net · Net Label',
    category: 'unit',
    scope: 'standard',
    level: 3,
    aliases: ['网络标签', 'net', '导线'],
    body:
      '一组连在一起的导线。名字相同的标签在逻辑上属于同一根线，即使图上没有画线把它们连起来。把鼠标停在导线上时显示的「网络 xxx」就是它的名字。网络名通常与信号名一致，但一个网络可以分出很多支路，同时驱动好几个部件的输入。',
    related: ['port', 'datapath', 'control-signal'],
    sources: [
      { label: '本仓库 frontend/src/components/datapath/DatapathView.vue（悬停标题「网络 xxx」）' },
      { label: '本仓库 frontend/src/data/datapathScene.ts（网络标签渲染）' },
    ],
  },
  {
    id: 'breakpoint',
    term: '断点',
    en: 'Breakpoint',
    category: 'concept',
    scope: 'standard',
    level: 2,
    aliases: ['断点命中', 'breakpoint'],
    body:
      '让程序执行到某一处之前先停下来的标记。本模拟器可以在指令列表左侧点出断点，运行到那一条时自动暂停，方便一条条对照寄存器和信号的变化。断点纯粹是仿真器的调试功能，CPU 硬件里并没有这样一个部件。',
    related: ['halt', 'instruction', 'single-cycle'],
    sources: [
      { label: '本仓库 frontend/src/stores/simulator.ts（「断点命中」状态）' },
      { label: '本仓库 frontend/src/components/editor/InstructionList.vue（断点列）' },
    ],
  },
  {
    id: 'halt',
    term: '停机',
    en: 'Halt',
    category: 'concept',
    scope: 'standard',
    level: 2,
    aliases: ['程序停机', '停机状态'],
    body:
      '处理器不再继续取指的状态。本模拟器没有专门的停机指令：跑到程序末尾会取到全 0 的字、被判为非法指令触发陷阱，而 mtvec 为 0 时无处可跳，于是停机并在状态栏写明原因；程序未加载同样报停机。真机上并没有一条统一的「停机」指令，通常表现为执行一段死循环，或者由运行环境收回控制权。',
    related: ['ebreak', 'cpu', 'pc'],
    sources: [
      { label: '本仓库 frontend/src/stores/simulator.ts（「程序停机」状态）' },
      { label: '本仓库 frontend/src/components/layout/AppFooter.vue（状态栏）' },
    ],
  },
  {
    id: 'illegal-instruction',
    term: '非法指令',
    en: 'Illegal Instruction',
    category: 'trap',
    scope: 'standard',
    level: 4,
    aliases: ['非法指令异常', 'invalid'],
    body:
      '处理器遇到了没法译码的二进制编码——既不属于任何合法指令，也不属于任何已实现的扩展。[[riscv|RISC-V]] 规定这时必须触发[[exception|异常]]，把 [[mcause|mcause]] 置为 2，并把那条机器码本身写进 mtval 供排查。常见成因有：用了未实现的指令、[[csr|CSR]] 地址不存在、或指令在错误的特权级下执行。',
    related: ['decoder', 'trap', 'exception'],
    sources: [
      { label: 'RISC-V 特权架构手册（The RISC-V Instruction Set Manual, Volume II）', locator: '机器级陷阱原因（非法指令，原因码 2）' },
      { label: '本仓库 backend/cpp/src/rv_core.cpp（INVALID 一律按非法指令异常处理）' },
    ],
  },
  {
    id: 'branch',
    term: '分支',
    en: 'Branch',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['条件跳转', '分支指令'],
    body:
      '一类有条件改变执行顺序的[[instruction|指令]]：条件成立就跳到别处，不成立就继续往下走。RISC-V 的分支只有 6 条，两两成对——相等与不等、有符号小于与不小于、无符号小于与不小于，靠组合覆盖其余的比较。它们都不写[[register|寄存器]]，只改[[pc|程序计数器]]。',
    related: ['branch-taken', 'beq', 'jal'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 条件分支指令' },
      { label: '本仓库 frontend/src/components/panels/InstructionPanel.vue（「分支 / 跳转」卡片）' },
    ],
  },
  {
    id: 'jump',
    term: '跳转',
    en: 'Jump',
    category: 'instruction',
    scope: 'standard',
    level: 4,
    aliases: ['跳转指令'],
    body:
      '无条件改变执行顺序的指令。RISC-V 里只有两条：[[jal|JAL]] 把下一条指令的地址存进[[register|寄存器]]，用于调用子程序；[[jalr|JALR]] 的目标地址取自寄存器，用于子程序返回与间接跳转。两者都改写[[pc|程序计数器]]。伪指令 j 与 call 分别就是这两条的简化写法。',
    related: ['jal', 'jalr', 'pc'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 无条件跳转指令' },
      { label: '本仓库 frontend/src/components/panels/InstructionPanel.vue（「分支 / 跳转」卡片）' },
    ],
  },
  {
    id: 'label',
    term: '标号',
    en: 'Label',
    category: 'isa',
    scope: 'standard',
    level: 3,
    aliases: ['标签', '标号名', 'label'],
    body:
      '汇编源码里给某条指令起的名字，写成「名字:」的形式，例如 loop:。它的作用是让跳转与加载指令能按名字引用那个位置，[[assembler|汇编器]]在汇编时把它换算成真实地址。标号本身不产生任何机器码，也不占内存。',
    related: ['pseudo-instruction', 'la', 'pc'],
    sources: [
      { label: '本仓库 frontend/src/utils/riscvLang.ts（标号的识别规则）' },
      { label: '本仓库 frontend/src/data/examples.ts（示例源码里的 loop: 与 done:）' },
    ],
  },
  {
    id: 'subroutine',
    term: '子程序',
    en: 'Subroutine',
    category: 'concept',
    scope: 'standard',
    level: 4,
    aliases: ['函数', '子例程', 'routine', '函数调用', '递归', 'recursive'],
    body:
      '可以被反复调用、执行完还能回到原处继续的一段代码。它靠三样东西配合：跳转指令把返回地址存进[[register|寄存器]]，栈指针为每一层调用腾出保存空间，返回指令最后跳回原处。函数直接或间接调用自己就叫递归，靠栈为每层调用各留一份局部数据；正是这种嵌套调用能力，让程序能拆成一块块独立编写。',
    related: ['return-address', 'call', 'ret', 'stack-pointer'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 2 章 过程调用与栈' },
      { label: '本仓库 frontend/src/data/examples.ts（示例源码中的子程序调用）' },
    ],
  },
  {
    id: 'base-address',
    term: '基址',
    en: 'Base Address',
    category: 'memory',
    scope: 'standard',
    level: 3,
    aliases: ['基地址', '加载基址'],
    body:
      '一段连续内存的起始地址。访存指令的地址由两部分相加得到：基址来自某个[[register|寄存器]]，偏移则是一个[[immediate|立即数]]。本模拟器的加载基址固定为 0x80000000，是项目自己设定的、不是规范的要求；内存面板顶部那个框是内存查看的起始地址，改它并不改变加载基址。',
    related: ['memory-map', 'data-memory', 'la'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 加载与存储指令（基址加偏移寻址）' },
      { label: '本仓库 frontend/src/components/memory/MemoryView.vue（「地址」框只喂给 fetchMemory，是查看起点）' },
    ],
  },

  // ==========================================================================
  // 第八批：阶段明细、其余编码字段、调用约定补遗、背景概念
  //
  // 五个阶段（取指/译码/执行/访存/写回）从 stage 的别名提升为独立词条：
  // 它们是界面上最醒目的一组标签（五张卡片标题 + 部件分组），
  // 每条都有各自要说清的事，挤在一条 150 字里反而都讲不透。
  // ==========================================================================

  {
    id: 'fetch',
    term: '取指',
    en: 'Fetch · IF',
    category: 'concept',
    scope: 'standard',
    level: 3,
    aliases: ['取指阶段', 'fetch'],
    body:
      '取出下一条要执行的指令。[[pc|程序计数器]]把地址交给指令存储器，存储器把那个地址上的机器码送回来，同时 PC 加上 4 指向紧随其后的一条。这一步决定了机器接下来做什么；跳转与分支的效果，也要等到这一步才看得出来。',
    related: ['instruction-memory', 'stage', 'pc'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 取指' },
      { label: '本仓库 frontend/src/components/panels/InstructionPanel.vue（「PC 送出取指地址」）' },
    ],
  },
  {
    id: 'decode',
    term: '译码',
    en: 'Decode · ID',
    category: 'concept',
    scope: 'standard',
    level: 3,
    aliases: ['译码阶段', 'decode'],
    body:
      '把取回的机器码拆开：认出这是哪一条指令、用到了哪些[[register|寄存器]]、[[immediate|立即数]]是多少，并据此产生这一拍需要的全部控制信号。图上的译码器做的正是这件事。它是二进制编码与操作意图之间的转换环节，本身不改变任何数据。',
    related: ['decoder', 'instruction-format', 'control-signal'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 译码' },
      { label: '本仓库 frontend/src/components/panels/InstructionPanel.vue（译码卡片）' },
    ],
  },
  {
    id: 'execute',
    term: '执行',
    en: 'Execute · EX',
    category: 'concept',
    scope: 'standard',
    level: 3,
    aliases: ['执行阶段', 'execute'],
    body:
      '[[alu|ALU]] 按控制信号对两个操作数做运算，得出结果，同时给出零标志与小于标志。第二个操作数可能来自寄存器，也可能来自立即数，由 ALU 源选择信号决定。分支指令走到这一步只需要标志位，并不关心运算结果本身是什么。',
    related: ['alu', 'alu-flags', 'control-signal'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 执行' },
      { label: '本仓库 frontend/src/data/datapathLayout.json（EX 分组的部件）' },
    ],
  },
  {
    id: 'mem-access',
    term: '访存',
    en: 'Memory Access · MEM',
    category: 'concept',
    scope: 'standard',
    level: 3,
    aliases: ['访存阶段', '内存访问'],
    body:
      '按 [[alu|ALU]] 算出的地址访问数据存储器：加载指令从里面取出数据，存储指令把数据写进去，其余指令在这一步什么也不做。地址由基址[[register|寄存器]]加上立即数偏移得到，所以真正用到这一步的只有访存类指令。',
    related: ['data-memory', 'base-address', 'stage'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 访存' },
      { label: '本仓库 frontend/src/components/panels/InstructionPanel.vue（访存卡片）' },
    ],
  },
  {
    id: 'write-back',
    term: '写回',
    en: 'Write Back · WB',
    category: 'concept',
    scope: 'standard',
    level: 3,
    aliases: ['写回阶段'],
    body:
      '把这一条指令的结果送回[[register-file|寄存器堆]]。结果的来源不止一处：运算类指令来自 [[alu|ALU]]，加载指令来自数据存储器，跳转指令是 pc+4，由写回选择信号决定取哪一个。LUI 写回的就是那个立即数、AUIPC 是 pc 加立即数，两者都经由 ALU 算出。这是五步当中唯一真正改动寄存器的环节。',
    related: ['data-memory', 'mux', 'stage'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 写回' },
      { label: '本仓库 frontend/src/components/panels/InstructionPanel.vue（写回卡片）' },
    ],
  },
  {
    id: 'funct7',
    term: 'funct7',
    en: 'funct7 · Function Code 7',
    category: 'encoding',
    scope: 'standard',
    level: 3,
    aliases: ['funct7 字段', '功能码 7'],
    body:
      '[[opcode|操作码]]与 [[funct3|funct3]] 之外的第三级功能编码，占 7 位，在 R 型与移位立即数指令里参与区分。加减法就是共用一个操作码、一个 funct3，全靠 funct7 是 0 还是 0x20 才分得开。slli/srli/srai 虽属立即数指令，funct7 位置照样当功能码（srai 为 0x20，其余为 0）；而在 addi 这类普通立即数指令里，这 7 位才是立即数的高位。',
    related: ['opcode', 'funct3', 'instruction-format'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 整数计算指令（R 型与移位立即数指令的 funct7）' },
      { label: '本仓库 backend/cpp/src/rv_control.hpp（funct3=101 时按 funct7 分 SRA / SRL）' },
    ],
  },
  {
    id: 'zero-register',
    term: '零号寄存器',
    en: 'x0 · Zero Register',
    category: 'register',
    scope: 'standard',
    level: 3,
    aliases: ['zero 寄存器', 'x0'],
    body:
      '[[register|寄存器]] x0 的别名。它的特殊之处不在于「里面存着 0」，而在于硬件上就把它硬连线成 0：读它永远得到 0，写它则被直接丢弃、什么也不会发生。这两条特性让不少指令省掉了专门写法，例如拿它当目标寄存器，就等于只比较、不保存结果。',
    related: ['register', 'abi-name', 'addi'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 寄存器 x0 的硬连线' },
    ],
  },
  {
    id: 'frame-pointer',
    term: '帧指针',
    en: 'FP · Frame Pointer',
    category: 'register',
    scope: 'standard',
    level: 4,
    aliases: ['fp', '栈帧'],
    body:
      '[[register|寄存器]] x8 的别名，也写作 s0。它指向当前子程序栈帧的底部：进入子程序时先把旧的 fp 压栈，再把 fp 设成新的栈顶，之后局部变量与保存下来的寄存器都用相对 fp 的固定偏移访问。这样即使调用过程中 sp 反复变动，取数据的位置也不会跟着漂移。',
    related: ['stack-pointer', 'callee-saved', 'subroutine'],
    sources: [
      { label: 'RISC-V 官方汇编器手册（RISC-V Assembly Programmer’s Handbook）', locator: '寄存器别名与调用约定' },
    ],
  },
  {
    id: 'read-enable',
    term: '读使能',
    en: 'Read Enable',
    category: 'signal',
    scope: 'standard',
    level: 3,
    aliases: ['读允许', 'mem_ren'],
    body:
      '一种控制信号：只有它有效时，目标部件的输出才是真实数据，否则这个输出没有意义。数据存储器靠它区分「这条指令根本不访存」与「这条指令正在读数」。它与[[write-enable|写使能]]是两个方向的开关：读使能管数据出不出得来，写使能管数据进不进得去。',
    related: ['data-memory', 'control-signal', 'write-enable'],
    sources: [
      { label: '本仓库 frontend/src/utils/formatters.ts（「数据存储器读使能」）' },
      { label: '本仓库 frontend/src/components/panels/InstructionPanel.vue（读使能一格）' },
    ],
  },
  {
    id: 'wire-type',
    term: '线型',
    en: 'Wire Type',
    category: 'concept',
    scope: 'standard',
    level: 3,
    aliases: ['类型 data', 'wire type', '线的类型', '线的颜色'],
    body:
      '图上每根线所属的类别，悬停时显示中文名。共六类：数据总线、地址/PC、立即数/常量、控制信号、时钟/复位、异常/中断。判定只看这根线传什么：位置编号（PC、访存地址、寄存器号）算地址，判据与开关量算控制。它标明了取值何时有意义——时钟是节拍，控制在整条指令期间不变，数据随运算结果变化。',
    related: ['net', 'port', 'clock-signal'],
    sources: [
      { label: '本仓库 frontend/src/components/datapath/DatapathView.vue（悬停显示「类型：xxx」）' },
      { label: '本仓库 frontend/src/data/datapathLayout.json（各条线的 kind 字段）' },
    ],
  },
  {
    id: 'exit-code',
    term: '退出码',
    en: 'Exit Code',
    category: 'concept',
    scope: 'project',
    level: 2,
    aliases: ['返回码', 'exit code'],
    body:
      '程序结束时用来告诉运行环境「这次运行结果如何」的那个值。本模拟器沿用常见约定，把[[register|寄存器]] a0 的最终取值当作退出码，状态栏的 exit= 显示的就是它；示例程序统一在结尾把 a0 置 0，表示正常结束。这只是一条惯例，硬件层面对退出码一无所知。',
    related: ['halt', 'return-address', 'caller-saved'],
    sources: [
      { label: '本仓库 backend/python/ws_handler.py（_last_exit_code 取 regs[10]，即 a0）' },
      { label: '本仓库 frontend/src/data/examples.ts（示例末尾 addi a0, zero, 0）' },
    ],
  },
  {
    id: 'loop',
    term: '循环',
    en: 'Loop',
    category: 'concept',
    scope: 'standard',
    level: 4,
    aliases: ['迭代', 'loop'],
    body:
      '需要反复执行的一段代码，靠一条分支或跳转指令把控制流送回开头。循环不是某一条指令，而是「标号 + 条件分支 + 往回跳」组合出来的结构。计数通常放在一个[[register|寄存器]]里，每轮加一或减一，条件不再成立时自然退出。',
    related: ['branch', 'label', 'j'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 2 章 循环与分支' },
      { label: '本仓库 frontend/src/data/examples.ts（示例中的 loop: 标号）' },
    ],
  },
  {
    id: 'hazard',
    term: '冒险',
    en: 'Hazard',
    category: 'concept',
    scope: 'standard',
    level: 2,
    aliases: ['冲突', '流水线冒险', 'hazard', '转发', '前递', '阻塞', '停顿'],
    body:
      '[[pipeline|流水线]]里「后一条指令要用前一条还没算完的结果」这类冲突的统称，分数据冒险、控制冒险、结构冒险三类，处理办法有前递（也叫转发）、停顿（也叫阻塞）、分支预测等。[[single-cycle|单周期]]模型机一条走完才走下一条，因此完全不存在冒险问题——这也是它便于教学的原因之一。',
    related: ['pipeline', 'cpi', 'single-cycle'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 流水线冒险' },
    ],
  },
  {
    id: 'microarchitecture',
    term: '微架构',
    en: 'Microarchitecture',
    category: 'concept',
    scope: 'standard',
    level: 2,
    aliases: ['微体系结构', '实现方式'],
    body:
      '[[isa|指令集]]的具体电路实现方式，也就是「用什么部件、分几级流水、每条指令花几个周期去实现这套接口」。同一条 [[riscv|RISC-V]] 指令，单周期实现、多周期实现、流水线实现的微架构完全不同，跑出来的程序结果却一致，因为它们遵守同一份指令集。指令集是规格，微架构是造法。',
    related: ['cpu', 'pipeline', 'single-cycle'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 1 章 体系结构与微架构的分野' },
    ],
  },
  {
    id: 'assembly-language',
    term: '汇编语言',
    en: 'Assembly Language',
    category: 'isa',
    scope: 'standard',
    level: 2,
    aliases: ['汇编', 'assembly', '汇编源程序'],
    body:
      '用助记符而不是二进制书写[[instruction|指令]]的语言，一条语句通常对应一条机器指令。除指令外它还提供标号、注释与[[pseudo-instruction|伪指令]]，让人能读写程序。它必须经[[assembler|汇编器]]翻译成机器码才能运行——CPU 直接执行的是机器码，不是汇编语句。',
    related: ['instruction', 'assembler', 'isa', 'label'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 2 章 翻译并启动程序' },
      { label: '本仓库 backend/python/asm.py' },
    ],
  },
  {
    id: 'addressing-mode',
    term: '寻址方式',
    en: 'Addressing Mode',
    category: 'isa',
    scope: 'standard',
    level: 3,
    aliases: ['寻址模式', '寻址'],
    body:
      '指令里怎么指明操作数在哪儿。本模拟器用到的只有几种：操作数直接写在指令字里的[[immediate|立即数]]寻址；放在[[register|寄存器]]里的寄存器寻址；把「基址寄存器加偏移」算成地址的基址寻址，载入存储指令都属此类；以及以当前 [[pc|程序计数器]] 为基准的 PC 相对寻址。',
    related: ['instruction-format', 'immediate', 'base-address', 'pc'],
    sources: [
      { label: 'RISC-V 非特权指令集手册（Volume I，20191213 版）', locator: '第 2 章 立即数编码变体、载入存储与分支指令' },
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 2 章 寻址方式' },
    ],
  },
  {
    id: 'control-unit',
    term: '控制器',
    en: 'Control Unit',
    category: 'unit',
    scope: 'standard',
    level: 3,
    aliases: ['控制单元', 'CU'],
    body:
      'CPU 里决定每一步该做什么的那部分，它从指令字推出全部[[control-signal|控制信号]]，指挥[[datapath|数据通路]]上的多路选择器与读写使能。本模拟器把它画成标「[[decoder|译码器]]」的那个方框：这里没有单独的时序状态机，控制信号完全由指令字组合出来。',
    related: ['decoder', 'control-signal', 'datapath'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 控制单元' },
      { label: '本仓库 backend/cpp/src/rv_control.hpp' },
    ],
  },
  {
    id: 'bus',
    term: '总线',
    en: 'Bus',
    category: 'unit',
    scope: 'standard',
    level: 3,
    aliases: ['系统总线', 'system bus'],
    body:
      '被多个部件共享的一组传输通道，同一时刻只允许一个部件驱动它。真实 CPU 用总线把核心、内存与外设连起来，省引脚也便于扩展。本模拟器没有总线：图上那些线都是点对点的[[net|网络]]，各部件连各自的线，不存在争用与仲裁问题。',
    related: ['net', 'port', 'datapath'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 总线' },
      { label: '本仓库 frontend/src/data/datapathLayout.json（图上全部为点对点连线）' },
    ],
  },
  {
    id: 'tristate',
    term: '三态门',
    en: 'Tri-state Buffer',
    category: 'unit',
    scope: 'standard',
    level: 3,
    aliases: ['三态缓冲器', '三态门电路', '三态'],
    body:
      '输出能有三种状态的缓冲器：低电平、高电平与高阻。高阻相当于把输出从线上摘下来，于是多个输出可以挂到同一根线上、由使能信号决定谁在驱动——这是[[bus|总线]]能被共享的电路基础。本模拟器不用三态门，同一位置改用[[mux|多路选择器]]择一输出。',
    related: ['bus', 'mux', 'net'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 4 章 总线与三态门' },
    ],
  },
  {
    id: 'context',
    term: '上下文',
    en: 'Context',
    category: 'trap',
    scope: 'standard',
    level: 4,
    aliases: ['现场', '现场保护', '上下文切换'],
    body:
      '处理器当前状态的全套内容：[[pc|程序计数器]]的值、各[[register|寄存器]]的内容，以及 mstatus 一类[[trap|陷阱]]相关的 CSR。若不先把上下文存起来就去跑处理程序，原程序的现场会被踩坏、返回后无法继续。本模拟器保存的现场只有 [[mepc|mepc]] 与 mstatus 的两个中断位。',
    related: ['trap', 'exception', 'mepc', 'mstatus'],
    sources: [
      { label: 'RISC-V 特权指令集手册（Volume II，20211203 版）', locator: '第 3 章 机器级陷阱处理' },
      { label: '本仓库 backend/cpp/src/rv_core.cpp（trap 时保存 mepc 与 MPIE）' },
    ],
  },
  {
    id: 'main-memory',
    term: '主存',
    en: 'Main Memory',
    category: 'memory',
    scope: 'standard',
    level: 3,
    aliases: ['内存', '主存储器', 'RAM', '随机存取存储器'],
    body:
      'CPU 直接按地址读写的那块存储器，程序与数据都放在里面。它比[[register|寄存器]]容量大得多、速度慢得多，以[[byte|字节]]为最小可寻址单位。本模拟器只有一整块 128 KB 内存，取指与读写数据都用它，属[[von-neumann|冯·诺依曼结构]]；起始地址见[[memory-map|内存映射]]。',
    related: ['memory-map', 'data-memory', 'instruction-memory'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 5 章 存储器' },
      { label: '本仓库 backend/cpp/src/rv_memory.hpp（单一 128 KB 内存）' },
    ],
  },
  {
    id: 'latch',
    term: '锁存器',
    en: 'Latch',
    category: 'unit',
    scope: 'standard',
    level: 3,
    aliases: ['锁存器电路', '电平触发'],
    body:
      '能存住 1 位的元件，与[[flip-flop|触发器]]的差别在「什么时候更新」：锁存器电平敏感，使能为高期间输入直接透到输出；触发器边沿敏感，只在[[clock-signal|时钟信号]]跳变那一刻采样。边沿敏感让时序更容易分析，真实 CPU 的寄存器因此几乎都用触发器而非锁存器。',
    related: ['flip-flop', 'sequential-logic', 'register'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 5 章 锁存器与触发器' },
    ],
  },
  {
    id: 'sign-magnitude',
    term: '原码与反码',
    en: 'Sign-Magnitude & Ones Complement',
    category: 'concept',
    scope: 'standard',
    level: 2,
    aliases: ['原码', '反码', '符号数值表示', '一补数'],
    body:
      '[[twos-complement|补码]]之外两种早期的有符号数表示法。原码拿最高位当符号、其余位当数值；反码把负数写成各位取反。两者的共同毛病是有「+0」和「−0」两个零，加减法还得分开处理符号，电路比补码麻烦，如今基本只出现在教材里。',
    related: ['twos-complement', 'overflow', 'slt'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 3 章 有符号数的表示' },
    ],
  },
  {
    id: 'memory-hierarchy',
    term: '存储层次',
    en: 'Memory Hierarchy',
    category: 'memory',
    scope: 'standard',
    level: 3,
    aliases: ['存储层次结构', '存储器层次结构', '存储体系'],
    body:
      '按「越快越小越贵」叠起来的多层存储：[[register|寄存器]]、[[cache|缓存]]、[[main-memory|主存]]、磁盘，每一层都当下层的缓存。因为程序在一段时间里只反复访问一小片数据，多数访问能被上层接住，整机看起来既大又快。本模拟器只有寄存器与主存两层。',
    related: ['cache', 'main-memory', 'register'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 5 章 存储器层次结构' },
      { label: '本仓库 backend/cpp/src/rv_memory.hpp（只有单一内存，无缓存层）' },
    ],
  },
  {
    id: 'cache',
    term: '缓存',
    en: 'Cache',
    category: 'memory',
    scope: 'standard',
    level: 3,
    aliases: ['高速缓存', '高速缓冲存储器', '命中率', '命中'],
    body:
      '夹在 CPU 与[[main-memory|主存]]之间的小而快的存储器，保存最近用过的那部分数据。CPU 要的数据还在里面就叫命中，不必等主存；不在就叫缺失，得从主存取回来并替换掉一块旧的。命中率越高，平均访问时间越短。本模拟器没有缓存，访存一律直接落到主存。',
    related: ['memory-hierarchy', 'main-memory', 'data-memory'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 5 章 高速缓存' },
      { label: '本仓库 backend/cpp/src/rv_memory.hpp（无缓存层）' },
    ],
  },
  {
    id: 'virtual-memory',
    term: '虚拟内存',
    en: 'Virtual Memory',
    category: 'memory',
    scope: 'standard',
    level: 3,
    aliases: ['虚存', '虚拟存储器', '页表', 'MMU'],
    body:
      '让每个程序都以为自己独占一整片连续地址空间的机制：程序用虚拟地址，由 MMU 查页表翻成物理地址，再落到[[main-memory|主存]]。它同时负责隔离与保护，一个程序越界也碰不到别人的数据。本模拟器没有 MMU，程序里的地址就是物理地址。',
    related: ['main-memory', 'memory-map', 'memory-hierarchy'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 5 章 虚拟内存' },
      { label: '本仓库 backend/cpp/src/rv_memory.hpp（地址即物理地址）' },
    ],
  },
  {
    id: 'speedup',
    term: '加速比',
    en: 'Speedup',
    category: 'concept',
    scope: 'standard',
    level: 2,
    aliases: ['性能提升', '加速倍数'],
    body:
      '改造前后跑同一个程序所花时间的比值，用来判断一项优化值不值得做。时间等于 [[cpi|CPI]] 乘[[clock-frequency|时钟周期]]再乘指令条数，这三项动哪一个都能算出加速比。[[pipeline|流水线]]提高的是吞吐率，单条指令的延时反而略增，所以它的加速比上限是流水级数。',
    related: ['cpi', 'pipeline', 'single-cycle', 'clock-frequency'],
    sources: [
      { label: '《计算机组成与设计：硬件/软件接口》（RISC-V 版）', locator: '第 1 章 性能度量' },
    ],
  },
]

// ---------------------------------------------------------------- 图上部件 → 词条
//
// 两层映射，缺一不可。datapathLayout.json 里 MUX 这个 label 出现 12 次、ADD 出现 2 次，
// 同一个 label 对应不同 id；学生点哪一个 MUX 都应该进同一个「多路选择器」词条。
//
// 第一层按 module id 精确映射，id 永不含糊，是唯一该被信任的键。
// 第二层按框内主标题兜底，保证 id 漏登时也不会「点了没反应」。
//
// MODULE_GLOSSARY 必须写满 datapathLayout.json 里全部 28 个 module id
// （_glossary_check.mjs 会断言）。28 个目标词条已全部录入，映射表里不再有悬空项。
// 运行时若仍遇到目标 id 查不到词条，会走「未收录 → 相近词条」的降级视图。

export const MODULE_GLOSSARY: Record<string, string> = {
  PC: 'pc',
  imem: 'instruction-memory',
  regfile: 'register-file',
  alu: 'alu',

  pcmux1: 'mux',
  pcmux2: 'mux',
  pcmux3: 'mux',
  pcmux4: 'mux',
  pcmux5: 'mux',
  pcmux6: 'mux',
  muxa: 'mux',
  muxb: 'mux',
  muxa0: 'mux',
  wbmux: 'mux',
  wbmux0: 'mux',
  wbmux1: 'mux',

  reset: 'reset-signal',
  clkmod: 'clock-signal',
  const0: 'constant',
  const4: 'constant',
  pc4adder: 'adder',
  pcimmadder: 'adder',
  taken: 'branch-taken',
  decoder: 'decoder',
  jalrclean: 'jalr',
  dmem: 'data-memory',
  trapunit: 'trap',
  csr: 'csr',
}

export const LABEL_GLOSSARY: Record<string, string> = {
  MUX: 'mux',
  ADD: 'adder',
  ALU: 'alu',
  '&~1': 'jalr',
  taken: 'branch-taken',
  寄存器堆: 'register-file',
  译码器: 'decoder',
  指令存储器: 'instruction-memory',
  数据存储器: 'data-memory',
  'CSR 寄存器组': 'csr',
  'trap 判据': 'trap',
}
