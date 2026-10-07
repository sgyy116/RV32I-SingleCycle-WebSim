<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useSimulatorStore } from '@/stores/simulator'

const sim = useSimulatorStore()
const footerEl = ref<HTMLElement | null>(null)
let heightObserver: ResizeObserver | null = null
onMounted(() => {
  const updateHeight = () => {
    if (footerEl.value) document.documentElement.style.setProperty('--rv-footer-h', `${footerEl.value.getBoundingClientRect().height}px`)
  }
  updateHeight()
  heightObserver = new ResizeObserver(updateHeight)
  if (footerEl.value) heightObserver.observe(footerEl.value)
})
onUnmounted(() => heightObserver?.disconnect())
</script>

<template>
  <!-- 高度走 CSS 变量，与 AppHeader / GlossaryOverlay 同源；底色保持深色，
       与改浅后的顶栏形成「顶栏=操作区、底栏=状态区」的层次 -->
  <footer ref="footerEl" class="app-footer shrink-0 flex items-center gap-4 px-4 text-sm bg-slate-900 text-slate-300 border-t border-slate-600">
    <div class="footer-connection flex items-center gap-1.5">
      <span class="w-2.5 h-2.5 rounded-full" :class="sim.connected ? 'bg-green-500' : 'bg-red-500'"></span>
      <span>{{ sim.connected ? '后端已连接' : '后端未连接' }}</span>
      <span class="text-slate-500">ws://localhost:8080</span>
    </div>
    <div class="footer-spacer flex-1"></div>
    <div class="footer-status flex items-center gap-4 font-mono">
      <span>状态: <span :class="sim.status === 'halted' ? 'text-amber-400' : sim.status === 'error' ? 'text-red-400' : 'text-green-400'">{{ sim.statusText }}</span></span>
      <span>周期 #{{ sim.cycleCount }}</span>
      <span>PC: <span class="text-blue-400">{{ sim.cycleState?.pc ?? '-' }}</span></span>
      <span v-if="sim.cycleState">指令: {{ sim.cycleState.disassembly }}</span>
    </div>
  </footer>
</template>

<style scoped>
.app-footer { min-height: calc(40px + env(safe-area-inset-bottom, 0px)); padding-bottom: env(safe-area-inset-bottom, 0px); box-sizing: border-box; overflow-x: auto; white-space: nowrap; }
@media (max-width: 750px) {
  .app-footer { flex-wrap: wrap; gap: 2px 12px; padding: 6px 12px calc(6px + env(safe-area-inset-bottom, 0px)); white-space: normal; }
  .footer-spacer { display: none; }
  .footer-connection, .footer-status { flex-wrap: wrap; gap: 2px 12px; }
}
</style>
