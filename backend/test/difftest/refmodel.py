# -*- coding: utf-8 -*-
"""
refmodel.py —— 独立的 RV32I 单周期参照模型（差分测试的「第二实现」）

==============================================================================
独立性声明（这是本文件存在的全部意义，请勿破坏）
==============================================================================
**RV32I 指令语义、编码格式、非法指令判定**，全部只依据
《The RISC-V Instruction Set Manual, Volume I: Unprivileged ISA》的规范条文与
官方 opcode 表书写；编写时**没有阅读**以下文件：

    backend/cpp/src/rv_core.cpp      backend/cpp/src/rv_control.hpp
    backend/cpp/src/rv_alu.hpp       backend/cpp/src/rv_immgen.hpp
    backend/cpp/src/rv_disasm.cpp

若从这四个文件里「抄」语义，本模型就退化成被测实现的镜像，
差分测试会永远全绿——那正是 AUIPC 那个 bug 能活这么久的原因
（后端错、前端忠实镜像、断言自证）。

==============================================================================
三档语义，必须分清（决定了哪一类失配算「后端错」）
==============================================================================
[A] **规范规定**：上面那些。模型与实现不一致 ⇒ 至少一方违反规范，按规范判。
[B] **本项目文档规定**：CSR 布局、trap 流程、计时器三道门、mtimecmp=0x780、
    `mtvec==0` 停机兜底等自定义语义，来自 `README.md` / `docs/DEVELOPMENT.md`，
    不是规范内容。模型按文档写；文档没写到的按 [C] 处理。
[C] **实现自由度 / 文档未定义**：只能靠 `probe.py` 实测确定，本文件里逐条标注
    `[实测]`。这一档的比对只能防「改了却不知道」，防不了「一开始就理解错」——
    这是差分测试的固有边界，不是本文件的缺陷。

[C] 档清单（全部来自 probe.py 的实测输出，可重跑复核）：
  1. `mtime`(0xC01)/`cycle`(0xC00)/`instret`(0xC02) 三者读数相同，都等于
     **本拍执行时已完成的周期数**（第 N 拍读到 N）；`cycle_state.csr.mtime` 是
     本拍结束后的值，即 N+1。
  2. 写这三个只读 CSR **被完全忽略**（读回仍是当前计数）。
  3. `mstatus` 是**普通寄存器**，写 0xFFFFFFFF 就存 0xFFFFFFFF（不做 WARL 位掩码）；
     只有 bit3(MIE) / bit7(MPIE) 有含义。
  4. `mip` **不会被自动置位**（MTIP 永远是 0）；中断的「挂起」是直接比较
     `mtime >= mtimecmp`，不经过 mip。
  5. 非对齐访存**不报异常**，按字节逐字节访问（规范允许两种实现之一）。
  6. 越界访存**不报异常**：读返回 0，写被丢弃。
  7. CSR 地址是 4096 项的数组，**任意地址都可读可写**（写未定义的 0x7FF 也合法）。
  8. 计时器中断在**取指之前**判定：被打断的那条指令**完全不执行**（不写寄存器、
     不访存），`mepc` 指向它，`mret` 后重新执行。
  9. `mret`：`pc ← mepc`，`MIE ← MPIE`，**MPIE 本身不清**。
 10. trap 只改 `mstatus` 的 bit3（←0）与 bit7（←原 MIE），其余位原样保留。
 11. 停机（`mtvec==0` 且取 trap）那一拍：`pc` 不变、`next_pc == pc`、`halted=1`。
     停机之后再 `step`，返回的是一个全零状态（不是停机那一刻的状态）——
     所以驱动器必须在 `halted` 处停下，不能多走。
 12. **译码呈现不设合法性闸门**：`instruction_fields.opcode_name`/`format`、
     `immediate`、`control_signals` 四项只按 **opcode（+funct3/funct7）** 产生，
     与「这条指令是否合法」无关。例：BRANCH funct3=2（保留）虽属非法指令，
     呈现的仍是 `opcode_name="BRANCH"`、`format="B"`、`branch=1`、`alu_op="SUB"`、
     `immediate` 按 B 型位域解出。合法性的唯一后果是「取陷阱、不提交」
     （外加下面一条把数据通路呈现清零）。
     —— 扫描在 `probe.py` 的 **X 节**（252 个组合 / 121 个取陷阱），
     它同时会拿本模型当判据逐组合比这四项；跑 `python probe.py` 复核。
     独立性说明：这张**合法性表**是直接读后端得来的（本模型没参与），
     但「四项在非法组合上长什么样」的规则本就源于同一批实测，那次比对只能**防漂移**，
     不构成对后端的独立验证 —— 独立验证靠 run.py 的语料。
 13. **数据通路呈现的清零闸门**：`reg_reads.*.index/value`、`writeback.reg_index`、
     `alu.{op1,op2,result,zero,less}`、`branch.target_addr` 这四项在
     **非法指令陷阱**与**计时器中断**这两类拍上被**整体清零**
     （note：`alu.result=0` 而 `alu.zero=false`，两者不同步，照抄实测值）。
     `ecall`/`ebreak` 陷阱**不清零**——它们是合法指令，数据通路照常算出 0。
 14. `trap` 块的字段是**本拍信号**，不是 CSR 内容：非陷阱拍上
     `trap.mepc == trap.mtval == 0`，即使 `csr.mepc` 已经写着上次陷阱的地址。
     要读 CSR 真值得看 `state["csr"]`。

==============================================================================
呈现字段说明
==============================================================================
`cycle_state` 里有一部分字段是**微架构呈现**（ALU 操作数、控制信号、写回来源），
供前端画数据通路用。它们不是体系结构状态，规范里没有；本模型按「数据通路的
结构 + probe.py 的实测」复现，属于 [B]/[C] 档。体系结构状态（regfile / memory /
pc / CSR）是 [A] 档，两者都要逐字段比对——呈现字段错了，学生看到的电路就是错的。
"""

MASK32 = 0xFFFFFFFF
SEXT = {}


def _sx(value, bits):
    """符号扩展：把 value 的低 bits 位当作有符号数，返回 32 位无符号"""
    value &= (1 << bits) - 1
    if value & (1 << (bits - 1)):
        value -= (1 << bits)
    return value & MASK32


def _signed(v):
    v &= MASK32
    return v - (1 << 32) if v & 0x80000000 else v


def hx(v):
    return "0x%08x" % (v & MASK32)


# ---------------------------------------------------------------------------
# 指令类别（规范 opcode 表；非法指令记为 None）
# ---------------------------------------------------------------------------
LUI, AUIPC, JAL, JALR = "LUI", "AUIPC", "JAL", "JALR"
BRANCH, LOAD, STORE = "BRANCH", "LOAD", "STORE"
OPIMM, OP, MISC, SYSTEM = "OP-IMM", "OP", "MISC-MEM", "SYSTEM"

FORMAT = {LUI: "U", AUIPC: "U", JAL: "J", JALR: "I", BRANCH: "B",
          LOAD: "I", STORE: "S", OPIMM: "I", OP: "R", MISC: "I", SYSTEM: "I"}

# 每个 opcode 合法的 funct3（规范 opcode 表；其余取值属于「保留」⇒ 非法指令）
LEGAL_F3 = {
    JALR:   {0b000},
    LOAD:   {0b000, 0b001, 0b010, 0b100, 0b101},
    STORE:  {0b000, 0b001, 0b010},
    BRANCH: {0b000, 0b001, 0b100, 0b101, 0b110, 0b111},
    OPIMM:  {0b000, 0b001, 0b010, 0b011, 0b100, 0b101, 0b110, 0b111},
    OP:     {0b000, 0b001, 0b010, 0b011, 0b100, 0b101, 0b110, 0b111},
    MISC:   {0b000, 0b001},
    SYSTEM: {0b000, 0b001, 0b010, 0b011, 0b101, 0b110, 0b111},
}

# OP-IMM 里 slli/srli/srai 是 shamt 型：RV32 只有 5 位 shamt，funct7 必须是 0x00/0x20。
# 其余 OP-IMM 的 funct7 就是立即数高 7 位，取值自由，**不能**一起卡。
SHIFT_F7 = {0b001: {0x00}, 0b101: {0x00, 0x20}}

# OP 的合法 funct7：0x00（八条）与 0x20（仅 sub/sra）
R_F7 = {(0x00, 0b000), (0x00, 0b001), (0x00, 0b010), (0x00, 0b011), (0x00, 0b100),
        (0x00, 0b101), (0x00, 0b110), (0x00, 0b111), (0x20, 0b000), (0x20, 0b101)}

OP_ALU = {
    (0x00, 0b000): ("ADD", "add"), (0x20, 0b000): ("SUB", "sub"),
    (0x00, 0b001): ("SLL", "sll"), (0x00, 0b010): ("SLT", "slt"),
    (0x00, 0b011): ("SLTU", "sltu"), (0x00, 0b100): ("XOR", "xor"),
    (0x00, 0b101): ("SRL", "srl"), (0x20, 0b101): ("SRA", "sra"),
    (0x00, 0b110): ("OR", "or"), (0x00, 0b111): ("AND", "and"),
}
IMM_ALU = {0b000: ("ADD", "addi"), 0b010: ("SLT", "slti"), 0b011: ("SLTU", "sltiu"),
           0b100: ("XOR", "xori"), 0b110: ("OR", "ori"), 0b111: ("AND", "andi"),
           0b001: ("SLL", "slli"), 0b101: (None, None)}   # 101 由 funct7 决定 SRL/SRA
BRANCH_MN = {0b000: "beq", 0b001: "bne", 0b100: "blt",
             0b101: "bge", 0b110: "bltu", 0b111: "bgeu"}
LOAD_MN = {0b000: "lb", 0b001: "lh", 0b010: "lw", 0b100: "lbu", 0b101: "lhu"}
STORE_MN = {0b000: "sb", 0b001: "sh", 0b010: "sw"}

OPC = {0b0110111: LUI, 0b0010111: AUIPC, 0b1101111: JAL, 0b1100111: JALR,
       0b1100011: BRANCH, 0b0000011: LOAD, 0b0100011: STORE,
       0b0010011: OPIMM, 0b0110011: OP, 0b0001111: MISC, 0b1110011: SYSTEM}

# CSR 地址（规范 + 本项目自定义，见 docs/DEVELOPMENT.md）
CSR_MSTATUS, CSR_MIE, CSR_MTVEC = 0x300, 0x304, 0x305
CSR_MSCRATCH, CSR_MEPC, CSR_MCAUSE, CSR_MTVAL, CSR_MIP = 0x340, 0x341, 0x342, 0x343, 0x344
CSR_MTIMECMP = 0x780                    # ★ 本项目自定义
CSR_RO = {0xC00, 0xC01, 0xC02}          # cycle / time / instret —— 只读

IRQ_TIMER = 0x80000007
CAUSE_ILLEGAL, CAUSE_EBREAK, CAUSE_ECALL = 2, 3, 11


class Instr:
    """一条已解码的指令：原始位域 + **族** + 合法类别（None 表示非法）

    `family` 与 `cls` 必须分开，这一点是实测逼出来的（见文件头 [C] 12）：
    后端的译码呈现只看 opcode，不看合法性，所以「保留的 funct3」也得知道
    自己属于哪一族，才能复现它给出的 opcode_name / format / immediate / 控制信号。
    """

    __slots__ = ("word", "opcode", "rd", "funct3", "rs1", "rs2", "funct7",
                 "family", "cls")

    def __init__(self, word):
        self.word = word & MASK32
        self.opcode = word & 0x7F
        self.rd = (word >> 7) & 0x1F
        self.funct3 = (word >> 12) & 0x7
        self.rs1 = (word >> 15) & 0x1F
        self.rs2 = (word >> 20) & 0x1F
        self.funct7 = (word >> 25) & 0x7F
        self.family = OPC.get(self.opcode)     # 只看 opcode，不管合不合法
        self.cls = self._classify()            # 合法才是族名，否则 None

    def _classify(self):
        """按规范判定指令类别；返回 None 表示非法指令。
        这里就是「非法指令判定」的独立实现——上一轮修掉的三个后端 bug
        （R 型不看 funct7、移位不看 funct7、非法编码的显示文本）都出在这一段。"""
        cls = self.family
        if cls is None:
            return None
        if cls in (LUI, AUIPC, JAL):
            return cls                      # 这三个没有 funct3 字段
        if self.funct3 not in LEGAL_F3[cls]:
            return None
        if cls == OPIMM and self.funct3 in SHIFT_F7:
            if self.funct7 not in SHIFT_F7[self.funct3]:
                return None                 # 保留的 shamt 编码
        if cls == OP and (self.funct7, self.funct3) not in R_F7:
            return None                     # 含 RV32M 的 funct7=0x01
        if cls == SYSTEM and self.funct3 == 0b000:
            # ECALL / EBREAK / MRET 是三个**整字**编码，rd/rs1/imm 都不许乱填
            if self.word not in (0x00000073, 0x00100073, 0x30200073):
                return None
        return cls

    @property
    def mnemonic(self):
        """只用于报错信息，不参与比对（文本格式由后端自选）"""
        c, f3 = self.cls, self.funct3
        if c is None:
            return ".word " + hx(self.word)
        if c in (LUI, AUIPC, JAL):
            return {LUI: "lui", AUIPC: "auipc", JAL: "jal"}[c]
        if c == JALR:
            return "jalr"
        if c == BRANCH:
            return BRANCH_MN[f3]
        if c == LOAD:
            return LOAD_MN[f3]
        if c == STORE:
            return STORE_MN[f3]
        if c == OPIMM:
            return IMM_ALU[f3][1] or ("srai" if self.funct7 == 0x20 else "srli")
        if c == OP:
            return OP_ALU[(self.funct7, f3)][1]
        if c == MISC:
            return "fence" if f3 == 0b000 else "fence.i"
        if c == SYSTEM:
            if self.word == 0x00000073:
                return "ecall"
            if self.word == 0x00100073:
                return "ebreak"
            if self.word == 0x30200073:
                return "mret"
            return {0b001: "csrrw", 0b010: "csrrs", 0b011: "csrrc",
                    0b101: "csrrwi", 0b110: "csrrsi", 0b111: "csrrci"}[f3]
        return "?"

    @property
    def immediate(self):
        """按格式重组立即数（规范 §2.3 的位域表），结果取**有符号**解释

        [实测] 后端的 `immediate` 是有符号 32 位整数（lui 0xFFFFF → -4096），
        不是无符号值；状态流里 `pc`/`next_pc`/`memory.addr` 那些才是十六进制字符串。
        """
        return _signed(self.imm_u)

    @property
    def imm_u(self):
        """立即数的**无符号** 32 位形式。

        [实测] 后端两套口径并存，不要混：
          - `immediate` 字段          → 有符号（lui 0xFFFFF → -4096）
          - `alu.op1/op2/result`、`writeback.data` → 无符号（同一条 → 0xFFFFF000）
        """
        return self._immediate_u32()

    def _immediate_u32(self):
        """按**族**（不是合法性）重组立即数 —— 见文件头 [C] 12"""
        w, c = self.word, self.family
        if c in (LUI, AUIPC):
            return (w & 0xFFFFF000) & MASK32
        if c == JAL:
            imm = ((w >> 31) & 1) << 20 | ((w >> 12) & 0xFF) << 12 | \
                  ((w >> 20) & 1) << 11 | ((w >> 21) & 0x3FF) << 1
            return _sx(imm, 21)
        if c == OPIMM and self.funct3 in (0b001, 0b101):
            # [实测] **合法**的移位（slli/srli/srai）后端给的是 shamt，不是原始的
            # imm[11:0]：srai 的 0x400 按 I 型解出来是 1024，后端给 31。
            # 但**非法**的移位编码（保留的 funct7）后端反而给原始 imm[11:0]
            # ——扫描实测：slli-funct7=0x20 给 1030（=0x406），不是 shamt 6。
            if self.cls == OPIMM:
                return self.rs2
            return _sx(w >> 20, 12)
        if c in (SYSTEM, MISC):
            # [实测] SYSTEM 的 immediate 恒为 0（CSR 地址不走立即数通路）；
            # MISC-MEM 也恒为 0 —— fence 的 fm/pred/succ 那几位后端根本不取
            # （实测 imm 字段填 0x0FF 的 fence，immediate 仍是 0）。
            return 0
        if c == JALR or c == LOAD or c == OPIMM:
            return _sx(w >> 20, 12)
        if c == STORE:
            imm = ((w >> 25) & 0x7F) << 5 | ((w >> 7) & 0x1F)
            return _sx(imm, 12)
        if c == BRANCH:
            imm = ((w >> 31) & 1) << 12 | ((w >> 7) & 1) << 11 | \
                  ((w >> 25) & 0x3F) << 5 | ((w >> 8) & 0xF) << 1
            return _sx(imm, 13)
        if c == OP:
            return 0        # [实测] R 型没有立即数，后端输出 0（不是 rs2/funct7 位域）
        # opcode 都不认识（family is None）：后端恒给 0
        # （实测 `.word 0xFFFFFFFF` 的 immediate 是 0，不是按 I 型解出的 -1）
        return 0


class RefModel:
    """单周期 RV32I。每个 step() = 一拍 = 一条指令（或一次 trap）。"""

    MEM_BASE = 0x80000000
    MEM_SIZE = 128 * 1024

    def __init__(self, words, entry=None):
        self.regs = [0] * 32
        self.mem = bytearray(self.MEM_SIZE)
        base = self.MEM_BASE
        for i, w in enumerate(words):
            for k in range(4):
                off = i * 4 + k
                if off < self.MEM_SIZE:
                    self.mem[off] = (w >> (8 * k)) & 0xFF
        self.pc = self.MEM_BASE if entry is None else entry
        self.csr = {}
        self.cycle = 0
        self.halted = False

    # ---------------- 内存 ----------------
    def _in_range(self, addr):
        return self.MEM_BASE <= addr < self.MEM_BASE + self.MEM_SIZE

    def read_byte(self, addr):
        return self.mem[addr - self.MEM_BASE] if self._in_range(addr) else 0

    def write_byte(self, addr, val):
        if self._in_range(addr):
            self.mem[addr - self.MEM_BASE] = val & 0xFF

    def read_bytes(self, addr, n):
        """非对齐也照读——[实测] 逐字节访问，不报异常"""
        return sum(self.read_byte(addr + i) << (8 * i) for i in range(n))

    def write_bytes(self, addr, val, n):
        for i in range(n):
            self.write_byte(addr + i, (val >> (8 * i)) & 0xFF)

    def fetch(self, addr):
        return self.read_bytes(addr, 4)

    # ---------------- CSR ----------------
    def csr_read(self, addr):
        if addr in CSR_RO:
            return self.cycle & MASK32       # [实测] 三个只读计数都等于周期数
        return self.csr.get(addr, 0) & MASK32

    def csr_write(self, addr, val):
        if addr in CSR_RO:
            return                            # [实测] 只读，写被忽略
        self.csr[addr] = val & MASK32         # [实测] 4129 项数组，任意地址可写

    # ---------------- 中断 ----------------
    def _timer_irq(self):
        """三道门：mtime >= mtimecmp、mie.MTIE、mstatus.MIE —— [B] 本项目文档"""
        if self.cycle < self.csr.get(CSR_MTIMECMP, 0):
            return False
        if not (self.csr.get(CSR_MIE, 0) & 0x80):
            return False
        return bool(self.csr.get(CSR_MSTATUS, 0) & 0x08)

    def _take_trap(self, pc0, cause, mtval, ins, irq=False, ecall=False, ebreak=False):
        """共用的 trap 流程：写 mepc/mcause/mtval、关总闸，再决定去哪 —— [B] 文档"""
        self.csr_write(CSR_MEPC, pc0)
        self.csr_write(CSR_MCAUSE, cause)
        self.csr_write(CSR_MTVAL, mtval)
        ms = self.csr.get(CSR_MSTATUS, 0)
        ms = (ms & ~0x08) | ((ms >> 3) & 1) << 7      # MPIE ← MIE，MIE ← 0
        self.csr_write(CSR_MSTATUS, ms)
        mtvec = self.csr.get(CSR_MTVEC, 0)
        if mtvec == 0:
            self.halted = True                        # [B] 停机兜底
            next_pc = pc0
        else:
            next_pc = mtvec
        st = self._base_state(pc0, ins)
        st["next_pc"] = hx(next_pc)
        st["halted"] = self.halted
        st["trap"] = {"taken": True, "cause": cause,
                      "mepc": hx(self.csr_read(CSR_MEPC)),
                      "mtval": hx(self.csr_read(CSR_MTVAL))}
        st["csr"] = self._csr_dump()
        # [实测] 陷阱拍的 control_signals 仍是「取到的那条指令」的译码：
        # 非法指令拍给出它那一族的信号（BRANCH funct3=2 → branch=1/SUB），
        # 中断拍给出被打断指令的完整译码，ecall/ebreak 拍给出 SYSTEM 的全灭。
        st["control_signals"] = self._control_decode(ins)[0]

        # 陷阱拍的数据通路呈现 —— 见文件头 [C] 13。两类陷阱对**呈现**的处理不同：
        #   非法指令 / 异步中断：整个数据通路呈现清零（这类拍没有「执行」可言）
        #   ecall / ebreak：**不清零**（合法指令，数据通路照常跑，算出 0）
        # 而 instruction_fields / immediate / control_signals 两类都不清零，
        # 永远是「取到的那条指令」的译码（[C] 12）。
        if irq or cause == CAUSE_ILLEGAL:
            st["reg_reads"] = {"rs1": {"index": 0, "value": 0},
                               "rs2": {"index": 0, "value": 0}}
            st["writeback"] = {"active": False, "reg_index": 0, "data": 0,
                               "source": "ALU"}
            # 注意 zero 并不跟着 result 走：result=0 而 zero=false，照抄实测
            st["alu"] = {"op1": 0, "op2": 0, "result": 0, "zero": False, "less": False}
            st["branch"] = {"taken": False, "target_addr": hx(0)}
        else:
            st["writeback"] = {"active": False, "reg_index": ins.rd, "data": 0,
                               "source": "ALU"}
        self.pc = next_pc
        self.cycle += 1
        return st

    # ---------------- 状态快照 ----------------
    def _csr_dump(self):
        return {"mtvec": hx(self.csr.get(CSR_MTVEC, 0)),
                "mepc": hx(self.csr.get(CSR_MEPC, 0)),
                "mcause": hx(self.csr.get(CSR_MCAUSE, 0)),
                "mstatus": hx(self.csr.get(CSR_MSTATUS, 0)),
                "mie": hx(self.csr.get(CSR_MIE, 0)),
                "mip": hx(self.csr.get(CSR_MIP, 0)),
                "mtime": hx(self.cycle + 1),       # [实测] dump 的是本拍结束后的值
                "mtimecmp": hx(self.csr.get(CSR_MTIMECMP, 0))}

    def _base_state(self, pc0, ins):
        w = ins.word
        return {
            "pc": hx(pc0),
            "next_pc": hx(pc0 + 4),
            "instruction": hx(w),
            "disassembly": "",          # 文本格式由后端自选，差分测试不比这一项
            "instruction_fields": {
                # [实测] 后端把 "0b" 前缀也放进字符串里（不是纯二进制）
                "opcode": "0b" + format(ins.opcode, "07b"),
                # [实测] 按族取名，与合法性无关（保留 funct3 也照样报族名）
                "opcode_name": ins.family if ins.family else "UNKNOWN",
                "rd": ins.rd,
                "funct3": "0b" + format(ins.funct3, "03b"),
                "rs1": ins.rs1,
                "rs2": ins.rs2,
                "funct7": "0b" + format(ins.funct7, "07b"),
                "format": FORMAT.get(ins.family, "?"),
            },
            "immediate": ins.immediate,
            "control_signals": {"reg_write": False, "alu_src": False, "mem_write": False,
                                "mem_read": False, "mem_to_reg": False, "branch": False,
                                "jump": False, "is_auipc": False, "is_lui": False,
                                "is_jalr": False, "alu_op": "ADD"},
            "reg_reads": {"rs1": {"index": ins.rs1, "value": self.regs[ins.rs1]},
                          "rs2": {"index": ins.rs2, "value": self.regs[ins.rs2]}},
            "alu": {"op1": 0, "op2": 0, "result": 0, "zero": True, "less": False},
            "memory": {"addr": hx(0), "read_data": hx(0), "write_data": hx(0),
                       "access_type": "NONE", "access_size": 0},
            "writeback": {"active": False, "reg_index": ins.rd, "data": 0, "source": "ALU"},
            "branch": {"taken": False, "target_addr": hx(pc0 + 4)},
            "csr": self._csr_dump(),
            # [实测] trap 块是**本拍信号**，不是 CSR 内容：非陷阱拍一律 0，
            # 哪怕 csr.mepc 里还留着上次陷阱的地址。
            "trap": {"taken": False, "cause": 0, "mepc": hx(0), "mtval": hx(0)},
            "regfile": list(self.regs),
            "halted": self.halted,
        }

    # ---------------- 译码（控制器） ----------------
    @staticmethod
    def _control_decode(ins):
        """按 **opcode + funct3/funct7** 产生控制信号 —— **不看合法性**（[C] 12）。

        非法编码也照样译码：BRANCH funct3=2 给出 `branch=1, alu_op="SUB"`，
        LOAD funct3=3 给出 `reg_write/mem_read/mem_to_reg=1`，等等。全组合扫描实测。

        [实测] alu.op1 = muxa 的输出，alu.op2 = muxb 的输出，**两者都**按
        alu_src 选路：alu_src=0 时 op2 取 regs[rs2]，而不是立即数。
        CSR 指令的 alu_src=0，它的 "rs2" 是 CSR 地址的低 5 位
        （csrrw zero, mtvec, t0 的 rs2 字段 = 0x305 & 0x1F = 5 = t0）。

        返回 (control_signals, alu_op, op1_src)，op1_src ∈ {"rs1","imm","pc"}。
        """
        c = {"reg_write": False, "alu_src": True, "mem_write": False,
             "mem_read": False, "mem_to_reg": False, "branch": False,
             "jump": False, "is_auipc": False, "is_lui": False,
             "is_jalr": False, "alu_op": "ADD"}
        alu_op = "ADD"
        op1_src = "rs1"        # muxa 的默认选路：寄存器堆读出值
        fam = ins.family

        if fam == LUI:
            c["reg_write"], c["is_lui"] = True, True
            alu_op, op1_src = "PASS", "imm"                # muxa0 把 imm 送上 op1
        elif fam == AUIPC:
            c["reg_write"], c["is_auipc"] = True, True
            alu_op, op1_src = "ADD", "pc"                  # ADD(pc, imm)
        elif fam == JAL:
            c["reg_write"], c["jump"] = True, True
            alu_op = "PASS"
        elif fam == JALR:
            c["reg_write"], c["is_jalr"] = True, True
        elif fam == BRANCH:
            # [实测] 分支的 ALU 操作按 funct3 分三档：相等比较（0/1）走减法，
            # 有符号比较（4/5）走 SLT，无符号比较（6/7）走 SLTU；保留的
            # funct3=2/3 落在默认档，也是 SUB（全组合扫描实测）。
            c["alu_src"], c["branch"] = False, True
            alu_op = {0b100: "SLT", 0b101: "SLT",
                      0b110: "SLTU", 0b111: "SLTU"}.get(ins.funct3, "SUB")
        elif fam == LOAD:
            c["reg_write"], c["mem_read"], c["mem_to_reg"] = True, True, True
        elif fam == STORE:
            c["reg_write"], c["alu_src"], c["mem_write"] = False, True, True
        elif fam == OPIMM:
            c["reg_write"] = True
            if ins.funct3 == 0b101:
                alu_op = "SRA" if ins.funct7 == 0x20 else "SRL"
            else:
                alu_op = IMM_ALU.get(ins.funct3, ("ADD", None))[0] or "ADD"
        elif fam == OP:
            c["reg_write"], c["alu_src"] = True, False
            # 合法组合查表；非法 funct7 落回「按 funct3 猜」，实测如此
            alu_op = OP_ALU.get((ins.funct7, ins.funct3), (None, None))[0] or \
                {0b000: "ADD", 0b001: "SLL", 0b010: "SLT", 0b011: "SLTU",
                 0b100: "XOR", 0b101: "SRL", 0b110: "OR", 0b111: "AND"}[ins.funct3]
        elif fam == MISC:
            c["alu_src"] = False              # fence：什么都不做
        elif fam == SYSTEM:
            c["alu_src"] = False
        else:
            c["alu_src"] = False              # opcode 都不认识：全灭，alu_op 保持 ADD
        c["alu_op"] = alu_op
        return c, alu_op, op1_src

    # ---------------- 主循环 ----------------
    def step(self):
        pc0 = self.pc
        ins = Instr(self.fetch(pc0))

        # (1) 异步中断：取指之前判定，被打断的指令完全不执行 —— [实测] 8
        if self._timer_irq():
            return self._take_trap(pc0, IRQ_TIMER, 0, ins, irq=True)

        # (2) 同步异常
        if ins.cls is None:
            return self._take_trap(pc0, CAUSE_ILLEGAL, ins.word, ins)
        if ins.word == 0x00000073:
            return self._take_trap(pc0, CAUSE_ECALL, 0, ins, ecall=True)
        if ins.word == 0x00100073:
            return self._take_trap(pc0, CAUSE_EBREAK, 0, ins, ebreak=True)

        st = self._base_state(pc0, ins)
        c, alu_op, op1_src = self._control_decode(ins)
        st["control_signals"] = c

        # 注意 mret **不在这里提前返回**：[实测] 它那一拍照样走完 ALU 与写回 MUX
        # （ADD(regs[0], regs[rs2])，rs2 就是 mret 整字里那几位），只是 next_pc 取自 mepc。
        if ins.cls == SYSTEM and not _is_mret(ins):
            # [实测] CSR 指令的寄存器写使能与写回 active 都由 rd != 0 决定
            #（csrrw x0, mstatus, x2 确实改了 CSR，但**不写寄存器**）
            c["reg_write"] = ins.rd != 0
            old = self.csr_read(_csr_addr(ins))
            imm_form = ins.funct3 >= 0b100
            src = (ins.rs1 & 0x1F) if imm_form else self.regs[ins.rs1]
            f3 = ins.funct3 & 0b011
            if f3 == 0b001:                   # csrrw / csrrwi：总是写
                self.csr_write(_csr_addr(ins), src)
            elif f3 == 0b010:                 # csrrs / csrrsi：rs1/zimm = 0 时不写
                if src != 0:
                    self.csr_write(_csr_addr(ins), old | src)
            elif f3 == 0b011:                 # csrrc / csrrci：rs1/zimm = 0 时不写
                if src != 0:
                    self.csr_write(_csr_addr(ins), old & ~src)
            st["writeback"] = {"active": ins.rd != 0, "reg_index": ins.rd,
                               "data": old, "source": "CSR"}
            st["csr"] = self._csr_dump()

        # ---- 第二遍：操作数选路 + ALU ----
        if op1_src == "imm":
            op1 = ins.imm_u
        elif op1_src == "pc":
            op1 = pc0
        else:
            op1 = self.regs[ins.rs1]
        op2 = ins.imm_u if c["alu_src"] else self.regs[ins.rs2]
        st["alu"] = self._alu(alu_op, op1, op2)
        c["alu_op"] = alu_op
        # [实测] 写回数据恒为写回 MUX 的输出，**即使 active=False 也照样有值**
        # （store/分支/fence 的 writeback.data 就是当拍的 ALU 结果，不是 0）
        if st["writeback"]["source"] == "ALU":
            st["writeback"]["data"] = st["alu"]["result"]

        # --- 访存 ---
        next_pc = pc0 + 4
        if ins.cls == LOAD:
            addr = st["alu"]["result"]
            size = {0b000: 1, 0b001: 2, 0b010: 4, 0b100: 1, 0b101: 2}[ins.funct3]
            raw = self.read_bytes(addr, size)
            val = {0b000: _sx(raw, 8), 0b001: _sx(raw, 16), 0b010: raw,
                   0b100: raw & 0xFF, 0b101: raw & 0xFFFF}[ins.funct3]
            # [实测] 读口的 read_data 是**扩展之后**的值（lb 读 0xFF 给 0xFFFFFFFF，
            # 不是 0x000000FF），也就是和同一拍的 writeback.data 恒等。
            st["memory"] = {"addr": hx(addr), "read_data": hx(val), "write_data": hx(0),
                            "access_type": "READ", "access_size": size}
            st["writeback"] = {"active": True, "reg_index": ins.rd,
                               "data": val, "source": "MEM"}
        elif ins.cls == STORE:
            addr, size = st["alu"]["result"], {0b000: 1, 0b001: 2, 0b010: 4}[ins.funct3]
            val = self.regs[ins.rs2]
            self.write_bytes(addr, val, size)      # 真正落盘时按宽度截断
            # [实测] 但**呈现**的 write_data 是 rs2 的完整 32 位，不按宽度截断：
            # sb 写 0x80FF7F01 时 write_data=0x80FF7F01 而 access_size=1。
            st["memory"] = {"addr": hx(addr), "read_data": hx(0),
                            "write_data": hx(val),
                            "access_type": "WRITE", "access_size": size}

        # --- 分支 ---
        if ins.cls == BRANCH:
            a, b = self.regs[ins.rs1], self.regs[ins.rs2]
            cond = {0b000: a == b, 0b001: a != b,
                    0b100: _signed(a) < _signed(b), 0b101: _signed(a) >= _signed(b),
                    0b110: a < b, 0b111: a >= b}[ins.funct3]
            if cond:
                next_pc = (pc0 + ins.immediate) & MASK32
        elif ins.cls == JAL:
            next_pc = (pc0 + ins.immediate) & MASK32
        elif ins.cls == JALR:
            next_pc = (self.regs[ins.rs1] + ins.immediate) & MASK32 & ~1
        elif _is_mret(ins):
            ms = self.csr.get(CSR_MSTATUS, 0)
            self.csr_write(CSR_MSTATUS, (ms & ~0x08) | ((ms >> 7) & 1) << 3)
            next_pc = self.csr_read(CSR_MEPC)

        # --- 写回 ---
        if ins.cls in (LUI, AUIPC, OPIMM, OP):
            st["writeback"] = {"active": ins.rd != 0, "reg_index": ins.rd,
                               "data": st["alu"]["result"], "source": "ALU"}
        elif ins.cls in (JAL, JALR):
            st["writeback"] = {"active": ins.rd != 0, "reg_index": ins.rd,
                               "data": (pc0 + 4) & MASK32, "source": "PC_PLUS_4"}

        # --- 分支信号（[实测]：taken = jump || is_jalr || (branch && 条件)，
        #     target_addr 恒等于 next_pc；**唯一的例外是 mret**）---
        if _is_mret(ins):
            # [实测] mret 拍的 target_addr 是 **pc+4**（pc4 加法器的输出），不是
            # next_pc(=mepc)。看着别扭，但实测如此：mepc=0x80000020 而
            # target_addr=0x80000120=pc+4。别按「target_addr 恒等于 next_pc」套。
            st["branch"] = {"taken": False, "target_addr": hx(pc0 + 4)}
        else:
            jump, jl = c["jump"], c["is_jalr"]
            taken_sig = jump or jl or (c["branch"] and next_pc != ((pc0 + 4) & MASK32))
            st["branch"] = {"taken": bool(taken_sig), "target_addr": hx(next_pc)}

        # --- 提交 ---
        wb = st["writeback"]
        if wb["active"] and wb["reg_index"] != 0:
            self.regs[wb["reg_index"]] = wb["data"] & MASK32
        self.regs[0] = 0
        st["regfile"] = list(self.regs)
        st["next_pc"] = hx(next_pc)
        st["csr"] = self._csr_dump()
        st["trap"] = {"taken": False, "cause": 0, "mepc": hx(0), "mtval": hx(0)}
        self.pc = next_pc
        self.cycle += 1
        return st

    @staticmethod
    def _alu(op, a, b):
        a, b = a & MASK32, b & MASK32
        if op == "ADD":
            r = (a + b) & MASK32
        elif op == "SUB":
            r = (a - b) & MASK32
        elif op == "SLL":
            r = (a << (b & 0x1F)) & MASK32
        elif op == "SRL":
            r = a >> (b & 0x1F)
        elif op == "SRA":
            r = (_signed(a) >> (b & 0x1F)) & MASK32
        elif op == "SLT":
            r = 1 if _signed(a) < _signed(b) else 0
        elif op == "SLTU":
            r = 1 if a < b else 0
        elif op == "XOR":
            r = a ^ b
        elif op == "OR":
            r = a | b
        elif op == "AND":
            r = a & b
        elif op == "PASS":
            r = a
        else:
            r = a
        return {"op1": a, "op2": b, "result": r, "zero": r == 0, "less": bool(r & 1)}


def _csr_addr(ins):
    """CSR 指令的 CSR 地址 = 指令的 imm[11:0] 字段（funct3>=100 时它是 zimm）"""
    return (ins.word >> 20) & 0xFFF


def _is_mret(ins):
    """mret 是**整字**编码 0x30200073，不能只看 opcode+funct3（那样 ebreak 也会中）"""
    return ins.word == 0x30200073
