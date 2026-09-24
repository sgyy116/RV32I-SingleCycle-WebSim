# RV32I 单周期模型机 —— 前后端通信协议（v1.0）

> 本文档为前后端通信的权威定义。任何字段变更必须同步更新 C++ 序列化、Python 转发、前端类型。

## 1. 传输层

| 通道 | 地址 | 协议 | 用途 |
| ---- | ---- | ---- | ---- |
| WebSocket | `ws://localhost:8080` | JSON 逐条消息 | 仿真控制 + 周期状态推送 |
| HTTP | `http://localhost:8081/api/compile` | JSON POST | 汇编源码编译 |

- Python 中间层每 WebSocket 客户端维护一个独立 C++ 子进程（进程级隔离）。
- 命令均为「请求 → 响应」；`run` 为流式推送，直到 `halted` / `breakpoint_hit` / `paused`。

## 2. 前端 → 后端命令

| type | 参数 | 说明 |
| ---- | ---- | ---- |
| `hello` | — | 连接握手，返回 `ready` |
| `load` | `source: string` | 编译源码并加载到模拟器 |
| `load_elf` | `path: string` | 直接加载已存在的 ELF/bin |
| `step` | — | 单步执行一个周期 |
| `run` | — | 连续运行（流式推送） |
| `pause` | — | 请求暂停运行 |
| `reset` | — | 复位 CPU |
| `set_breakpoint` | `addr: string` | 设置断点 |
| `clear_breakpoint` | `addr: string` | 清除断点 |
| `get_memory` | `addr, count` | 读取内存字节 |
| `get_disassembly` | `addr, count` | 反汇编一段内存 |

## 3. 后端 → 前端消息

### 3.1 `ready`
```jsonc
{"type": "ready", "version": "1.0"}
```

### 3.2 `loaded`
```jsonc
{"type": "loaded", "entry": "0x80000000", "arch": "RV32I"}
```

### 3.3 `cycle_state`（核心，每周期推送）
```jsonc
{
  "type": "cycle_state",
  "cycle": 42,
  "state": {
    "pc": "0x80000100",
    "next_pc": "0x80000104",
    "instruction": "0x00a50533",
    "disassembly": "add a0, a0, a0",

    "instruction_fields": {
      "opcode": "0b0110011", "opcode_name": "OP",
      "rd": 10, "funct3": "0b000", "rs1": 10, "rs2": 10,
      "funct7": "0b0000000", "format": "R"
    },

    "immediate": 0,

    "control_signals": {
      "reg_write": true,  "alu_src": false,
      "mem_write": false, "mem_read": false, "mem_to_reg": false,
      "branch": false,    "jump": false,
      "is_auipc": false,  "is_lui": false, "is_jalr": false,
      "alu_op": "ADD"
    },

    "reg_reads": {
      "rs1": {"index": 10, "value": 42},
      "rs2": {"index": 10, "value": 42}
    },

    "alu": {"op1": 42, "op2": 42, "result": 84, "zero": false},

    "memory": {
      "addr": "0x00000000", "read_data": "0x00000000",
      "write_data": "0x00000000", "access_type": "NONE", "access_size": 0
    },

    "writeback": {"active": true, "reg_index": 10, "data": 84, "source": "ALU"},

    "branch": {"taken": false, "target_addr": "0x80000104"},

    "regfile": [0, 0, ...],   // 32 个寄存器，写回后的值
    "halted": false
  }
}
```

### 3.4 事件消息
```jsonc
{"type": "halted", "cycle": 100, "exit_code": 0}         // 停机（exit = a0）
{"type": "breakpoint_hit", "addr": "0x80000100", "cycle": 15}
{"type": "paused"}
{"type": "error", "message": "编译失败: ..."}
{"type": "memory_dump", "addr": "0x80000000", "bytes": [..]}
{"type": "disassembly", "start": "0x80000000", "instructions": [{"pc","bytes","text"}]}
```

## 4. 数据通路内部一致性约束（可自动校验）

- `alu_src == false` → `alu.op2 == reg_reads.rs2.value`
- `alu_src == true`  → `alu.op2 == immediate`
- `reg_write == true` → `writeback.active == true`
- `mem_to_reg == true` → `writeback.source == "MEM"`
- `mem_to_reg == false` → `writeback.source == "ALU"`
- 下一周期 `regfile[writeback.reg_index]` 应等于本周期的 `writeback.data`
