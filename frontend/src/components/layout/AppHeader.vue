<script setup lang="ts">
import { NButton, NButtonGroup, NSlider, NSelect, NTooltip } from 'naive-ui'
import { Play, Pause, RotateCcw, StepForward, ArrowLeft, ArrowRight } from 'lucide-vue-next'
import { useSimulatorStore } from '@/stores/simulator'
import { useEditorStore } from '@/stores/editor'
import { EXAMPLES } from '@/data/examples'

const sim = useSimulatorStore()
const editor = useEditorStore()

const exampleOptions = EXAMPLES.map((e, i) => ({
  label: e.name,
  value: i,
}))

function onSelectExample(value: number) {
  editor.loadExample(value)
  sim.compileAndLoad(editor.code)
}
</script>

<template>
  <header class="h-14 shrink-0 flex items-center gap-3 px-4 bg-slate-900 text-white border-b border-slate-700">
    <!-- Logo -->
    <div class="flex items-center gap-2 mr-2">
      <div class="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-mono text-sm font-bold">
        R
      </div>
      <div class="leading-tight">
        <div class="text-sm font-semibold">RV32I 单周期模型机</div>
        <div class="text-[10px] text-slate-400">教学可视化仿真平台</div>
      </div>
    </div>

    <!-- 示例选择 -->
    <n-select
      v-model:value="editor.currentExample"
      class="w-44"
      size="small"
      :options="exampleOptions"
      placeholder="选择示例程序"
      @update:value="onSelectExample"
    />

    <div class="flex-1"></div>

    <!-- 控制按钮组 -->
    <n-button-group size="small">
      <n-tooltip><template #trigger>
        <n-button :disabled="!sim.connected" @click="sim.step()">
          <template #icon><StepForward :size="15" /></template>
          单步
        </n-button>
      </template>执行一个周期</n-tooltip>

      <n-tooltip><template #trigger>
        <n-button :disabled="!sim.connected || sim.isRunning" type="primary" @click="sim.run()">
          <template #icon><Play :size="15" /></template>
          运行
        </n-button>
      </template>连续运行</n-tooltip>

      <n-tooltip><template #trigger>
        <n-button :disabled="!sim.isRunning" @click="sim.pause()">
          <template #icon><Pause :size="15" /></template>
          暂停
        </n-button>
      </template>暂停运行</n-tooltip>

      <n-tooltip><template #trigger>
        <n-button :disabled="!sim.connected" @click="sim.reset()">
          <template #icon><RotateCcw :size="15" /></template>
          复位
        </n-button>
      </template>复位 CPU</n-tooltip>
    </n-button-group>

    <!-- 速度 -->
    <div class="flex items-center gap-2 text-xs text-slate-300">
      <span>速度</span>
      <n-slider v-model:value="sim.runSpeed" class="w-24" :min="1" :max="20" :step="1" />
    </div>

    <!-- 历史步进 -->
    <n-button-group size="small">
      <n-button size="small" :disabled="sim.historyIndex <= 0" @click="sim.goBack()">
        <template #icon><ArrowLeft :size="14" /></template>
      </n-button>
      <n-button size="small" :disabled="sim.historyIndex >= sim.stateHistory.length - 1" @click="sim.goForward()">
        <template #icon><ArrowRight :size="14" /></template>
      </n-button>
    </n-button-group>
  </header>
</template>
