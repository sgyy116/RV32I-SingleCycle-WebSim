<script setup lang="ts">
// ============================================================================
// DatapathCanvas.vue —— 单周期数据通路可视化
//
// 渲染架构：
//   层1 静态 SVG：模块（矩形/椭圆/加法器/ALU 形状，参照原理图） + 全部连线基线
//       （数据线=虚线统一 dash/流速；控制线=实线 0.6 倍宽；颜色族见图例）
//   层2 活跃连线覆盖：按类别高亮 + 流动动画
//   层3 连线信号名标注（0.8 倍字号，紧贴所指路径）
//   层4 动态值覆盖：hex/dec 数值槽位
//   层5 Tooltip：悬停模块显示说明
// 部件名 = 1 倍字号加粗纯黑；说明文字 = 0.8 倍字号深灰；无阴影
// ============================================================================
import { ref, computed } from 'vue'
import { Play, Pause, RotateCcw } from 'lucide-vue-next'
import { NSlider } from 'naive-ui'
import { useDatapathStore } from '@/stores/datapath'
import { useSimulatorStore } from '@/stores/simulator'
import {
  MODULES,
  W,
  WIRE_LABELS,
  WIRE_LABEL_POINTS,
  MUX_SEL_LABELS,
  JUNCTION_DOTS,
  CANVAS_W,
  CANVAS_H,
} from '@/data/datapathLayout'
import type { ModuleLayout } from '@/types/datapath'

const dp = useDatapathStore()
const sim = useSimulatorStore()

const tooltip = ref<{ x: number; y: number; title: string; desc: string; active: boolean } | null>(null)

/** 全部连线（含未激活），按颜色族分成静态基线 */
const allWirePaths = computed(() =>
  Object.keys(W).map((id) => ({
    id,
    path: W[id].d,
    kind: W[id].kind,
  })),
)

/** 有标注锚点的连线（用于渲染信号名） */
const labelWires = computed(() =>
  Object.keys(W)
    .filter((id) => WIRE_LABEL_POINTS[id])
    .map((id) => ({
      id,
      path: W[id].d,
      kind: W[id].kind,
      label: WIRE_LABELS[id] ?? '',
      labelPoint: WIRE_LABEL_POINTS[id]!,
    })),
)
const activeWireIds = computed(() => new Set(dp.activeWires.map((w) => w.id)))

/** 静态基线：已激活的连线不再画基线（避免与流动虚线在同一位置形成重影） */
const baseWirePaths = computed(() =>
  allWirePaths.value.filter((w) => !activeWireIds.value.has(w.id)),
)

function wireLabelClass(id: string, kind: string) {
  const active = activeWireIds.value.has(id)
  return ['wire-label', `kind-${kind}`, active ? 'active' : '']
}

function wireValue(id: string): string | undefined {
  return dp.activeWires.find((w) => w.id === id)?.value
}

/** 重播：复位 CPU 后从头连续运行 */
function replay() {
  if (!sim.connected) return
  sim.reset()
  sim.run()
}

// 模块是否活跃
function isActive(id: string): boolean {
  return dp.activeModules.has(id as never)
}

/** 加法器（左侧凹口）与 ALU（尖角）的多边形顶点 */
function shapePoints(m: ModuleLayout): string {
  // 左宽右窄的等腰梯形，左边居中削去等腰三角（三角底 = 0.25h ≤ 左边宽 1/4，
  // 三角高 = 0.2w ≤ 梯形高 1/5）：左侧剩余上下两段线段 = 数据入口，右侧 = 出口
  const { x, y, width: w, height: h } = m
  return [
    `${x},${y}`,
    `${x + w},${y + h * 0.25}`,
    `${x + w},${y + h * 0.75}`,
    `${x},${y + h}`,
    `${x},${y + h * 0.625}`,
    `${x + w * 0.2},${y + h * 0.5}`,
    `${x},${y + h * 0.375}`,
  ].join(' ')
}

/** 01 部件：矩形上下添加半圆，只保留外轮廓 */
function stadiumPath(m: ModuleLayout): string {
  const { x, y, width: w, height: h } = m
  const r = w / 2
  return `M ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} L ${x + w} ${y + h - r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} Z`
}

/** 部件名居中（含说明小字的部件：小字在上、名称在其下居中） */
function titleY(m: ModuleLayout): number {
  if (m.sublabel) return m.y + m.height / 2 + 10
  if (m.id === 'csr') return m.y + 30   // CSR 左侧有端口文字，名称略偏上避让
  return m.y + m.height / 2
}

function shapeFill(m: ModuleLayout): string {
  if (m.id === 'oval-taken') return isActive(m.id) ? '#fecaca' : '#fdeaea'
  return isActive(m.id) ? '#bfdbfe' : '#dbeafe'
}
function shapeStroke(m: ModuleLayout): string {
  if (m.id === 'oval-taken') return '#e02020'
  return isActive(m.id) ? '#2563eb' : '#94a3b8'
}

// ---- 平移缩放（滚轮步进 = 原步进的 3/4；范围 0.6×~3×） ----
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
  dp.zoomWheel(e.deltaY)   // 步进 = 原步进的 3/4，范围 0.6×~3×（见 store）
}

function onZoomSlider(v: number) {
  dp.setTransform(v, dp.translateX, dp.translateY)
}

function onDoubleClick() {
  dp.resetView()
}

// ---- 模块悬停 tooltip ----
function onModuleEnter(m: ModuleLayout, e: MouseEvent) {
  dp.hoveredModule = m.id
  tooltip.value = { x: e.offsetX, y: e.offsetY, title: m.label || m.id, desc: m.description, active: isActive(m.id) }
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

    <!-- 缩放控制：进度条式（与周期显示同高的胶囊） -->
    <div class="absolute top-2 right-3 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/85 text-white shadow-lg" @mousedown.stop @click.stop>
      <span class="text-xs text-slate-300">缩放</span>
      <n-slider
        :value="dp.scale"
        :min="0.6"
        :max="3"
        :step="0.05"
        :format-tooltip="(v: number) => v.toFixed(2) + '×'"
        class="w-28"
        @update:value="onZoomSlider"
      />
      <span class="text-[11px] font-mono text-blue-300 w-10 text-center">{{ dp.scale.toFixed(2) }}×</span>
      <button
        class="px-2 py-0.5 rounded-full border border-slate-500 bg-transparent hover:bg-slate-700 text-[11px] text-white font-medium"
        @click="dp.resetView()"
      >1:1</button>
    </div>

    <svg
      class="datapath-svg w-full h-full cursor-grab"
      :viewBox="viewBox"
      @click.self="dp.highlightedModule = null"
    >
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e6ebf2" stroke-width="1" />
        </pattern>
        <marker id="arrow-data" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
        </marker>
        <marker id="arrow-control" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
        </marker>
        <marker id="arrow-branch" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#e02020" />
        </marker>
        <marker id="arrow-zf" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#00a8cc" />
        </marker>
        <marker id="arrow-interrupt" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#ff7a00" />
        </marker>
        <marker id="arrow-mret" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#8a2be2" />
        </marker>
      </defs>

      <rect :width="CANVAS_W" :height="CANVAS_H" fill="url(#grid)" />

      <!-- 静态基线（所有连线：数据=虚线、控制=实线，颜色族淡色） -->
      <g fill="none">
        <path
          v-for="w in baseWirePaths"
          :key="`base-${w.id}`"
          :d="w.path"
          :class="['base-wire', w.kind]"
        />
      </g>

      <!-- 活跃连线（高亮 + 统一流速的流动动画 + 方向箭头） -->
      <g>
        <path
          v-for="w in dp.activeWires"
          :key="w.id"
          :d="w.path"
          :class="['active-wire', w.kind]"
          :marker-end="`url(#arrow-${w.kind})`"
        />
      </g>

      <!-- 结点（T 型连接圆点） -->
      <g fill="#3f4a5a">
        <circle v-for="(d, i) in JUNCTION_DOTS" :key="'dot' + i" :cx="d.x" :cy="d.y" r="3" />
      </g>

      <!-- 连线信号名标注（0.8 倍字号，紧贴路径；激活加深并显示当前值） -->
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

      <!-- MUX 选择端文字 -->
      <g font-size="10" font-weight="600">
        <text v-for="(s, i) in MUX_SEL_LABELS" :key="i" :x="s.x" :y="s.y" text-anchor="middle" :fill="s.color">{{ s.text }}</text>
      </g>

      <!-- 模块（按形状渲染：矩形 / 椭圆 / 加法器 / ALU / 门） -->
      <g v-for="m in MODULES" :key="m.id">
        <!-- 形状本体 -->
        <rect
          v-if="m.shape === 'rect'"
          :x="m.x" :y="m.y" :width="m.width" :height="m.height"
          :fill="shapeFill(m)" :stroke="shapeStroke(m)"
          :stroke-width="1.8" rx="8"
          class="module-shape"
          @click.stop="dp.highlightedModule = m.id"
          @mouseenter="onModuleEnter(m, $event)"
          @mouseleave="onModuleLeave"
        />
        <path
          v-else-if="m.shape === 'stadium'"
          :d="stadiumPath(m)"
          :fill="shapeFill(m)" :stroke="shapeStroke(m)"
          stroke-width="1.6"
          class="module-shape"
          @click.stop="dp.highlightedModule = m.id"
          @mouseenter="onModuleEnter(m, $event)"
          @mouseleave="onModuleLeave"
        />
        <ellipse
          v-else-if="m.shape === 'ellipse' || m.shape === 'gate'"
          :cx="m.x + m.width / 2" :cy="m.y + m.height / 2"
          :rx="m.width / 2" :ry="m.height / 2"
          :fill="shapeFill(m)" :stroke="shapeStroke(m)"
          :stroke-width="m.id === 'oval-taken' ? 2 : m.isNew ? 2.2 : 1.6"
          class="module-shape"
          @click.stop="dp.highlightedModule = m.id"
          @mouseenter="onModuleEnter(m, $event)"
          @mouseleave="onModuleLeave"
        />
        <polygon
          v-else
          :points="shapePoints(m)"
          :fill="shapeFill(m)" :stroke="shapeStroke(m)"
          stroke-width="1.8"
          class="module-shape"
          @click.stop="dp.highlightedModule = m.id"
          @mouseenter="onModuleEnter(m, $event)"
          @mouseleave="onModuleLeave"
        />

        <!-- 部件名（1 倍字号、加粗、纯黑） -->
        <text
          v-if="m.label && m.id !== 'decoder'"
          :x="m.x + m.width / 2"
          :y="titleY(m)"
          text-anchor="middle"
          dominant-baseline="middle"
          class="pointer-events-none module-name"
          :font-size="m.nameSize"
        >{{ m.label }}</text>
        <!-- 说明小字（（异步）等，0.8 倍、深灰） -->
        <text
          v-if="m.sublabel"
          :x="m.x + m.width / 2"
          :y="m.y + m.height / 2 - 14"
          text-anchor="middle"
          dominant-baseline="middle"
          class="pointer-events-none module-sub"
          :font-size="m.nameSize * 0.8"
        >{{ m.sublabel }}</text>
        <!-- 译码器竖排文字 -->
        <template v-if="m.id === 'decoder'">
          <text
            v-for="(p, i) in m.ports" :key="'dec' + i"
            :x="p.x" :y="p.y" text-anchor="middle"
            class="pointer-events-none module-name"
            :font-size="m.nameSize"
          >{{ p.text }}</text>
        </template>
        <!-- 端口/内部说明文字（0.8 倍字号、深灰） -->
        <template v-if="m.ports && m.id !== 'decoder'">
          <text
            v-for="(p, i) in m.ports" :key="'p' + i"
            :x="p.x" :y="p.y"
            :text-anchor="p.anchor ?? 'start'"
            class="pointer-events-none module-port"
            :font-size="(m.nameSize) * 0.8"
          >{{ p.text }}</text>
        </template>
        <!-- MUX 输入端 0/1/2 -->
        <template v-if="m.muxPorts">
          <text
            v-for="(p, i) in m.muxPorts" :key="'m' + i"
            :x="p.x" :y="p.y" text-anchor="middle"
            class="pointer-events-none module-port"
            font-size="11"
          >{{ p.text }}</text>
        </template>
      </g>

      <!-- 动态值槽位（带标签） -->
      <g v-for="slot in dp.valueSlots" :key="slot.id" font-family="JetBrains Mono, Consolas, monospace">
        <text :x="slot.x" :y="slot.y - 10" text-anchor="middle" font-size="9" fill="#94a3b8">{{ slot.label }}</text>
        <rect
          :x="slot.x - 40" :y="slot.y - 4" :width="80" :height="18" rx="4"
          fill="#1e293b" opacity="0.92"
        />
        <text :x="slot.x" :y="slot.y + 9" text-anchor="middle" font-size="10" fill="#fbbf24">{{ slot.value }}</text>
      </g>

      <!-- 译码器输出信号（紧凑信号灯） -->
      <g v-if="dp.decoderSignals.length" font-family="JetBrains Mono, Consolas, monospace">
        <template v-for="(sig, i) in dp.decoderSignals" :key="sig.key">
          <rect
            :x="1120 + (i % 6) * 60"
            :y="20 + Math.floor(i / 6) * 20"
            :width="56" :height="16" rx="3"
            :fill="sig.on ? (sig.label === 'TRAP' ? '#fee2e2' : sig.label === 'ZF' ? '#dcfce7' : '#dbeafe') : '#f1f5f9'"
            :stroke="sig.on ? (sig.label === 'TRAP' ? '#dc2626' : sig.label === 'ZF' ? '#16a34a' : '#2563eb') : '#e2e8f0'"
            stroke-width="1"
          />
          <text
            :x="1148 + (i % 6) * 60"
            :y="31 + Math.floor(i / 6) * 20"
            text-anchor="middle" font-size="9"
            :fill="sig.on ? (sig.label === 'TRAP' ? '#b91c1c' : sig.label === 'ZF' ? '#15803d' : '#1e40af') : '#94a3b8'"
            font-weight="600"
          >{{ sig.isBool ? sig.label : sig.value ?? sig.label }}</text>
        </template>
      </g>

      <!-- 图例（一条直线；线段颜色/宽度与实际连线一致） -->
      <g transform="translate(20, 1244)">
        <text x="0" y="5" fill="#334155" font-weight="600" font-size="11">图例</text>
        <line x1="40" y1="2" x2="62" y2="2" stroke="#475569" stroke-width="2" stroke-dasharray="7 5" />
        <text x="67" y="6" fill="#475569" font-size="10">数据通路（虚线）</text>
        <line x1="168" y1="2" x2="190" y2="2" stroke="#64748b" stroke-width="1.2" />
        <text x="195" y="6" fill="#475569" font-size="10">控制信号（实线）</text>
        <line x1="296" y1="2" x2="318" y2="2" stroke="#e02020" stroke-width="1.5" />
        <text x="323" y="6" fill="#475569" font-size="10">跳转/分支</text>
        <line x1="394" y1="2" x2="416" y2="2" stroke="#00a8cc" stroke-width="1.6" stroke-dasharray="7 5" />
        <text x="421" y="6" fill="#475569" font-size="10">数据高亮</text>
        <line x1="482" y1="2" x2="504" y2="2" stroke="#ff7a00" stroke-width="2" stroke-dasharray="7 5" />
        <text x="509" y="6" fill="#475569" font-size="10">中断/异常</text>
        <line x1="576" y1="2" x2="598" y2="2" stroke="#8a2be2" stroke-width="1.8" stroke-dasharray="7 5" />
        <text x="603" y="6" fill="#475569" font-size="10">mret 返回</text>
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

    <!-- 底部动画播放条 -->
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

<style scoped>
.module-shape {
  cursor: pointer;
  transition: fill 0.15s ease, stroke 0.15s ease;
}
.module-name {
  fill: #000000;
  font-weight: 400;
}
.module-sub {
  fill: #4b5563;
}
.module-port {
  fill: #4b5563;
}
</style>
