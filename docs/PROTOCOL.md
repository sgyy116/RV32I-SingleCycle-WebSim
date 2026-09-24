# RV32I 单周期模型机通信协议（v1.0）

> 本文档是浏览器与 Python 服务之间的公开协议。字段级说明、C++ 内部协议和同步检查矩阵见 [INTERFACE_REFERENCE.md](./INTERFACE_REFERENCE.md)。

最后同步检查：2026-09-23。

## 1. 通道

| 通道 | 默认地址 | 格式 | 用途 |
| --- | --- | --- | --- |
| WebSocket | `ws://localhost:8080` | UTF-8 JSON，一条消息一个对象 | 加载、控制仿真、推送周期状态 |
| HTTP | `POST http://localhost:8081/api/compile` | JSON | 将汇编源码编译为 ELF 或裸二进制 |

端口可由 `WS_PORT`、`COMPILE_PORT` 环境变量覆盖。每个 WebSocket 连接拥有独立的 C++ 模拟器进程。

当前前端的标准调用链是：

```text
POST /api/compile → load_elf → loaded
                           → step × N → cycle_state → halted
```

前端“运行”按钮使用定时 `step` 控制播放速度；服务端同时保留流式 `run`，供测试和其他客户端使用。

## 2. HTTP 编译接口

请求：

```json
{"source":"addi a0, zero, 1\necall"}
```

成功响应：

```json
{
  "success": true,
  "elf_path": ".../prog.bin",
  "disassembly": [],
  "errors": [],
  "toolchain": "fallback",
  "instructions": 2
}
```

`toolchain` 为 `gcc` 或 `fallback`；`instructions` 仅回退汇编器返回。失败时 `success=false`，错误文本位于 `errors: string[]`。请求体不是合法 JSON 时返回 HTTP 400。

## 3. WebSocket 请求

| `type` | 参数 | 成功响应 | 说明 |
| --- | --- | --- | --- |
| `hello` | 无 | `ready` | 可选握手；连接建立时服务端已经主动发送一次 `ready` |
| `load` | `source: string` | `loaded` | 服务端编译并加载；空源码返回 `error` |
| `load_elf` | `path: string` | `loaded` | 加载已存在的 ELF/裸二进制；当前前端使用此路径 |
| `step` | 无 | `cycle_state`，必要时再发 `halted` | 执行一个周期 |
| `run` | 无 | 多个 `cycle_state`，最终为 `halted`、`breakpoint_hit` 或 `paused` | 服务端连续运行，最大 100000 周期 |
| `pause` | 无 | `paused_ack`；流式运行随后结束并发 `paused` | 请求暂停 |
| `reset` | 无 | `reset_done` | 清空 CPU/CSR，PC 回入口，保留程序内存 |
| `set_breakpoint` | `addr: string` | `breakpoint_set` | 地址使用十六进制字符串 |
| `clear_breakpoint` | `addr: string` | `breakpoint_cleared` | 清除断点 |
| `get_memory` | `addr: string`, `count?: number` | `memory_dump` | `count` 默认 16 |
| `get_disassembly` | `addr: string`, `count?: number` | `disassembly` | `count` 默认 128 |

未知命令、参数缺失、编译或加载失败统一返回：

```json
{"type":"error","message":"错误说明"}
```

## 4. 核心周期消息

周期号只出现在消息外层，`state` 是该周期执行后的 CPU/数据通路快照：

```jsonc
{
  "type": "cycle_state",
  "cycle": 42,
  "state": {
    "pc": "0x80000100",
    "next_pc": "0x80000104",
    "instruction": "0x00a50533",
    "disassembly": "add a0, a0, a0",
    "instruction_fields": { "opcode": "0b0110011", "opcode_name": "OP", "rd": 10, "funct3": "0b000", "rs1": 10, "rs2": 10, "funct7": "0b0000000", "format": "R" },
    "immediate": 0,
    "control_signals": { "reg_write": true, "alu_src": false, "mem_write": false, "mem_read": false, "mem_to_reg": false, "branch": false, "jump": false, "is_auipc": false, "is_lui": false, "is_jalr": false, "alu_op": "ADD" },
    "reg_reads": { "rs1": { "index": 10, "value": 42 }, "rs2": { "index": 10, "value": 42 } },
    "alu": { "op1": 42, "op2": 42, "result": 84, "zero": false },
    "memory": { "addr": "0x00000000", "read_data": "0x00000000", "write_data": "0x00000000", "access_type": "NONE", "access_size": 0 },
    "writeback": { "active": true, "reg_index": 10, "data": 84, "source": "ALU" },
    "branch": { "taken": false, "target_addr": "0x80000104" },
    "csr": { "mtvec": "0x00000000", "mepc": "0x00000000", "mcause": "0x00000000", "mstatus": "0x00000000", "mie": "0x00000000", "mip": "0x00000000", "mtime": "0x0000002a", "mtimecmp": "0x00000014" },
    "trap": { "taken": false, "cause": 0, "mepc": "0x00000000", "mtval": "0x00000000" },
    "regfile": [0, 0, 0],
    "halted": false
  }
}
```

示例中的 `regfile` 被截短；真实消息始终包含 32 个无符号 32 位整数。地址、指令字、内存数据和 CSR 统一使用 `0x` 开头的 8 位十六进制字符串；运算值和寄存器值使用 JSON number。

## 5. 事件与查询响应

```jsonc
{"type":"ready","version":"1.0"}
{"type":"loaded","entry":"0x80000000","arch":"RV32I"}
{"type":"halted","cycle":100,"exit_code":0}
{"type":"breakpoint_hit","addr":"0x80000100","cycle":15}
{"type":"paused_ack"}
{"type":"paused"}
{"type":"reset_done"}
{"type":"breakpoint_set","addr":"0x80000100"}
{"type":"breakpoint_cleared","addr":"0x80000100"}
{"type":"memory_dump","addr":"0x80000000","bytes":[19,5,160,2]}
{"type":"disassembly","start":"0x80000000","instructions":[{"pc":"0x80000000","bytes":"0x02a00293","text":"addi t0, zero, 42"}]}
```

通过 `load` 加载时，`loaded` 还可携带 `disassembly`；通过 `load_elf` 加载时不携带该字段，前端会再请求 `get_disassembly`。

## 6. 必须保持的语义

- `branch.taken`、`trap.taken`、控制信号和 `halted` 都是 JSON boolean，不得用字符串代替。
- `cycle` 位于 `cycle_state` 外层，不在 `state` 内重复。
- `trap.taken=true` 时，该周期不得写寄存器或内存。
- `regfile` 是本周期写回后的 32 个寄存器值，`x0` 恒为 0。
- `reset` 保留已加载程序；重新加载程序会把周期号归零。
- 协议字段变化必须同步 C++ 序列化、Python 映射、TypeScript 类型、前端消费、测试和本文档。

