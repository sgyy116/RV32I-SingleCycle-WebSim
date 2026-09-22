<script setup lang="ts">
import { useSimulatorStore } from '@/stores/simulator'

const sim = useSimulatorStore()
</script>

<template>
  <footer class="h-10 shrink-0 flex items-center gap-4 px-4 text-sm bg-slate-900 text-slate-300 border-t border-slate-700">
    <div class="flex items-center gap-1.5">
      <span class="w-2 h-2 rounded-full" :class="sim.connected ? 'bg-green-500' : 'bg-red-500'"></span>
      <span>{{ sim.connected ? '后端已连接' : '后端未连接' }}</span>
      <span class="text-slate-500">ws://localhost:8080</span>
    </div>
    <div class="flex-1"></div>
    <div class="flex items-center gap-4 font-mono">
      <span>状态: <span :class="sim.status === 'halted' ? 'text-amber-400' : sim.status === 'error' ? 'text-red-400' : 'text-green-400'">{{ sim.statusText }}</span></span>
      <span>周期 #{{ sim.cycleCount }}</span>
      <span>PC: <span class="text-blue-400">{{ sim.cycleState?.pc ?? '-' }}</span></span>
      <span v-if="sim.cycleState">指令: {{ sim.cycleState.disassembly }}</span>
    </div>
  </footer>
</template>
