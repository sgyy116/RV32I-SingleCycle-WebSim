<script setup lang="ts">
import { NButton, NButtonGroup, NSlider, NTooltip } from 'naive-ui'
import { Play, Pause, RotateCcw, StepForward, ArrowLeft, ArrowRight } from 'lucide-vue-next'
import { useSimulatorStore } from '@/stores/simulator'
// 杭电图标（源文件位于 frontend/hdu.webp，由 Vite 打包）
import hduLogo from '../../../hdu.webp'

const sim = useSimulatorStore()
</script>

<template>
  <header class="h-14 shrink-0 flex items-center gap-3 px-4 bg-slate-900 text-white border-b border-slate-700">
    <!-- 杭电校徽图标 -->
    <div class="flex items-center gap-2 mr-2">
      <img :src="hduLogo" alt="杭电" class="w-9 h-9 rounded-full object-cover bg-white" />
      <div class="leading-tight">
        <div class="text-sm font-semibold">RV32I 单周期模型机</div>
        <div class="text-[10px] text-slate-400">教学可视化仿真平台</div>
      </div>
    </div>

    <div class="flex-1"></div>

    <!-- 控制按钮组（文字统一白色加粗） -->
    <n-button-group size="small">
      <n-tooltip><template #trigger>
        <n-button color="#334155" text-color="#ffffff" class="font-bold" :disabled="!sim.connected" @click="sim.step()">
          <template #icon><StepForward :size="15" /></template>
          单步
        </n-button>
      </template>执行一个周期</n-tooltip>

      <n-tooltip><template #trigger>
        <n-button type="primary" class="font-bold" :disabled="!sim.connected || sim.isRunning" @click="sim.run()">
          <template #icon><Play :size="15" /></template>
          运行
        </n-button>
      </template>连续运行</n-tooltip>

      <n-tooltip><template #trigger>
        <n-button color="#334155" text-color="#ffffff" class="font-bold" :disabled="!sim.isRunning" @click="sim.pause()">
          <template #icon><Pause :size="15" /></template>
          暂停
        </n-button>
      </template>暂停运行</n-tooltip>

      <n-tooltip><template #trigger>
        <n-button color="#334155" text-color="#ffffff" class="font-bold" :disabled="!sim.connected" @click="sim.reset()">
          <template #icon><RotateCcw :size="15" /></template>
          复位
        </n-button>
      </template>复位 CPU</n-tooltip>
    </n-button-group>

    <!-- 速度（字样与单步等一致：白色加粗） -->
    <div class="flex items-center gap-2 text-sm font-bold text-white">
      <span>速度</span>
      <n-slider v-model:value="sim.runSpeed" class="w-24" :min="1" :max="20" :step="1" />
    </div>

    <!-- 历史步进（箭头符号右侧带文字，间距与单步等一致） -->
    <n-button-group size="small">
      <n-button color="#334155" text-color="#ffffff" class="font-bold" :disabled="sim.historyIndex <= 0" @click="sim.goBack()">
        <template #icon><ArrowLeft :size="14" /></template>
        上一步
      </n-button>
      <n-button color="#334155" text-color="#ffffff" class="font-bold" :disabled="sim.programHalted || sim.historyIndex >= sim.stateHistory.length - 1" @click="sim.goForward()">
        <template #icon><ArrowRight :size="14" /></template>
        下一步
      </n-button>
    </n-button-group>
  </header>
</template>

<style scoped>
/* 按钮/图标组内文字白色加粗 */
:deep(.n-button__content) {
  font-weight: 700;
}
</style>
