# RV32I 单周期模型机 —— 前后端通信协议（v1.0）

> 本文档为前后端通信的权威定义。任何字段变更必须同步更新 C++ 序列化、Python 转发、前端类型。

## 1. 传输层

| 通道 | 地址 | 协议 | 用途 |
| ---- | ---- | ---- | ---- |
| WebSocket | `ws://localhost:8080` | JSON 逐条消息 | 仿真控制 + 周期状态推送 |
| WebSocket | `ws://localhost:8081/ws` | 同源 JSON 消息 | 页面实际使用的会话入口 |
| HTTP | `http://localhost:8081/api/compile` | JSON POST | 仅本地模式的编译预览，不返回文件路径 |
| HTTP | `http://localhost:8081/` | 静态文件 | 预构建前端页面（交付模式的入口；开发模式用 5173） |

- 前端通过同源 `/ws` 提交源码并编译、加载，不再串联 HTTP 编译和文件路径加载。
- HTTP 编译预览按请求创建临时目录并在编译结束后删除；服务器模式关闭该端点。
- Python 中间层每 WebSocket 客户端维护一个独立 C++ 子进程（进程级隔离）。
- 命令均为「请求 → 响应」；`run` 为流式推送，直到 `halted` / `breakpoint_hit` / `paused`。

## 2. 前端 → 后端命令

| type | 参数 | 说明 |
| ---- | ---- | ---- |
| `hello` | — | 连接握手，返回 `ready` |
| `load` | `source: string` | 编译源码并加载到模拟器 |
| `load_elf` | `path: string` | 网络入口始终拒绝；C++ 内部管道仍支持该命令 |
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
{"type": "ready", "version": "1.0", "session_id": "32位随机十六进制标识"}
```

同一连接发送 `hello` 返回原会话标识，不创建或恢复会话。两个 WebSocket 入口都遵守：

- 每条连接独立目录、C++ 进程、寄存器、内存和断点；客户端不能通过指定标识接管会话。
- 重新加载先回收旧进程，成功加载后清除旧断点；编译失败保留当前已加载实验。
- 断线释放进程及目录；前端清除旧仿真状态但保留编辑器源码，重连后需重新编译加载。
- `run` 由中间层逐周期请求驱动。复位、加载、查询及断点修改先等待当前周期完成并停止运行，避免响应交叉；`pause` 返回 `paused_ack` 和 `paused`。
- 单次连续运行上限 100000 周期，到达上限返回 `paused`，`reason` 为 `cycle_limit`。
- 内存查询 `count` 为 1–4096 的整数，反汇编查询为 1–1024；非法消息返回错误，不关闭会话。

此处会话标识用于关联实验和日志，不是登录凭证。当前不提供跨连接恢复，也不是操作系统安全沙箱。

### 实验排队与名额

独立 8080 与同源 `/ws` 共用一个进程内队列。默认最多 20 个活动实验、100 个等待连接；这是可配置保护值，不代表学校服务器已验证容量。通过 `RV32I_MAX_SESSIONS`、`RV32I_MAX_WAITING` 调整。活动会话默认 1800 秒没有收到用户命令后关闭，由 `RV32I_SESSION_IDLE_SECONDS` 调整。

名额不足先返回 `{"type":"queued","position":1,"active":20,"capacity":20}`。position 从 1 开始，前方人数为 position−1；等待连接不分配实验目录或模拟器。断开、取消或活动会话释放后更新位置，按进入顺序准入并发送 `ready`。等待时的实验命令不执行、不缓存；可发 `cancel_queue` 或直接关闭连接退出。等待人数超限发送 `queue_full` 后关闭；空闲超时发送 `session_expired` 后关闭。前端对这两种关闭不自动重连，由用户手动重新加入。

队列只在单个 Python 服务进程内共享；不能直接部署多进程副本来获得同一全局容量上限。用户标签页会各占一个名额；当前不按登录身份去重。

位置、活动人数和上限未变化时不重复通知；队尾加入只通知新等待者，队首释放才更新后续位置。等待时误发实验命令，仍单独返回该连接的位置提示。

浏览器只保留一条当前连接，忽略旧连接的延迟回调；握手 10 秒超时关闭后重试。连续失败按 1.5 秒起逐步退避，加入最多 20% 抖动，总间隔不超过 30 秒；成功连接后重置。退出排队、满员或过期关闭会清除自动重连及握手定时器，手动重新加入立即尝试。

### 网络检测

始终提供 `GET /api/network/ping`、`GET /api/network/download?size=1048576`、`POST /api/network/upload`，排队用户也可检测。下载只接受 65536、262144、1048576、2097152 字节，上传最多 512 KiB；上传和下载共用最多 4 个进行中传输，超出返回 429。传输设置 10 秒超时，响应禁止缓存和变换；部署入口应关闭这一路径的压缩和代理缓冲。

页面手动测 3 次 HTTP 往返取中位数、下载 1 MiB、上传 256 KiB；Mbps = 字节数 × 8 ÷ 毫秒数 ÷ 1000。整次检测 30 秒超时，可取消；结果是包含应用开销的小样本传输速度，不代表互联网线路峰值或经过验证的最低带宽要求。5 Mbps 仅作为页面提示的初步参考；短于 100 ms 的样本提示结果仅供参考。不在进入页面时自动测速。

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
