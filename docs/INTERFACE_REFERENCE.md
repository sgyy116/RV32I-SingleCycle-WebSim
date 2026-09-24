# RV32I 仿真器接口与格式参考

本文档是 `docs/PROTOCOL.md` 的扩展参考，记录字段格式、三层映射、前端消费位置、内部 C++ 协议和测试覆盖。公开客户端优先阅读 [PROTOCOL.md](./PROTOCOL.md)。

最后同步检查：2026-09-23。

## 1. 接口边界与事实来源

```text
Vue / TypeScript
  ├─ POST /api/compile ───────────────► Python compile_server.py
  └─ WebSocket JSON ─────────────────► Python ws_handler.py
                                           │
                                           └─ stdin/stdout 行式 JSON
                                              C++ main.cpp / rv_core.cpp
```

| 层 | 权威文件 | 职责 |
| --- | --- | --- |
| C++ 状态生成 | `backend/cpp/src/rv_core.hpp`, `rv_core.cpp` | 定义并序列化单周期状态 |
| C++ 命令协议 | `backend/cpp/src/main.cpp` | stdin/stdout 命令及响应 |
| Python 转发 | `backend/python/ws_handler.py`, `cpp_bridge.py` | 公共 WebSocket 命令到 C++ 命令的映射 |
| HTTP 编译 | `backend/python/compile_server.py` | 编译请求和结果 |
| TypeScript 合同 | `frontend/src/types/simulation.ts` | 前端可消费的消息和状态类型 |
| 前端状态 | `frontend/src/stores/simulator.ts` | 消息分发、历史快照和控制命令 |
| 显示层 | `frontend/src/components/**` | 读取状态并显示 |

## 2. 数据格式约定

| 类别 | JSON 类型 | 格式 |
| --- | --- | --- |
| 地址、指令字、内存值、CSR | `string` | `0x` + 8 位小写十六进制，例如 `0x80000000` |
| opcode/funct 位域 | `string` | 固定宽度二进制，例如 `0b0110011` |
| 寄存器值、ALU 值、周期号 | `number` | C++ `u32` 输出为非负十进制数 |
| 立即数 | `number` | 有符号十进制数 |
| 开关和状态标记 | `boolean` | JSON `true` / `false`，不是字符串 |
| 文本 | `string` | UTF-8；Python 转发使用 `ensure_ascii=False` |

JavaScript number 可以精确表示全部 32 位整数。需要按有符号值解释时，由显示层显式转换，不改变协议原值。

## 3. HTTP `/api/compile`

### 3.1 请求

```http
POST /api/compile
Content-Type: application/json
```

```ts
interface CompileRequest {
  source: string
}
```

### 3.2 响应

```ts
interface CompileSuccess {
  success: true
  elf_path: string
  disassembly: DisassemblyEntry[]
  errors: []
  toolchain: 'gcc' | 'fallback'
  instructions?: number // 仅 fallback
}

interface CompileFailure {
  success: false
  errors: string[]
}
```

GCC 可用时先尝试 `riscv-none-elf-gcc`；GCC 编译失败后仍会尝试内置汇编器。请求体无法解析时返回 HTTP 400；普通编译失败目前返回 JSON 失败对象。

开发服务器中，前端使用相对地址 `/api/compile`，由 Vite 代理到 `http://localhost:8081`。

## 4. WebSocket 请求矩阵

| 请求 | 必填字段 | 默认值 | Python → C++ | 前端当前使用 |
| --- | --- | --- | --- | --- |
| `hello` | 无 | — | 不进入 C++ | 否；连接后直接接收 `ready` |
| `load` | `source` | — | 编译后 `load_elf` | 集成测试使用 |
| `load_elf` | `path` | — | `load_elf(path)` | 是 |
| `step` | 无 | — | `step` | 是 |
| `run` | 无 | 服务端固定 `max_cycles=100000` | `run(max_cycles)` | 否；前端用定时 `step` |
| `pause` | 无 | — | 流式运行时注入 `pause` | 是；同时停止前端定时器 |
| `reset` | 无 | — | `reset` | 是 |
| `set_breakpoint` | `addr` | — | `set_breakpoint(addr)` | 是 |
| `clear_breakpoint` | `addr` | — | `clear_breakpoint(addr)` | 是 |
| `get_memory` | `addr` | `0x80000000`；`count=16` | `get_memory` | 是，界面通常读取 32 字节 |
| `get_disassembly` | `addr` | `0x80000000`；`count=128` | `disassemble(start,count)` | 是，加载后通常读取 256 条 |

公共 WebSocket 请求使用字段 `type`。Python 为兼容调试消息，也接受 `cmd` 作为消息类型字段。

## 5. WebSocket 响应类型

### 5.1 会话与控制

| `type` | 字段 | 触发条件 | 前端处理 |
| --- | --- | --- | --- |
| `ready` | `version: string` | 建连后主动发送；或响应 `hello` | 标记已连接 |
| `loaded` | `entry: string`, `arch: string`, `disassembly?: DisassemblyEntry[]` | 加载成功 | 保存入口并请求反汇编 |
| `reset_done` | 无 | `reset` 完成 | 清空状态后标记空闲 |
| `paused_ack` | 无 | 收到 `pause` | 当前界面已在发送时本地暂停，故无需二次处理 |
| `paused` | 无 | 服务端流式 `run` 已停止 | 标记暂停 |
| `breakpoint_set` | `addr?: string` | 设置断点完成 | 断点集合已在发送时本地更新 |
| `breakpoint_cleared` | `addr?: string` | 清除断点完成 | 同上 |
| `error` | `message: string` | 参数、编译、加载或运行失败 | 显示错误并停止运行 |

### 5.2 执行与查询

```ts
interface CycleStateMessage {
  type: 'cycle_state'
  cycle: number
  state: CycleState
}

interface HaltedMessage {
  type: 'halted'
  cycle: number
  exit_code: number // x10/a0
}

interface BreakpointHitMessage {
  type: 'breakpoint_hit'
  addr: string
  cycle: number
}

interface MemoryDumpMessage {
  type: 'memory_dump'
  addr: string
  bytes: number[] // 每项范围 0..255
}

interface DisassemblyMessage {
  type: 'disassembly'
  start: string
  instructions: DisassemblyEntry[]
}

interface DisassemblyEntry {
  pc: string
  bytes: string
  text: string
}
```

`step` 在停机周期先发送 `cycle_state`，随后发送 `halted`。`run` 连续发送互不重复的 `cycle_state`，再发送终止事件。

## 6. `CycleState` 字段表

周期号属于 `CycleStateMessage.cycle`。前端接收后组成内部 `CycleSnapshot = CycleState & { cycle: number }`，用于历史回退和波形显示。

### 6.1 指令与控制

| 路径 | 类型 | 含义 | 主要显示位置 |
| --- | --- | --- | --- |
| `pc` | `string` | 当前指令地址 | 数据通路、指令面板、反汇编高亮、波形 |
| `next_pc` | `string` | 本周期决定的下一 PC | 数据通路 |
| `instruction` | `string` | 32 位指令字 | 指令面板 |
| `disassembly` | `string` | 当前指令文本 | 指令面板、波形表头 |
| `instruction_fields.opcode` | `string` | 7 位 opcode | 指令面板/数据通路 |
| `instruction_fields.opcode_name` | `string` | opcode 类别名 | 指令面板 |
| `instruction_fields.rd/rs1/rs2` | `number` | 寄存器编号 | 指令面板 |
| `instruction_fields.funct3/funct7` | `string` | 固定宽度位域 | 数据通路 |
| `instruction_fields.format` | `string` | `R/I/S/B/U/J` 或空串 | 指令面板 |
| `immediate` | `number` | 符号扩展后的立即数 | 指令面板、数据通路 |

`control_signals` 固定包含：

```ts
interface ControlSignals {
  reg_write: boolean
  alu_src: boolean
  mem_write: boolean
  mem_read: boolean
  mem_to_reg: boolean
  branch: boolean
  jump: boolean
  is_auipc: boolean
  is_lui: boolean
  is_jalr: boolean
  alu_op: string
}
```

### 6.2 数据通路分组

| 分组 | 字段及类型 | 备注 |
| --- | --- | --- |
| `reg_reads.rs1/rs2` | `{index:number, value:number}` | 读取端口编号和值 |
| `alu` | `{op1:number, op2:number, result:number, zero:boolean}` | 组合逻辑结果 |
| `memory` | `{addr:string, read_data:string, write_data:string, access_type:'NONE'\|'READ'\|'WRITE', access_size:number}` | `access_size` 单位为字节 |
| `writeback` | `{active:boolean, reg_index:number, data:number, source:'ALU'\|'MEM'\|'PC_PLUS_4'\|'CSR'}` | `active=false` 时其他字段只作快照参考 |
| `branch` | `{taken:boolean, target_addr:string}` | `taken` 必须是 JSON boolean |
| `regfile` | `number[32]` | 本周期写回后的寄存器快照 |
| `halted` | `boolean` | 当前周期结束后是否停机 |

### 6.3 CSR 与 trap

```ts
interface CsrSnapshot {
  mtvec: string
  mepc: string
  mcause: string
  mstatus: string
  mie: string
  mip: string
  mtime: string
  mtimecmp: string
}

interface TrapInfo {
  taken: boolean
  cause: number
  mepc: string
  mtval: string
}
```

`cause >= 0x80000000` 表示中断，否则表示同步异常。指令面板显示 CSR 和 trap 横幅；波形面板使用 `trap.taken` 绘制 TRAP 信号。

## 7. C++ stdin/stdout 内部协议

内部协议使用字段 `cmd`，每行一个 JSON 对象。它不是浏览器公共接口。

| C++ `cmd` | 参数 | 响应 |
| --- | --- | --- |
| `load_elf` | `path` | `{"status":"ok","entry","arch"}` 或 `{"status":"error","message"}` |
| `step` | 无 | `cycle_state` |
| `run` | `max_cycles?: number`，默认 100000 | `cycle_state` 流，可能跟 `breakpoint_hit`/`paused` |
| `pause` | 无 | 仅在 `run` 期间被非阻塞读取；最终输出 `paused` |
| `reset` | 无 | `{"status":"ok"}` |
| `set_breakpoint` / `clear_breakpoint` | `addr` | `{"status":"ok"}` |
| `get_state` | 无 | 无副作用 `cycle_state` 快照 |
| `get_memory` | `addr`, `count?: number` | `memory_dump` |
| `get_registers` | 无 | `{"type":"registers","regs":[...]}` |
| `disassemble` | `start?: string`, `count?: number` | `disassembly` |
| `shutdown` / `quit` | 无 | `{"type":"bye"}` 后退出 |

Python 公共层没有暴露 `get_state` 和 `get_registers`。公共 `get_disassembly` 会被映射为内部 `disassemble`，并把 `addr` 改名为 `start`。

## 8. Python 转发规则

| 公共行为 | Python 处理 |
| --- | --- |
| 每连接隔离 | 每个 WebSocket 会话持有一个 `CppSimulatorBridge` 和独立临时编译目录 |
| 编译不阻塞事件循环 | `compile_source` 通过 `asyncio.to_thread` 调用 |
| 重新加载 | 启动新 C++ 进程前关闭旧进程 |
| 流式运行 | 每个 C++ 周期恰好转发一次；停机周期之后补发公共 `halted` |
| 加载失败 | C++ `status:error` 转换为公共 `type:error`，不发送空 `loaded` |
| 连接关闭 | 请求 C++ `shutdown`，超时后终止子进程 |

## 9. 前端消费矩阵

| 数据 | 状态层 | 显示层 |
| --- | --- | --- |
| `cycle` + `state` | 合成为 `CycleSnapshot`，加入 `stateHistory` | 周期计数、数据通路、寄存器、波形 |
| `instruction_fields`, `control_signals`, `alu` | `cycleState` | `InstructionPanel.vue`, `DatapathCanvas.vue` |
| `memory` | `cycleState` | 指令面板、内存访问高亮、数据通路 |
| `writeback`, `branch` | `cycleState` | 指令面板、数据通路 |
| `csr`, `trap` | `cycleState` | 中断/异常卡片、TRAP 波形 |
| `regfile` | `cycleState`、历史 | 寄存器面板、任意寄存器波形 |
| `disassembly` | `disassembly` | 指令列表、PC 高亮、断点 |
| `memory_dump` | `memoryDump` | 内存面板 |

## 10. 可自动检查的不变量

- `alu_src=false` ⇒ `alu.op2 == reg_reads.rs2.value`。
- `alu_src=true` ⇒ `alu.op2` 来自立即数路径；对特殊指令需以核心控制逻辑为准。
- `writeback.active=true` ⇒ `reg_index`、`data`、`source` 有效。
- `mem_to_reg=true` ⇒ `writeback.source == "MEM"`。
- `trap.taken=true` ⇒ `writeback.active=false` 且 `memory.access_type != "WRITE"`。
- `regfile.length == 32` 且 `regfile[0] == 0`。
- `branch.taken`、`trap.taken`、`halted` 均为 boolean。
- `cycle` 只存在于消息外层；前端历史快照可在内存中附加该值。
- 流式 `run` 中周期号不得重复。

## 11. 测试覆盖

| 测试 | 协议覆盖 |
| --- | --- |
| `backend/test/test_sim.py` | C++ `cycle_state` 外层、全部状态分组、控制信号、布尔类型、32 个寄存器、断点事件 |
| `backend/test/test_server.py` | `ready/load/step/run/reset/pause`、断点确认、内存、反汇编、加载错误映射、周期不重复 |
| `backend/test/test_rv32.py` | RV32I 运算语义、CSR、trap、中断、reset 语义及无副作用约束 |
| `npm run build` | TypeScript 类型与所有前端消费位置可编译 |

## 12. 本次同步结论

检查范围：C++ 序列化、Python 转发、TypeScript 类型、前端状态与显示、协议文档和测试。

已校正：

- `branch.taken` 从字符串改为 JSON boolean，与 TypeScript 和界面条件判断一致。
- 明确 `cycle` 属于消息外层；前端收到后构造 `CycleSnapshot`，周期显示与历史记录使用同一来源。
- Python `run` 不再重复转发最后一个停机周期。
- `load_elf` 失败统一映射为公共 `error`，成功的 `loaded` 保证包含 `entry` 和 `arch`。
- 子进程关闭命令统一使用 UTF-8 字节流。
- 测试补充协议结构、字段类型、控制确认、错误映射和流式周期唯一性检查。

后续每次协议变更应按以下顺序检查：

1. 修改 C++ 状态结构和序列化。
2. 修改 Python 命令映射与错误映射。
3. 修改 TypeScript 消息联合类型和状态类型。
4. 检查 `simulator.ts` 及所有显示组件的字段消费。
5. 添加或更新协议断言。
6. 更新 `PROTOCOL.md` 与本文档。
7. 运行三个后端测试和前端生产构建。

