<script setup lang="ts">
import { computed } from 'vue'
import { useSimulatorStore } from '@/stores/simulator'
import { useWaveStore } from '@/stores/wave'
import { signalMeaning } from '@/utils/formatters'

const sim = useSimulatorStore()
const wave = useWaveStore()

const st = computed(() => sim.cycleState)

// 卡片按波次开门：信号还没传到那个部件，那张卡片就先不出现。
// 门是「按卡片」不是「按字段」——40 来个字段逐个标波次必然漂移，而且学生
// 看的是「这一栏到了没有」，不是「这个比特到了没有」。映射见 datapathWave.ts 的 gateOf()。
const g = computed(() => wave.gates)

/**
 * CSR 寄存器组本周期到底有没有被用到。
 *
 * 直接问图——图上亮着就意味着用到了，这样面板和图上永远不会各说各话。
 * 不能只看 g.csr：gateOf 的 open() 在「本周期没用到这个部件」时按设计返回「开」
 * （宁可多显示也不要误关），所以必须再加一道「到底用没用」。
 * 别的卡片不需要这一道，因为它们的 v-if 本来就带着自己的「用没用」条件
 * （访存看 access_type、写回看 writeback.active…）；只有 CSR 那张没有，
 * 因为后端每个周期都发 csr 快照，st.csr 永远为真。
 */
const csrUsed = computed(() => wave.raw.modules.has('csr'))

// 控制信号列表（键 + 中文说明）
const signalKeys = computed(() => {
  const cs = st.value?.control_signals
  if (!cs) return []
  const items: Array<{ key: string; label: string; value: boolean | string; meaning: string }> = []
  const boolMap: Array<[string, string]> = [
    ['reg_write', 'RegWrite'],
    ['alu_src', 'ALUSrc'],
    ['mem_write', 'MemWrite'],
    ['mem_read', 'MemRead'],
    ['mem_to_reg', 'MemtoReg'],
    ['branch', 'Branch'],
    ['jump', 'Jump'],
    ['is_auipc', 'AUIPC'],
    ['is_lui', 'LUI'],
    ['is_jalr', 'JALR'],
  ]
  for (const [k, label] of boolMap) {
    items.push({ key: k, label, value: cs[k as keyof typeof cs] as boolean, meaning: signalMeaning(k) })
  }
  items.push({ key: 'alu_op', label: 'ALUOp', value: cs.alu_op, meaning: signalMeaning('alu_op') })
  return items
})

function chipClass(v: boolean | string) {
  if (typeof v === 'boolean') return v ? 'bg-green-100 text-green-700 border-green-300' : 'bg-slate-100 text-slate-400 border-slate-200'
  return 'bg-blue-100 text-blue-700 border-blue-300'
}
</script>

<template>
  <div class="p-3 space-y-3">
    <!-- 当前指令：取指波（imem）到了才显示 -->
    <div v-if="st && g.fetch" class="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div class="text-[10px] font-semibold text-slate-400 mb-1.5">当前指令</div>
      <div class="flex items-center justify-between mb-1">
        <span class="font-mono text-sm text-slate-800 font-semibold">{{ st.disassembly }}</span>
        <span class="font-mono text-xs text-slate-400">{{ st.pc }}</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="font-mono text-xs text-blue-600">{{ st.instruction }}</span>
        <span class="text-[10px] text-slate-400">
          {{ st.instruction_fields.opcode_name }} · {{ st.instruction_fields.format }} 型
        </span>
      </div>
      <div class="mt-2 grid grid-cols-4 gap-1 text-center font-mono text-[10px]">
        <div class="rounded bg-white border border-slate-200 py-1">
          <div class="text-slate-400">rd</div>
          <div class="text-slate-700 font-semibold">{{ st.instruction_fields.rd ? `x${st.instruction_fields.rd}` : '—' }}</div>
        </div>
        <!-- rs1 / rs2 的值要等寄存器堆那一波才真正读出来。这里用「变淡」而不是
             整格 v-if：四格是一行网格，抽掉两格会让整行跳一下。 -->
        <div class="rounded bg-white border border-slate-200 py-1 transition-opacity" :class="g.regRead ? '' : 'opacity-25'">
          <div class="text-slate-400">rs1</div>
          <div class="text-slate-700 font-semibold">{{ st.reg_reads.rs1.value !== undefined ? `x${st.reg_reads.rs1.index}` : '—' }}</div>
        </div>
        <div class="rounded bg-white border border-slate-200 py-1 transition-opacity" :class="g.regRead ? '' : 'opacity-25'">
          <div class="text-slate-400">rs2</div>
          <div class="text-slate-700 font-semibold">{{ st.instruction_fields.format === 'R' || st.instruction_fields.format === 'S' || st.instruction_fields.format === 'B' ? `x${st.reg_reads.rs2.index}` : '—' }}</div>
        </div>
        <div class="rounded bg-white border border-slate-200 py-1">
          <div class="text-slate-400">imm</div>
          <div class="text-slate-700 font-semibold">{{ st.immediate }}</div>
        </div>
      </div>
    </div>
    <!-- 第 1 波只有 PC 在动，指令还没送到 imem，这时不该说「点击单步开始执行」 -->
    <div v-else-if="st" class="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-400 text-center">
      第 1 波：PC 送出取指地址，指令尚未取回
    </div>
    <div v-else class="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-400 text-center">
      点击「单步」开始执行，查看数据通路与信号
    </div>

    <!-- 控制信号：译码波（decoder）到了才显示 -->
    <div v-if="st && g.decode" class="rounded-xl border border-slate-200 p-3">
      <div class="text-[10px] font-semibold text-slate-400 mb-2">控制信号</div>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="s in signalKeys"
          :key="s.key"
          class="px-2 py-0.5 rounded-md border text-[11px] font-mono"
          :class="chipClass(s.value)"
          :title="s.meaning"
        >
          {{ s.label }}={{ typeof s.value === 'boolean' ? (s.value ? '1' : '0') : s.value }}
        </span>
      </div>
    </div>

    <!-- ALU：运算波到了才显示 -->
    <div v-if="st && g.alu" class="rounded-xl border border-slate-200 p-3">
      <div class="text-[10px] font-semibold text-slate-400 mb-2">ALU</div>
      <div class="grid grid-cols-2 gap-2 text-[11px] font-mono">
        <div class="flex justify-between"><span class="text-slate-400">op1</span><span>{{ st.alu.op1 }}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">op2</span><span>{{ st.alu.op2 }}</span></div>
        <div class="flex justify-between col-span-2"><span class="text-slate-400">操作</span><span class="text-orange-600 font-semibold">{{ st.control_signals.alu_op }}</span></div>
        <div class="flex justify-between col-span-2"><span class="text-slate-400">结果</span><span class="text-orange-700 font-semibold">{{ st.alu.result }}</span></div>
        <div class="flex justify-between col-span-2"><span class="text-slate-400">zero</span><span>{{ st.alu.zero }}</span></div>
      </div>
    </div>

    <!-- 访存：存储器的波到了才显示 -->
    <div v-if="st && g.mem && st.memory.access_type !== 'NONE'" class="rounded-xl border border-slate-200 p-3">
      <div class="text-[10px] font-semibold text-slate-400 mb-2">访存 ({{ st.memory.access_type === 'READ' ? '读' : '写' }})</div>
      <div class="grid grid-cols-2 gap-2 text-[11px] font-mono">
        <div class="flex justify-between"><span class="text-slate-400">地址</span><span>{{ st.memory.addr }}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">宽度</span><span>{{ st.memory.access_size }} B</span></div>
        <div v-if="st.memory.access_type === 'READ'" class="flex justify-between col-span-2"><span class="text-slate-400">读数据</span><span>{{ st.memory.read_data }}</span></div>
        <div v-else class="flex justify-between col-span-2"><span class="text-slate-400">写数据</span><span>{{ st.memory.write_data }}</span></div>
      </div>
    </div>

    <!-- 写回：写回多路器那一波到了才显示 -->
    <div v-if="st && g.wb && st.writeback.active" class="rounded-xl border border-slate-200 p-3">
      <div class="text-[10px] font-semibold text-slate-400 mb-2">写回</div>
      <div class="flex items-center gap-2 text-[11px] font-mono">
        <span class="text-slate-400">x{{ st.writeback.reg_index }}</span>
        <span class="text-slate-300">←</span>
        <span class="text-blue-700 font-semibold">{{ st.writeback.data }}</span>
        <span class="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">{{ st.writeback.source }}</span>
      </div>
    </div>

    <!-- 分支 / 跳转：比较器（taken）那一波到了才显示 -->
    <div v-if="st && g.branch && (st.control_signals.branch || st.control_signals.jump || st.control_signals.is_jalr)" class="rounded-xl border border-slate-200 p-3">
      <div class="text-[10px] font-semibold text-slate-400 mb-2">分支 / 跳转</div>
      <div class="flex items-center gap-2 text-[11px] font-mono">
        <span :class="st.branch.taken ? 'text-green-600 font-semibold' : 'text-slate-500'">
          {{ st.branch.taken ? '● 跳转' : '○ 不跳转' }}
        </span>
        <span class="ml-auto text-slate-400">目标</span>
        <span class="text-slate-700">{{ st.branch.target_addr }}</span>
      </div>
    </div>

    <!-- 中断 / 异常（后端每周期发 csr + trap）。
         先过「本周期真用到了 CSR 寄存器组」这一关——addi / lw / jal 这类指令
         压根不碰 CSR，整张卡就不该出现。
         过了之后再用两道波次门分开：横幅跟着 trapunit，8 个 CSR 值跟着 csr。 -->
    <div v-if="st && csrUsed && (g.csr || (st.trap.taken && g.trap))" class="rounded-xl border border-slate-200 p-3">
      <div class="text-[10px] font-semibold text-slate-400 mb-2">中断 / 异常</div>
      <!-- trap 发生那一拍的横幅（陷阱部件那一波到了才弹出） -->
      <div
        v-if="st.trap.taken && g.trap"
        class="mb-2 rounded-lg px-2.5 py-1.5 bg-red-50 border border-red-300 text-red-700 text-[11px] font-mono font-semibold"
      >
        ★ TRAP! cause=0x{{ st.trap.cause.toString(16) }}（跳转到 mtvec，返回点 mepc={{ st.trap.mepc }}）
      </div>
      <div v-if="g.csr" class="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono">
        <div class="flex justify-between"><span class="text-slate-400">mtvec</span><span>{{ st.csr.mtvec }}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">mepc</span><span>{{ st.csr.mepc }}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">mcause</span><span>{{ st.csr.mcause }}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">mstatus</span><span>{{ st.csr.mstatus }}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">mie</span><span>{{ st.csr.mie }}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">mip</span><span>{{ st.csr.mip }}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">mtime</span><span>{{ st.csr.mtime }}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">mtimecmp</span><span>{{ st.csr.mtimecmp }}</span></div>
      </div>
    </div>
  </div>
</template>
