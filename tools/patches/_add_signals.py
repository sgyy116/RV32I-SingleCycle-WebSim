# -*- coding: utf-8 -*-
"""
_add_signals.py —— 给 datapathLayout.json 的连线补 signal 字段。

【历史脚本，已执行过，不要再跑】这是「signal 字段是这么补上的」的存档记录：
它按 SIG 表整表重写 wires 的键序和 signal 值。当前 JSON 的 signal 字段与此表
一致（含后来新增的 w_dec_branch / w_dec_f3sel / w_dec_pol / w_alu_lt），
但真正生效的读取方是 frontend/src/data/datapathHighlight.ts 的 WIRE_SIGNAL。
若以后加线，改 WIRE_SIGNAL 与 JSON 即可，不必回来跑这个脚本。

signal 是纯元数据：标明这条线上跑的是后端 cycle_state 的哪个字段，供前端
高亮取值。几何自检和 preview.mjs 都不读它。

两种写法：
  state.xxx / state.control_signals.xxx  —— 后端 cycle_state 里真有这个字段，直接取
  derived:xxx                            —— 后端没有，前端按下面的口径推导

顺带把 wires 的键序统一成 id, from, to, kind, signal, label, points
（原来是 id, to, label, points, from, kind，很难读）。

幂等：重复跑只会把同样的值再写一遍。
"""
import io
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
P = os.path.join(ROOT, 'frontend', 'src', 'data', 'datapathLayout.json')

# 连线 id -> signal
SIG = {
    # ---- IF 取指：PC 出地址给指令存储器 ----
    'w_pc_imem':        'state.pc',
    'w_pc_add4':        'state.pc',
    'w_c4_add4':        None,                      # 常量 4，不随后端变
    'w_clk_pc':         None,                      # 全局时钟
    'w_clk_imem':       None,
    'w_clk_rf':         None,
    'w_clk_dmem':       None,
    'w_reset_pc':       None,
    'w_reset_rf':       None,

    # ---- PC 目标选择链（五选一，串成 pcmux1→6→5）----
    'w_add4_m1':        'derived:pc_plus_4',       # 后端不单独发 pc+4，前端用 pc 加常量 4
    'w_add4_m4':        'derived:pc_plus_4',
    'w_immadd_m4':      'derived:pc_imm',          # pcimmadder.out
    'w_immadd_m3':      'derived:pc_imm',
    'w_taken_m4':       'state.branch.taken',      # ★ 后端原来发字符串 "false"，已修成裸布尔
    'w_sel_m1':         'derived:pcsel',           # branch || jump || is_jalr
    'w_sel_m2':         'derived:jump_or_jalr',    # jump || is_jalr
    'w_sel_m3':         'state.control_signals.is_jalr',
    'w_dec_branch':     'state.control_signals.branch',
    # funct3 的两位直接决定 taken 取 ZF 还是 LT、要不要取反（见 rv_control.hpp 的 OP_BRANCH）
    'w_dec_f3sel':      'state.instruction_fields.funct3[2]',
    'w_dec_pol':        'state.instruction_fields.funct3[0]',
    'w_alu_zf':         'state.alu.zero',
    'w_alu_lt':         'state.alu.less',
    'w_m2_m1':          'derived:pc_next',
    'w_m3_m2':          'derived:pc_next',
    'w_m4_m2':          'derived:pc_next',
    'w_m1_m6':          'derived:pc_next',
    'w_m6_m5':          'derived:pc_next',
    'w_m5_pc':          'state.next_pc',
    'w_alu_jalr':       'state.alu.result',
    'w_jalr_m3':        'derived:alu_result_clean',  # ALU 结果 & ~1

    # ---- IF/ID：指令码送译码器 ----
    'w_imem_dec':       'state.instruction',

    # ---- ID 译码：读地址 / 写地址 / 写使能 ----
    'w_dec_ra1':        'state.instruction_fields.rs1',
    'w_dec_ra2':        'state.instruction_fields.rs2',
    'w_dec_wen':        'state.control_signals.reg_write',
    'w_dec_waddr':      'state.writeback.reg_index',

    # ---- 立即数生成 ----
    'w_imm_immadd':     'state.immediate',
    'w_imm_muxa0':      'state.immediate',
    'w_imm_muxb':       'state.immediate',

    # ---- 寄存器读 ----
    'w_rf_ma0':         'state.reg_reads.rs1.value',
    'w_rf_mb1':         'state.reg_reads.rs2.value',
    'w_rf_dmem':        'state.memory.write_data',   # store 的写数据

    # ---- EX：ALU 操作数与结果 ----
    'w_muxa0_muxa':     'state.alu.op1',
    'w_ma_alu':         'state.alu.op1',
    'w_mb_alu':         'state.alu.op2',
    'w_alu_dmem':       'state.alu.result',
    'w_alu_wb0':        'state.alu.result',
    'w_ctl_alusrc':     'state.control_signals.alu_src',
    'w_ctl_aluop':      'state.control_signals.alu_op',
    'w_ctl_auipc':      'state.control_signals.is_auipc',
    'w_ctl_islui':      'state.control_signals.is_lui',

    # ---- MEM：数据存储器 ----
    'w_ctl_sw':         'state.control_signals.mem_write',
    'w_dmem_wb0':       'state.memory.read_data',
    'w_ctl_memtoreg':   'state.control_signals.mem_to_reg',

    # ---- WB：写回链 ----
    'w_wb0_wb':         'state.writeback.data',
    'w_wb1_wb':         'derived:csr_old',           # writeback.data（source=="CSR" 时）
    'w_wb_rf':          'state.writeback.data',
    'w_ctl_link':       'derived:jump_or_jalr',

    # ---- 常量 0（写使能恒 0 / 数据恒 0）----
    'w_const0_d':       None,
    'w_const0_we':      None,

    # ---- trap / CSR 扩展区 ----
    'w_csr_irq':        'derived:csr_irq',           # mtime>=mtimecmp && mie.MTIE && mstatus.MIE
}

# 后端 cycle_state 里没有、必须在前端推导的字段，说明推导依据
SIGNAL_RULES = (
    "连线 signal 字段的取值口径：① 写成 state.xxx（对应后端 cycle_state 的字段路径）"
    "的，直接取后端值；② 写成 derived:xxx 的，后端没这个字段，前端从已有字段精确推导——"
    "pc_plus_4 = pc + 4；pc_imm = 分支/JAL 目标；pc_next = 本条指令最终写入 PC 的值；"
    "pcsel = branch||jump||is_jalr；jump_or_jalr = jump||is_jalr；alu_result_clean = "
    "alu.result & ~1（JALR）；csr_old = writeback.data 且 writeback.source=='CSR'；"
    "csr_irq = mtime>=mtimecmp 且 mie bit7(MTIE) 且 mstatus bit3(MIE)。"
    "③ signal 为 null 的表示这条线上是常量或全局时钟（clk/reset），不随后端状态变。"
    "注意图上的网络标签名 (net) 里 is_csr / is_mret / illegal / ecall / ebreak / csr_we / csr_addr "
    "也都不在 control_signals_t 里（那个结构体只有 11 个字段），高亮时同样按推导口径处理："
    "is_csr = writeback.source=='CSR'（rv_core.cpp:414）；"
    "ecall/ebreak/illegal = trap.taken 且 trap.cause 分别为 11/3/2（rv_core.cpp:381/385/273）；"
    "is_mret = instruction 整字 == 0x30200073（对齐 rv_disasm.cpp:192-197 的 "
    "funct3==0 && rd==0 && rs1==0 && inst>>20==0x302 四条判据，合起来就是整字相等。"
    "别用 0xFE007FFF 掩码，它清掉了 rs2 那几位，而 mret 的 rs2 恒为 2，会恒假）；"
    "csr_addr = instruction[31:20]；csr_we 镜像 rv_core.cpp:400-412 的 do_write 判据。"
)

NEW_TODO = (
    "尚未做：把 buildDatapathScene() 接进 Vue（components/datapath/DatapathView.vue），"
    "按 state 高亮激活的线与部件、并在线上浮当前值。signal 字段已补齐，是那一步的输入。"
)


def main():
    with io.open(P, encoding='utf-8') as f:
        L = json.load(f)

    ids = [w['id'] for w in L['wires']]
    missing = [i for i in ids if i not in SIG]
    extra = [k for k in SIG if k not in ids]
    if missing:
        raise SystemExit('这些连线还没定 signal：%s' % missing)
    if extra:
        raise SystemExit('SIG 里有 JSON 中不存在的连线 id：%s' % extra)

    # 统一键序，signal 排在 kind 后面
    ORDER = ['id', 'from', 'to', 'kind', 'signal', 'label', 'points']
    new_wires = []
    for w in L['wires']:
        nw = {}
        for k in ORDER:
            if k == 'signal':
                nw['signal'] = SIG[w['id']]
            elif k in w:
                nw[k] = w[k]
        for k in w:                      # 兜底：ORDER 里没列到的键原样带上
            if k not in nw:
                nw[k] = w[k]
        new_wires.append(nw)
    L['wires'] = new_wires

    L['_signal_rules'] = SIGNAL_RULES
    L['_todo'] = NEW_TODO

    # 保持 _comment / scale / canvas / modules / ports / wires / _* 的顶层顺序：
    # 重建一遍，把新增的 _signal_rules 放在 _wire_rules 后面
    TOP = ['_comment', 'scale', 'canvas', 'modules', 'ports', 'wires',
           '_signals', '_signal_rules', '_wire_rules', '_todo']
    out = {}
    for k in TOP:
        if k in L:
            out[k] = L[k]
    for k in L:
        if k not in out:
            out[k] = L[k]

    with io.open(P, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write('\n')

    n_dir = sum(1 for v in SIG.values() if v and not v.startswith('derived:'))
    n_der = sum(1 for v in SIG.values() if v and v.startswith('derived:'))
    n_non = sum(1 for v in SIG.values() if not v)
    print('已写入 %s' % P)
    print('  连线 %d 条：直取后端 %d / 前端推导 %d / 常量或时钟 %d'
          % (len(SIG), n_dir, n_der, n_non))


if __name__ == '__main__':
    main()
