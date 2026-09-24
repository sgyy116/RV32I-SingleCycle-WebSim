<script setup lang="ts">
// ============================================================================
// DatapathCanvas.vue —— 单周期数据通路可视化
//
// 渲染架构：
//   层1 静态 SVG：模块矩形 + 全部连线基线（按颜色族淡色）
//   层2 活跃连线覆盖：控制/数据/状态/ALU 四类高亮动画
//   层3 连线信号名标注（激活加深）
//   层4 动态值覆盖：hex/dec 数值槽位
//   层5 Tooltip：悬停模块显示说明
// ============================================================================

import { ref, computed } from 'vue'
import { Play, Pause, RotateCcw } from 'lucide-vue-next'
import { useDatapathStore } from '@/stores/datapath'
import { useSimulatorStore } from '@/stores/simulator'
import {
  MODULES,
  STAGE_LABELS,
  W,
  WIRE_LABELS,
  WIRE_LABEL_POINTS,
  MUX_LABELS,
  wireKindOf,
  CANVAS_W,
  CANVAS_H,
} from '@/data/datapathLayout'
import type { ModuleLayout, WireId } from '@/types/datapath'

const dp = useDatapathStore()
const sim = useSimulatorStore()

const tooltip = ref<{ x: number; y: number; title: string; desc: string; active: boolean } | null>(null)

/** 全部连线（含未激活），按颜色族分成静态基线 */
const allWirePaths = computed(() =>
  (Object.keys(W) as WireId[]).map((id) => ({
    id,
    path: W[id],
    kind: wireKindOf(id),
  })),
)

/** 有标注锚点的连线（用于渲染信号名） */
const labelWires = computed(() =>
  (Object.keys(W) as WireId[])
    .filter((id) => WIRE_LABEL_POINTS[id])
    .map((id) => ({
      id,
      path: W[id],
      kind: wireKindOf(id),
      label: WIRE_LABELS[id],
      labelPoint: WIRE_LABEL_POINTS[id]!,
    })),
)
const activeWireIds = computed(() => new Set(dp.activeWires.map((w) => w.id)))

function wireLabelClass(id: WireId, kind: string) {
  const active = activeWireIds.value.has(id)
  return ['wire-label', `kind-${kind}`, active ? 'active' : '']
}

function wireValue(id: string): string | undefined {
  return dp.activeWires.find((w) => w.id === id)?.value
}

/** 重播：复位 CPU 后从头连续运行（模拟参考图的「重播」） */
function replay() {
  if (!sim.connected) return
  sim.reset()
  sim.run()
}

// 模块是否活跃
function isActive(id: string): boolean {
  return dp.activeModules.has(id as never)
}

function moduleStyle(m: ModuleLayout) {
  const active = isActive(m.id)
  return {
    fill: active ? (m.id === 'alu' ? '#ffedd5' : '#dbeafe') : '#ffffff',
    stroke: active ? (m.id === 'alu' ? '#f97316' : '#3b82f6') : '#cbd5e1',
    strokeWidth: active ? 3 : 1.5,
  }
}

// ---- 平移缩放 ----
let dragging = false
let startX = 0
let startY = 0
let origTx = 0
let origTy = 0

function onMouseDown(e: MouseEvent) {
  dragging = true
  startX = e.clientX
  startY = e.clientY
  origTx = dp.translateX
  origTy = dp.translateY
}

function onMouseMove(e: MouseEvent) {
  if (dragging) {
    dp.setTransform(dp.scale, origTx + (e.clientX - startX), origTy + (e.clientY - startY))
  }
}

function onMouseUp() {
  dragging = false
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15
  dp.setTransform(Math.min(3, Math.max(0.3, dp.scale * factor)), dp.translateX, dp.translateY)
}

function onDoubleClick() {
  dp.resetView()
}

// ---- 模块悬停 tooltip ----
function onModuleEnter(m: ModuleLayout, e: MouseEvent) {
  dp.hoveredModule = m.id
  tooltip.value = { x: e.offsetX, y: e.offsetY, title: m.label, desc: m.description, active: isActive(m.id) }
}
function onModuleLeave() {
  dp.hoveredModule = null
  tooltip.value = null
}

const viewBox = computed(() => `${-dp.translateX / dp.scale} ${-dp.translateY / dp.scale} ${CANVAS_W / dp.scale} ${CANVAS_H / dp.scale}`)
</script>

<template>
  <div
    class="w-full h-full relative bg-slate-100 overflow-hidden"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
    @mouseleave="onMouseUp"
    @wheel.prevent="onWheel"
    @dblclick="onDoubleClick"
  >
    <!-- 顶部信息条：当前指令 -->
    <div class="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/85 text-white text-xs shadow-lg pointer-events-none">
      <span class="text-slate-400">周期 #{{ sim.cycleCount }}</span>
      <span class="text-slate-500">|</span>
      <span class="font-mono text-blue-300">{{ sim.cycleState?.pc ?? '0x80000000' }}</span>
      <span class="text-slate-500">|</span>
      <span class="font-mono">{{ sim.cycleState?.disassembly ?? '（尚未执行）' }}</span>
    </div>

    <!-- 缩放控制 -->
    <div class="absolute top-3 right-3 flex flex-col gap-1 z-20">
      <button class="w-8 h-8 rounded-lg bg-white shadow border border-slate-200 hover:bg-slate-50 text-slate-600" @click.stop="dp.zoomIn()">+</button>
      <button class="w-8 h-8 rounded-lg bg-white shadow border border-slate-200 hover:bg-slate-50 text-slate-600" @click.stop="dp.zoomOut()">−</button>
      <button class="w-8 h-8 rounded-lg bg-white shadow border border-slate-200 hover:bg-slate-50 text-slate-600 text-[10px]" @click.stop="dp.resetView()">1:1</button>
    </div>

    <svg
      class="datapath-svg w-full h-full cursor-grab"
      :viewBox="viewBox"
      @click.self="dp.highlightedModule = null"
    >
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e2e8f0" stroke-width="1" />
        </pattern>
        <!-- 方向箭头 -->
        <marker id="arrow-data" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#16a34a" />
        </marker>
        <marker id="arrow-control" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
        </marker>
        <marker id="arrow-state" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
        </marker>
        <marker id="arrow-alu" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#f97316" />
        </marker>
      </defs>

      <rect :width="CANVAS_W" :height="CANVAS_H" fill="url(#grid)" />

      <!-- 阶段标注 -->
      <g font-size="11" fill="#64748b" font-weight="600" letter-spacing="1">
        <text v-for="s in STAGE_LABELS" :key="s.label + s.y" :x="s.x" :y="s.y">{{ s.label }}</text>
      </g>

      <!-- 静态基线（所有连线，按颜色族淡色显示；未激活的数据线为细浅绿） -->
      <g fill="none">
        <path
          v-for="w in allWirePaths"
          :key="`base-${w.id}`"
          :d="w.path"
          :class="['base-wire', w.kind]"
        />
      </g>

      <!-- 活跃连线（高亮动画 + 方向箭头） -->
      <g>
        <path
          v-for="w in dp.activeWires"
          :key="w.id"
          :d="w.path"
          :class="['active-wire', w.kind]"
          :marker-end="`url(#arrow-${w.kind})`"
        />
      </g>

      <!-- 连线信号名标注（未激活淡色，激活加深；参考图风格） -->
      <g>
        <template v-for="w in labelWires" :key="`label-${w.id}`">
          <text
            :x="w.labelPoint.x"
            :y="w.labelPoint.y"
            :class="wireLabelClass(w.id, w.kind)"
            text-anchor="middle"
          >
            {{ w.label }}
            <tspan v-if="activeWireIds.has(w.id) && wireValue(w.id)" dx="4" class="wire-value">{{ wireValue(w.id) }}</tspan>
          </text>
        </template>
      </g>

      <!-- 模块 -->
      <g v-for="m in MODULES" :key="m.id">
        <rect
          :x="m.x"
          :y="m.y"
          :width="m.width"
          :height="m.height"
          rx="8"
          :fill="moduleStyle(m).fill"
          :stroke="moduleStyle(m).stroke"
          :stroke-width="moduleStyle(m).strokeWidth"
          class="cursor-pointer transition-all"
          :class="{ 'module-active': isActive(m.id), 'module-hovered': dp.hoveredModule === m.id }"
          @click.stop="dp.highlightedModule = m.id"
          @mouseenter="onModuleEnter(m, $event)"
          @mouseleave="onModuleLeave"
        />
        <text
          :x="m.x + m.width / 2"
          :y="m.y + m.height / 2"
          text-anchor="middle"
          dominant-baseline="middle"
          class="pointer-events-none"
          :fill="isActive(m.id) ? (m.id === 'alu' ? '#c2410c' : '#1e40af') : '#334155'"
          font-size="13"
          font-weight="600"
        >
          {{ m.label }}
        </text>
      </g>

      <!-- MUX 输入端口 0/1 标注（参考图风格） -->
      <g font-size="9" fill="#64748b" font-weight="700">
        <template v-for="(ports, muxId) in MUX_LABELS" :key="muxId">
          <text :x="ports.zero.x" :y="ports.zero.y" text-anchor="middle">0</text>
          <text :x="ports.one.x" :y="ports.one.y" text-anchor="middle">1</text>
        </template>
      </g>

      <!-- 动态值槽位（带标签） -->
      <g v-for="slot in dp.valueSlots" :key="slot.id" font-family="JetBrains Mono, Consolas, monospace">
        <text :x="slot.x" :y="slot.y - 8" text-anchor="middle" font-size="8" fill="#94a3b8">{{ slot.label }}</text>
        <rect
          :x="slot.x - 38"
          :y="slot.y - 4"
          :width="76"
          :height="18"
          rx="4"
          fill="#1e293b"
          opacity="0.9"
        />
        <text :x="slot.x" :y="slot.y + 6" text-anchor="middle" font-size="10" fill="#fbbf24">
          {{ slot.value }}
        </text>
      </g>

      <!-- 译码器输出信号（原理图命名） -->
      <g v-if="dp.decoderSignals.length" font-family="JetBrains Mono, Consolas, monospace">
        <template v-for="(sig, i) in dp.decoderSignals" :key="sig.key">
          <rect
            :x="798 + (i % 5) * 26"
            :y="126 + Math.floor(i / 5) * 16"
            :width="24"
            :height="13"
            rx="3"
            :fill="sig.on ? (sig.label === 'ZF' ? '#dcfce7' : '#dbeafe') : '#f1f5f9'"
            :stroke="sig.on ? (sig.label === 'ZF' ? '#16a34a' : '#2563eb') : '#e2e8f0'"
            stroke-width="1"
          />
          <text
            :x="810 + (i % 5) * 26"
            :y="135 + Math.floor(i / 5) * 16"
            text-anchor="middle"
            font-size="8"
            :fill="sig.on ? (sig.label === 'ZF' ? '#15803d' : '#1e40af') : '#94a3b8'"
            font-weight="600"
          >
            {{ sig.isBool ? sig.label : sig.value ?? sig.label }}
          </text>
        </template>
      </g>

      <!-- 图例（参考图：红色控制 / 绿色数据激活/未激活 / 蓝色状态 / 橙色 ALU） -->
      <g transform="translate(20, 662)" font-size="10">
        <text x="0" y="5" fill="#334155" font-weight="600" font-size="11">图例</text>
        <line x1="46" y1="3" x2="66" y2="3" stroke="#ef4444" stroke-width="3" stroke-linecap="round" />
        <text x="72" y="6" fill="#64748b">控制信号</text>
        <line x1="140" y1="3" x2="160" y2="3" stroke="#16a34a" stroke-width="3" stroke-linecap="round" />
        <text x="166" y="6" fill="#64748b">数据(激活)</text>
        <line x1="232" y1="3" x2="252" y2="3" stroke="#bbf7d0" stroke-width="1.5" stroke-linecap="round" />
        <text x="258" y="6" fill="#64748b">数据(未激活)</text>
        <line x1="330" y1="3" x2="350" y2="3" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" />
        <text x="356" y="6" fill="#64748b">状态</text>
        <line x1="396" y1="3" x2="416" y2="3" stroke="#f97316" stroke-width="3" stroke-linecap="round" />
        <text x="422" y="6" fill="#64748b">ALU</text>
      </g>
    </svg>

    <!-- 未连接提示 -->
    <div v-if="!sim.connected" class="absolute inset-0 flex items-center justify-center bg-white/70 z-10">
      <div class="text-center text-slate-500">
        <div class="text-2xl mb-2">🔄</div>
        <div>正在连接后端服务 (ws://localhost:8080)…</div>
        <div class="text-xs mt-2 text-slate-400">请先启动 python backend/python/server.py</div>
      </div>
    </div>

    <!-- 底部动画播放条（参考图：开始动画 / 暂停 / 重播） -->
    <div
      class="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-2 py-1.5 rounded-full bg-white/90 shadow border border-slate-200"
      @mousedown.stop
      @click.stop
    >
      <button
        class="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="!sim.connected || sim.isRunning"
        @click="sim.run()"
      >
        <Play :size="13" /> 开始动画
      </button>
      <button
        class="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="!sim.isRunning"
        @click="sim.pause()"
      >
        <Pause :size="13" /> 暂停
      </button>
      <button
        class="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="!sim.connected"
        @click="replay()"
      >
        <RotateCcw :size="13" /> 重播
      </button>
    </div>

    <!-- Tooltip -->
    <div
      v-if="tooltip"
      class="absolute z-30 pointer-events-none px-3 py-2 rounded-lg bg-slate-900 text-white text-xs shadow-lg max-w-xs"
      :style="{ left: tooltip.x + 12 + 'px', top: tooltip.y + 12 + 'px' }"
    >
      <div class="font-semibold mb-1" :class="tooltip.active ? 'text-blue-400' : ''">
        {{ tooltip.title }} <span v-if="tooltip.active" class="text-green-400">● 活跃</span>
      </div>
      <div class="text-slate-300">{{ tooltip.desc }}</div>
    </div>
  </div>
</template>
