<script setup lang="ts">
import { NButton, NButtonGroup, NSlider } from 'naive-ui'
import { Play, Pause, RotateCcw, ChevronRight, ChevronsRight, ArrowLeft, ArrowRight } from 'lucide-vue-next'
import { useSimulatorStore } from '@/stores/simulator'
import { useWaveStore } from '@/stores/wave'
import hduLogo from '../../../hdu.webp'

const sim = useSimulatorStore()
const wave = useWaveStore()

/** 复位要连波次一起清，否则画面上还留着上一份程序的全亮态 */
function onReset() {
  wave.resetWaves()
  sim.reset()
}

</script>

<template>
  <header class="app-header shrink-0 flex items-center gap-3 px-4 bg-slate-900 text-white border-b border-slate-700">
    <!-- Logo -->
    <div class="flex shrink-0 items-center gap-2 mr-2">
      <img :src="hduLogo" alt="杭州电子科技大学" class="w-8 h-8 rounded-lg object-contain bg-white" />
      <div class="leading-tight">
        <div class="text-sm font-semibold">RV32I 单周期模型机</div>
        <div class="text-[10px] text-slate-400">教学可视化仿真平台</div>
      </div>
    </div>

    <div class="header-spacer flex-1"></div>

    <!-- 控制按钮组：粒度由细到粗 -->
    <n-button-group size="small" class="shrink-0">
        <n-button class="font-bold" color="#334155" text-color="#ffffff" :disabled="!sim.connected || sim.isHalted" @click="wave.stepWave()">
          <template #icon><ChevronRight :size="15" /></template>
          单步
        </n-button>

        <n-button class="font-bold" color="#334155" text-color="#ffffff" :disabled="!sim.connected || sim.isHalted" @click="wave.playInstruction()">
          <template #icon><ChevronsRight :size="15" /></template>
          单条指令
        </n-button>

        <n-button class="font-bold" :disabled="!sim.connected || sim.isHalted || wave.playing" type="primary" @click="wave.startRun()">
          <template #icon><Play :size="15" /></template>
          运行
        </n-button>

        <n-button class="font-bold" color="#334155" text-color="#ffffff" :disabled="!wave.playing" @click="wave.pause()">
          <template #icon><Pause :size="15" /></template>
          暂停
        </n-button>

        <n-button class="font-bold" color="#334155" text-color="#ffffff" :disabled="!sim.connected" @click="onReset">
          <template #icon><RotateCcw :size="15" /></template>
          复位
        </n-button>
    </n-button-group>

    <!-- 流动速度：单位是「波/秒」。播放途中拖动立即生效 -->
    <div class="flex shrink-0 items-center gap-2 text-xs font-bold text-white">
      <span>速度</span>
      <n-slider v-model:value="wave.speed" class="w-24" :min="1" :max="20" :step="1" />
      <span class="w-16 font-mono text-white">{{ wave.speed }} 波/秒</span>
    </div>

    <!-- 历史步进 -->
    <n-button-group size="small" class="shrink-0">
      <n-button size="small" class="font-bold" color="#334155" text-color="#ffffff" :disabled="sim.historyIndex <= 0" @click="sim.goBack()">
        <template #icon><ArrowLeft :size="14" /></template>
        上一步
      </n-button>
      <n-button size="small" class="font-bold" color="#334155" text-color="#ffffff" :disabled="sim.historyIndex >= sim.stateHistory.length - 1" @click="sim.goForward()">
        <template #icon><ArrowRight :size="14" /></template>
        下一步
      </n-button>
    </n-button-group>
  </header>
</template>

<style scoped>
.app-header { min-height: 56px; }
@media (max-width: 1100px) {
  .app-header { flex-wrap: wrap; justify-content: center; padding-top: 8px; padding-bottom: 8px; }
  .header-spacer { display: none; }
}
</style>
