// ============================================================================
// datapath.ts —— 数据通路可视化状态（Pinia）
//
// 从 simulator store 的 cycleState 派生活跃模块 / 连线 / 动态值，
// 并管理画布缩放平移。
// ============================================================================

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useSimulatorStore } from './simulator'
import { computeDatapath } from '@/data/datapathLayout'

export const useDatapathStore = defineStore('datapath', () => {
  const sim = useSimulatorStore()

  // 缩放 / 平移
  const scale = ref(1)
  const translateX = ref(0)
  const translateY = ref(0)
  const highlightedModule = ref<string | null>(null)
  const hoveredModule = ref<string | null>(null)

  // 从当前周期状态派生可视化
  const datapath = computed(() => computeDatapath(sim.cycleState))
  const activeModules = computed(() => datapath.value.activeModules)
  const activeWires = computed(() => datapath.value.activeWires)
  const valueSlots = computed(() => datapath.value.valueSlots)
  const decoderSignals = computed(() => datapath.value.decoderSignals)

  // ---- 视图操作 ----
  function zoomIn() {
    scale.value = Math.min(3, scale.value * 1.2)
  }
  function zoomOut() {
    scale.value = Math.max(0.3, scale.value / 1.2)
  }
  function resetView() {
    scale.value = 1
    translateX.value = 0
    translateY.value = 0
  }
  function setTransform(s: number, x: number, y: number) {
    scale.value = s
    translateX.value = x
    translateY.value = y
  }

  return {
    scale,
    translateX,
    translateY,
    highlightedModule,
    hoveredModule,
    activeModules,
    activeWires,
    valueSlots,
    decoderSignals,
    zoomIn,
    zoomOut,
    resetView,
    setTransform,
  }
})
