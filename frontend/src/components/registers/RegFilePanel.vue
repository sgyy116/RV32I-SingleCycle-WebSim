<script setup lang="ts">
import { computed, h } from 'vue'
import { NDataTable } from 'naive-ui'
import { useSimulatorStore } from '@/stores/simulator'
import { useWaveStore } from '@/stores/wave'
import { regName } from '@/utils/formatters'
import type { DataTableColumns } from 'naive-ui'

const sim = useSimulatorStore()
const wave = useWaveStore()

/**
 * 写回的值「落进」寄存器堆了没有。
 *
 * 判据是**最后一波**，不是写回多路器那一波。两者对 jal / csrrw 这类指令不是一回事：
 * 它们的写回值（PC+4、CSR 旧值）很早就由多路器算出来了，wbmux 的波次可以排到第 4 波，
 * 但真正写进寄存器堆是在时钟沿，也就是整条指令的最后一波。
 * 按 wbmux 判，学生会看到 x1 从第 4 波起就带着新值杵在那儿不动。
 */
const wbLanded = computed(() => !sim.cycleState || wave.atEnd)

// 最近写回的目标寄存器（高亮）。值没落地就先不标蓝
const writtenReg = computed(() => {
  if (!wbLanded.value) return -1
  const wb = sim.cycleState?.writeback
  return wb?.active ? wb.reg_index : -1
})

/**
 * 显示哪一份寄存器堆。
 *
 * cycleState.regfile 是**写回之后**的快照。若在最后一波之前就照它显示，学生会在
 * 第 1 波看到值已经在寄存器里了，「落进去」的过程反而看不见。
 * 所以最后一波之前退回**上一周期**的快照：整条指令播放期间寄存器堆纹丝不动，
 * 到最后一波才「啪」地跳到新值。
 *
 * 历史索引为 0（没有上一拍）或正在翻历史时保持原样，不会倒退成空白。
 */
const shownRegs = computed(() => {
  const st = sim.cycleState
  if (!st) return null
  if (!wbLanded.value && sim.historyIndex > 0) {
    const prev = sim.stateHistory[sim.historyIndex - 1]
    if (prev?.regfile) return prev.regfile
  }
  return st.regfile
})

const rows = computed(() => {
  const regs = shownRegs.value ?? Array(32).fill(0)
  return Array.from({ length: 32 }, (_, i) => ({
    index: i,
    name: regName(i),
    value: (regs[i] >>> 0).toString(16).padStart(8, '0').toUpperCase(),
    written: i === writtenReg.value,
  }))
})

const columns: DataTableColumns<any> = [
  { title: '#', key: 'index', width: 48, render: (r) => `x${r.index}` },
  { title: '名称', key: 'name', width: 52 },
  {
    title: 'Hex 值',
    key: 'value',
    render: (r) =>
      r.written
        ? h('span', { class: 'text-blue-600 font-bold bg-blue-50 px-1 rounded' }, r.value)
        : r.value,
  },
]
</script>

<template>
  <div class="border-b border-slate-200">
    <div class="px-3 py-2 text-xs font-semibold text-slate-500 bg-slate-50 flex items-center justify-between">
      <span>寄存器堆 (RegFile)</span>
      <span class="text-slate-400 font-normal">周期 #{{ sim.cycleCount }}</span>
    </div>
    <n-data-table
      size="small"
      :columns="columns"
      :data="rows"
      :max-height="300"
      :bordered="false"
    />
  </div>
</template>
