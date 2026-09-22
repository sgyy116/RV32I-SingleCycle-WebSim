<script setup lang="ts">
// ============================================================================
// DatapathView.vue —— 数据通路图（JSON 驱动）+ 按后端状态实时高亮
//
// 三层分工：
//   datapathLayout.json  几何：部件放在哪、端口在哪、线怎么走
//   datapathScene.ts     画法：部件外形、三色线、箭头、交叉隆起、标签避让
//   datapathHighlight.ts 语义：本周期哪些线在传值、传的是什么值
//
// 本组件负责把它们拼起来，加上缩放/平移、数值气泡、悬停说明。
//
// 高亮**不在这里算**：交给 stores/wave.ts。因为它还要按「波次」切片——一条指令
// 内部信号是一级一级传下去的，图上应该跟着一波波亮，而不是整条通路同时亮。
// wave.shown 就是「本波为止该亮的东西」，本组件只管画。
// ============================================================================

import { computed, reactive, ref } from 'vue'
import { NSlider } from 'naive-ui'
import { useSimulatorStore } from '@/stores/simulator'
import { useWaveStore } from '@/stores/wave'
import { buildDatapathScene, type DatapathLayout, type SceneMeta } from '@/data/datapathScene'
import layoutJson from '@/data/datapathLayout.json'
import SceneNode from './SceneNode.vue'

const sim = useSimulatorStore()
const wave = useWaveStore()
const st = computed(() => sim.cycleState)

// 布局是常量，场景树只建一次；故意不做成响应式——两千多个节点被 Vue 代理化纯属浪费，
// 真正会变的是下面的高亮结果。
const LAYOUT = layoutJson as unknown as DatapathLayout
const scene = buildDatapathScene(LAYOUT)

// 必须包一层 computed：Pinia 会把 store 上的 ref 解包，直接写 const hl = wave.shown
// 拿到的是**取值那一刻的快照**，之后再推进波次都不会更新。
const hl = computed(() => wave.shown)
const hasState = computed(() => Boolean(st.value))

// ---------------------------------------------------------------- 缩放 / 平移

const svgEl = ref<SVGSVGElement | null>(null)
const view = reactive({ x: 0, y: 0, w: scene.width, h: scene.height })
const ZOOM_MIN = 0.6
const ZOOM_MAX = 1.6
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function resetView() {
  view.x = 0
  view.y = 0
  view.w = scene.width
  view.h = scene.height
}

const zoom = computed(() => clamp(scene.width / view.w, ZOOM_MIN, ZOOM_MAX))

/** 当前 viewBox 映射到屏幕的缩放比与留白（preserveAspectRatio="xMidYMid meet"） */
function mapping() {
  const el = svgEl.value
  if (!el) return null
  const r = el.getBoundingClientRect()
  const s = Math.min(r.width / view.w, r.height / view.h)
  if (!s || !Number.isFinite(s)) return null
  return { s, ox: (r.width - view.w * s) / 2, oy: (r.height - view.h * s) / 2, r }
}

/** 屏幕坐标 → 图坐标 */
function toSvg(clientX: number, clientY: number) {
  const m = mapping()
  if (!m) return null
  return {
    x: view.x + (clientX - m.r.left - m.ox) / m.s,
    y: view.y + (clientY - m.r.top - m.oy) / m.s,
  }
}

function setZoom(value: number | [number, number], anchor?: { x: number; y: number }) {
  const target = Array.isArray(value) ? value[0] : value
  const nw = scene.width / clamp(target, ZOOM_MIN, ZOOM_MAX)
  const p = anchor ?? { x: view.x + view.w / 2, y: view.y + view.h / 2 }
  const k = nw / view.w
  view.x = p.x - (p.x - view.x) * k
  view.y = p.y - (p.y - view.y) * k
  view.w = nw
  view.h = scene.height * (nw / scene.width)
}

function onWheel(ev: WheelEvent) {
  const p = toSvg(ev.clientX, ev.clientY)
  if (!p) return
  const factor = 1.09 // 原缩放步长的 3/4，滚轮缩放更细
  setZoom(ev.deltaY < 0 ? zoom.value * factor : zoom.value / factor, p)
}

let drag: { cx: number; cy: number; vx: number; vy: number } | null = null
const dragging = ref(false)

function onDown(ev: PointerEvent) {
  if (ev.button !== 0) return
  drag = { cx: ev.clientX, cy: ev.clientY, vx: view.x, vy: view.y }
  dragging.value = true
  ;(ev.currentTarget as Element).setPointerCapture(ev.pointerId)
}

function onMove(ev: PointerEvent) {
  if (!drag) return
  const m = mapping()
  if (!m) return
  view.x = drag.vx - (ev.clientX - drag.cx) / m.s
  view.y = drag.vy - (ev.clientY - drag.cy) / m.s
  tooltip.value = null
}

function onUp(ev: PointerEvent) {
  if (!drag) return
  drag = null
  dragging.value = false
  ;(ev.currentTarget as Element).releasePointerCapture(ev.pointerId)
}

// ---------------------------------------------------------------- 数值气泡

// 气泡画在线名落点的正下方，正好复用线名的避让结果（见 datapathScene 的 wireAnchors）。
// 字号与线名一致（15），所以同一批落点不会互相压住。
//
// 三条放置规则（离线核对脚本 tools/hl_preview.mjs 用的是同一套）：
//   1. 落在该连线线名标签的正下方
//   2. 越出画布就往回夹，否则左右边缘那几条会被裁掉半个气泡
//   3. 近处已经有同样数值的气泡就不重复放——单周期图上一串串联的线常带同一个值
//      （比如 src1 数据一路传过 muxa0 和 ALU），全画出来只是一片重复
const BADGE_DY = 30
const BADGE_H = 24
const BADGE_NEAR = 240
const badgeW = (t: string) => t.length * 9 + 14

interface Badge { id: string; x: number; y: number; w: number; text: string }

const badges = computed<Badge[]>(() => {
  if (!st.value) return []
  const out: Badge[] = []
  for (const [id, text] of hl.value.values) {
    const a = scene.wireAnchors[id]
    if (!a) continue
    const w = badgeW(text)
    const x = Math.min(Math.max(a[0], w / 2 + 8), scene.width - w / 2 - 8)
    const y = a[1] + BADGE_DY
    if (out.some((b) => b.text === text && Math.hypot(b.x - x, b.y - y) < BADGE_NEAR)) continue
    out.push({ id, x, y, w, text })
  }
  return out
})

// ---------------------------------------------------------------- 悬停说明

const tooltip = ref<{ title: string; lines: string[]; x: number; y: number } | null>(null)

const modById = new Map(LAYOUT.modules.map((m) => [m.id, m]))
const wireById = new Map(LAYOUT.wires.map((w) => [w.id, w]))

function describe(m: SceneMeta): { title: string; lines: string[] } | null {
  if (m.kind === 'module') {
    const mod = m.id ? modById.get(m.id) : undefined
    if (!mod) return null
    const sub = mod.sub ? (Array.isArray(mod.sub) ? mod.sub : [mod.sub]) : []
    const lines = [...sub]
    if (mod.group) lines.push(`分组：${mod.group}`)
    const lit = m.id && hl.value.modules.has(m.id)
    lines.push(lit ? '本周期被用到' : '本周期未用到')
    return { title: mod.label ?? mod.id, lines }
  }
  if (m.kind === 'wire' || m.kind === 'arrow') {
    const id = m.kind === 'arrow' ? m.id : (m.wires || [])[0]
    const w = id ? wireById.get(id) : undefined
    if (!w) return null
    const lines: string[] = []
    if (w.kind) lines.push(`类型：${w.kind}`)
    if (w.signal) lines.push(`后端字段：${w.signal}`)
    const v = hl.value.values.get(w.id)
    lines.push(v ? `本周期值：${v}` : hl.value.wires.has(w.id) ? '本周期有信号，无显示值' : '本周期无信号')
    return { title: w.label ?? w.id, lines }
  }
  if (m.kind === 'netLabel') {
    const active = m.net ? hl.value.nets.has(m.net) : false
    return { title: `网络 ${m.net}`, lines: [active ? '本周期有效' : '本周期无效'] }
  }
  return null
}

function onHover(m: SceneMeta, ev: MouseEvent) {
  const d = describe(m)
  if (!d) return
  const p = toSvg(ev.clientX, ev.clientY)
  if (!p) return
  tooltip.value = { ...d, x: p.x, y: p.y }
}

function onLeave() {
  tooltip.value = null
}

const TIP_W = 300
const visibleLines = computed(() => tooltip.value?.lines.slice(0, 4) ?? [])
const tipH = computed(() => 34 + visibleLines.value.length * 18)
</script>

<template>
  <div class="dp-wrap">
    <!-- 顶部状态条 -->
    <div class="status-pill">
      <span>周期 #{{ sim.cycleCount }}</span>
      <span class="sep">|</span>
      <span class="mono">{{ st?.pc ?? '0x80000000' }}</span>
      <span class="sep">|</span>
      <span class="mono strong">{{ st?.disassembly ?? '尚未执行指令' }}</span>
      <span v-if="wave.total > 0" class="wave-tag">
        第 {{ wave.waveNo }} / {{ wave.total }} 波
        <em v-if="wave.playing">▶</em>
      </span>
      <span v-if="hl.trapActive" class="trap-tag">异常 / 中断</span>
    </div>

    <!-- 缩放控制 -->
    <div class="zoom-bar">
      <span class="zoom-label">缩放</span>
      <n-slider
        class="zoom-slider"
        :value="zoom"
        :min="ZOOM_MIN"
        :max="ZOOM_MAX"
        :step="0.05"
        :tooltip="false"
        @update:value="setZoom"
      />
      <span class="zoom-value">{{ zoom.toFixed(2) }}×</span>
      <button type="button" @click="resetView">1:1</button>
      <span class="hint">滚轮缩放 · 拖动平移 · 悬停看说明</span>
    </div>

    <!-- 图例 -->
    <div class="legend">
      <span><i class="sw on" />当前通路</span>
      <span><i class="sw fresh" />本波新到</span>
      <span><i class="sw off" />未激活</span>
      <span><i class="sw badge" />实时数值</span>
      <span><i class="sw trap" />异常 / 中断</span>
    </div>

    <svg
      ref="svgEl"
      class="dp-svg"
      :class="{ dragging }"
      :viewBox="`${view.x} ${view.y} ${view.w} ${view.h}`"
      preserveAspectRatio="xMidYMid meet"
      @wheel.prevent="onWheel"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <!-- 场景树：部件 / 连线 / 箭头 / 连接点 / 线名 / 端口名 / 网络标签 -->
      <SceneNode
        v-for="(n, i) in scene.nodes"
        :key="i"
        :node="n"
        :hl="hl"
        :on="hasState"
        :fresh="wave.fresh"
        @hover="onHover"
        @leave="onLeave"
      />

      <!-- 实时数值气泡：画在最上层 -->
      <g class="dp-badges">
        <g v-for="b in badges" :key="b.id" :transform="`translate(${b.x - b.w / 2}, ${b.y - BADGE_H / 2})`">
          <rect :width="b.w" :height="BADGE_H" rx="4" />
          <text :x="b.w / 2" :y="BADGE_H / 2 + 5.5" text-anchor="middle">{{ b.text }}</text>
        </g>
      </g>

      <!-- 悬停说明 -->
      <g v-if="tooltip" class="dp-tip" :transform="`translate(${Math.min(tooltip.x + 16, scene.width - TIP_W - 10)}, ${Math.min(tooltip.y + 16, scene.height - tipH - 10)})`">
        <rect :width="TIP_W" :height="tipH" rx="7" />
        <text x="12" y="22" class="dp-tip-title">{{ tooltip.title }}</text>
        <text v-for="(l, i) in visibleLines" :key="i" x="12" :y="44 + i * 18" class="dp-tip-line">{{ l }}</text>
      </g>
    </svg>

    <div v-if="!sim.connected" class="disconnected">后端未连接：请启动 Python 中间层（端口 8080）。</div>
  </div>
</template>

<style scoped>
.dp-wrap { position: relative; width: 100%; height: 100%; overflow: hidden; background: #f8fafc; }
.dp-svg { display: block; width: 100%; height: 100%; font-family: Inter, "Microsoft YaHei", sans-serif; cursor: grab; touch-action: none; }
.dp-svg.dragging { cursor: grabbing; }

.status-pill { position: absolute; z-index: 3; left: 50%; top: 10px; transform: translateX(-50%); display: flex; gap: 9px; align-items: center; padding: 7px 14px; border-radius: 999px; background: rgba(15,23,42,.9); color: #e2e8f0; font-size: 12px; pointer-events: none; white-space: nowrap; }
.status-pill .sep { color: #64748b; }
.mono { font-family: Consolas, monospace; }
.strong { color: #bfdbfe; }
.trap-tag { padding: 1px 8px; border-radius: 999px; background: #dc2626; color: #fff; font-weight: 700; }
.wave-tag { font-family: Consolas, monospace; color: #93c5fd; }
.wave-tag em { font-style: normal; color: #4ade80; }

.zoom-bar { position: absolute; z-index: 3; left: 12px; top: 10px; display: flex; gap: 8px; align-items: center; padding: 5px 8px; border: 1px solid #e2e8f0; border-radius: 8px; background: rgba(255,255,255,.94); }
.zoom-label, .zoom-value { color: #475569; font-size: 12px; font-weight: 700; }
.zoom-slider { width: 140px; }
.zoom-bar button { padding: 5px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; font-size: 12px; cursor: pointer; }
.zoom-bar button:hover { border-color: #2563eb; color: #2563eb; }
.zoom-bar .hint { color: #94a3b8; font-size: 11px; }

.legend { position: absolute; z-index: 3; left: 12px; bottom: 10px; display: flex; gap: 16px; padding: 6px 12px; border-radius: 8px; background: rgba(255,255,255,.92); border: 1px solid #e2e8f0; color: #475569; font-size: 11px; pointer-events: none; }
.legend span { display: flex; gap: 6px; align-items: center; }
.sw { display: inline-block; width: 22px; height: 0; border-top-width: 4px; border-top-style: solid; }
.sw.on { border-color: #2563eb; }
.sw.fresh { border-top-style: dashed; border-color: #2563eb; }
.sw.off { border-color: #cbd5e1; }
.sw.badge { border: 0; width: 14px; height: 14px; border-radius: 3px; background: #fffbeb; border: 1.6px solid #d97706; }
.sw.trap { border-color: #dc2626; }

.disconnected { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(255,255,255,.75); color: #64748b; font-size: 14px; }
</style>

<!-- 图上的高亮 / 数值气泡 / 悬停说明样式在 src/styles/datapath.css（全局引入）。
     抽出去是因为离线核对脚本 tools/hl_preview.mjs 要内联同一份 CSS 生成截图，
     样式分家的话核对的就是另一套效果。 -->
