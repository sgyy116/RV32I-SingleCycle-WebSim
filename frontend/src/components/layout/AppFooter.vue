<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { NConfigProvider, NSlider } from 'naive-ui'
import { useSimulatorStore } from '@/stores/simulator'
import { useWaveStore } from '@/stores/wave'
import NetworkCheck from './NetworkCheck.vue'

defineProps<{ zoom: number; zoomMin: number; zoomMax: number }>()
const emit = defineEmits<{ 'update:zoom': [value: number]; 'reset-view': [] }>()
const zoomTheme = {
  Slider: { fillColor: '#2563eb', fillColorHover: '#3b82f6', railColor: '#cbd5e1',
    railColorHover: '#94a3b8', handleColor: '#ffffff' },
}
const sim = useSimulatorStore()
const wave = useWaveStore()
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
  <!-- 执行位置只显示一次；所有工作区视图共用底栏。 -->
  <footer ref="footerEl" class="app-footer shrink-0 bg-slate-900 text-slate-300 border-t border-slate-600">
    <div class="footer-controls">
    <div class="zoom-bar toolbar-pill">
      <span class="zoom-label">缩放</span>
      <n-config-provider abstract :theme-overrides="zoomTheme">
        <n-slider class="zoom-slider" :value="zoom" :min="zoomMin" :max="zoomMax" :step="0.05" :tooltip="false"
          @update:value="emit('update:zoom', $event as number)" />
      </n-config-provider>
      <span class="zoom-value">{{ zoom.toFixed(2) }}×</span>
      <button type="button" @click="emit('reset-view')">1:1</button>
    </div>
    <div class="footer-summary">
      <span class="footer-connection" :title="sim.connectionUrl">
        <span class="connection-dot" :class="sim.connected ? 'bg-green-500' : 'bg-red-500'"></span>
        <span>{{ sim.connected ? '已连接' : sim.admission === 'queued' ? '等待中' : '未连接' }}</span>
      </span>
      <span class="footer-status" role="status" aria-live="polite" :title="sim.errorMessage || sim.statusText"
        :class="sim.status === 'halted' ? 'text-amber-400' : sim.status === 'error' ? 'text-red-400' : 'text-green-400'">
        {{ wave.playing ? '运行中' : sim.statusText }}
      </span>
    </div>
    <button v-if="sim.admission === 'queued'" type="button" class="queue-action" @click="sim.leaveQueue()">退出排队</button>
    <button v-if="['full', 'cancelled', 'expired'].includes(sim.admission)" type="button" class="queue-action" @click="sim.joinQueue()">重新加入</button>
    <NetworkCheck />
    </div>
    <div class="footer-position">
    <div class="footer-execution">
      <span class="footer-cycle">周期 #{{ sim.cycleCount }}</span>
      <span class="footer-pc">PC {{ sim.cycleState?.pc ?? sim.programEntry }}</span>
      <span class="footer-instruction" :title="sim.cycleState?.disassembly ?? '尚未执行指令'">{{ sim.cycleState?.disassembly ?? '尚未执行指令' }}</span>
    </div>
    <div v-if="wave.total > 0 || wave.shown.trapActive" class="footer-wave">
      <span v-if="wave.total > 0">第 {{ wave.waveNo }} / {{ wave.total }} 波</span>
      <span v-if="wave.shown.trapActive" class="trap-tag">异常 / 中断</span>
    </div>
    </div>
  </footer>
</template>

<style scoped>
.app-footer { min-height: calc(40px + env(safe-area-inset-bottom, 0px)); padding: 6px 16px calc(6px + env(safe-area-inset-bottom, 0px)); box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: 6px 16px; font-size: 12px; }
.footer-controls, .footer-position { display: flex; align-items: center; gap: 8px 16px; min-width: 0; }
.footer-summary { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
.footer-connection { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; }
.connection-dot { width: 8px; height: 8px; border-radius: 50%; }
.footer-status { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.queue-action { flex-shrink: 0; padding: 3px 8px; border: 1px solid #fbbf24; border-radius: 5px; color: #fde68a; background: transparent; cursor: pointer; white-space: nowrap; }
.queue-action:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
.footer-execution { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; justify-content: flex-end; font-family: Consolas, monospace; }
.footer-cycle, .footer-pc { flex-shrink: 0; white-space: nowrap; }
.footer-pc, .footer-instruction { border-left: 1px solid #475569; padding-left: 8px; }
.footer-instruction { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #93c5fd; }
.footer-wave { display: flex; align-items: center; gap: 8px; flex-shrink: 0; white-space: nowrap; }
.trap-tag { padding: 1px 6px; border-radius: 6px; background: #dc2626; color: white; }
/* 缩放控件属于全局底栏，沿用白底圆角，图区不再有悬浮工具条。 */
.zoom-bar { min-height: 30px; flex-shrink: 0; display: flex; gap: 8px; align-items: center; padding: 3px 10px; border: 1px solid #cbd5e1; border-radius: 999px; background: white; color: #334155; }
.zoom-label, .zoom-value { flex-shrink: 0; font-weight: 700; }
.zoom-slider { width: clamp(64px, 8vw, 120px); }
.zoom-bar button { padding: 2px 7px; border: 1px solid #94a3b8; background: white; color: #334155; cursor: pointer; }
.zoom-bar button:hover { border-color: #2563eb; color: #1d4ed8; }
.zoom-bar button:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
/* 中等窗口固定两行，波次跟随执行信息，不独自挤出第三行。 */
@media (max-width: 1200px) {
  .app-footer { grid-template-columns: minmax(0, 1fr); }
  .footer-execution { justify-content: flex-start; }
}
@media (max-width: 600px) {
  .app-footer { padding-inline: 12px; }
  .footer-controls { flex-wrap: wrap; gap: 4px 8px; }
  .footer-summary { flex: 1 1 100%; }
  .footer-position { flex-wrap: wrap; gap: 4px 8px; }
  .footer-execution { flex: 1 1 100%; }
}
</style>
