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
  // 缩放范围：最大 3× 不变；最小不低于原始大小（1:1）的 0.6 倍
  const MIN_SCALE = 0.6
  const MAX_SCALE = 3
  // 滚轮缩放步进 = 原步进量（1.15 倍/次）的 3/4 → 1.1125 倍/次
  const WHEEL_FACTOR = 1.1125

  function zoomIn() {
    scale.value = Math.min(MAX_SCALE, scale.value * 1.2)
  }
  function zoomOut() {
    scale.value = Math.max(MIN_SCALE, scale.value / 1.2)
  }
  function zoomWheel(deltaY: number) {
    const factor = deltaY > 0 ? 1 / WHEEL_FACTOR : WHEEL_FACTOR
    scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value * factor))
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
    zoomWheel,
    resetView,
    setTransform,
  }
})
