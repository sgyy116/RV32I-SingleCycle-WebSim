<script setup lang="ts">
import { computed, h } from 'vue'
import { NDataTable } from 'naive-ui'
import { useSimulatorStore } from '@/stores/simulator'
import { regName } from '@/utils/formatters'
import type { DataTableColumns } from 'naive-ui'

const sim = useSimulatorStore()

// 最近写回的目标寄存器（高亮）
const writtenReg = computed(() => {
  const wb = sim.cycleState?.writeback
  return wb?.active ? wb.reg_index : -1
})

const rows = computed(() => {
  const regs = sim.cycleState?.regfile ?? Array(32).fill(0)
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
