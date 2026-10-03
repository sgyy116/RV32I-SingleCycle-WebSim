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

import { computed, onUnmounted, reactive, ref } from 'vue'
import { NSlider } from 'naive-ui'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import { useSimulatorStore } from '@/stores/simulator'
import { useWaveStore } from '@/stores/wave'
import { useGlossaryStore } from '@/stores/glossary'
import { buildDatapathScene, type DatapathLayout, type SceneMeta } from '@/data/datapathScene'
import { WIRE_KINDS, wireKindLabel } from '@/data/datapathPalette'
import layoutJson from '@/data/datapathLayout.json'
import SceneNode from './SceneNode.vue'

const sim = useSimulatorStore()
const wave = useWaveStore()
const glossary = useGlossaryStore()
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

function resetView() {
  view.x = 0
  view.y = 0
  view.w = scene.width
  view.h = scene.height
}

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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const zoom = computed(() => clamp(scene.width / view.w, ZOOM_MIN, ZOOM_MAX))

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
  // 与 v1.3.1 相同的小步长；滑块和滚轮共用边界及坐标换算。
  const factor = 1.09
  setZoom(ev.deltaY < 0 ? zoom.value * factor : zoom.value / factor, p)
}

let drag: { cx: number; cy: number; vx: number; vy: number } | null = null
const dragging = ref(false)

// ---------------------------------------------------------------- 点击部件查词条
//
// 为什么要自己判「这是点击还是拖动」：onDown 里调了 setPointerCapture，指针捕获一旦
// 成立，浏览器会把这次按下派生的 click **重定向到捕获元素 <svg>**，挂在部件 <g> 上的
// @click 根本收不到事件——而且不报错，静默失效，是最难查的那种坏法。
//
// 也不能改用 event.target / closest('g.module')：连线、线名、网络标签都画在部件
// **之上**，在框里点一下，target 很可能落在压着它的某条线上。
//
// 所以点击判定放在 onUp：按下后位移没超过阈值，就算点击，再做一遍几何命中。
// ⚠️ 这段的正确性依赖 onDown 里那次 setPointerCapture 与这里的阈值判定成对存在。
//    日后若有人「顺手」把捕获挪到别处或改回 DOM @click，先重读这段。
let gesture: { x: number; y: number; moved: boolean } | null = null
/** 屏幕像素。触控板手抖一般 1~2px，4 足够容错，又不至于把真的拖动误判成点击 */
const CLICK_SLOP = 4

// 部件命中表。view 与 toSvg 用的都是**渲染坐标系**，而 JSON 里 module 的 x/y/w/h
// 是示意图原始坐标（见 datapathScene 主入口的 sc 乘法），所以这里同样要乘 scale。
// 各 shape（梯形 ALU、胶囊 MUX、椭圆、直角矩形）都画在这个方框之内，方框即命中区。
const HIT_RECTS = (() => {
  const sc = Number(LAYOUT.scale) || 1
  return LAYOUT.modules.map((m) => ({
    id: m.id,
    label: m.label ?? m.id,
    x: m.x * sc,
    y: m.y * sc,
    w: m.w * sc,
    h: m.h * sc,
    area: m.w * m.h,
  }))
})()

function moduleAt(clientX: number, clientY: number) {
  const p = toSvg(clientX, clientY)
  if (!p) return null
  let best: (typeof HIT_RECTS)[number] | null = null
  for (const r of HIT_RECTS) {
    if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) continue
    // 命中多个时取面积最小的那个：MUX 胶囊紧贴着别的框，不该被外面的大框吞掉
    if (!best || r.area < best.area) best = r
  }
  return best
}

function onDown(ev: PointerEvent) {
  if (ev.button !== 0) return
  ev.preventDefault()
  drag = { cx: ev.clientX, cy: ev.clientY, vx: view.x, vy: view.y }
  gesture = { x: ev.clientX, y: ev.clientY, moved: false }
  dragging.value = true
  ;(ev.currentTarget as Element).setPointerCapture(ev.pointerId)
}

function onMove(ev: PointerEvent) {
  if (!drag) return
  if (gesture && !gesture.moved) {
    if (Math.hypot(ev.clientX - gesture.x, ev.clientY - gesture.y) > CLICK_SLOP) gesture.moved = true
  }
  const m = mapping()
  if (!m) return
  view.x = drag.vx - (ev.clientX - drag.cx) / m.s
  view.y = drag.vy - (ev.clientY - drag.cy) / m.s
  tooltip.value = null
}

function onUp(ev: PointerEvent) {
  if (!drag) return
  // pointercancel 也走这个函数，被系统取消的手势不该算点击
  const wasClick = ev.type === 'pointerup' && gesture !== null && !gesture.moved
  drag = null
  gesture = null
  dragging.value = false
  ;(ev.currentTarget as Element).releasePointerCapture(ev.pointerId)
  if (!wasClick) return
  const hit = moduleAt(ev.clientX, ev.clientY)
  if (hit) glossary.openFromModule(hit.id, hit.label)
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
    // 显示中文类别名而不是 kind 这个英文 token —— 界面是中文的，
    // 「类型：control」对学生等于没写。
    if (w.kind) lines.push(`类型：${wireKindLabel(w.kind)}`)
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

// ---------------------------------------------------------------- 图例

/** 窄屏默认收起：图例占左下角，主区一窄它就开始盖图。
 *  门槛取 1280 是因为主区 = 窗口 − 左栏(clamp 240~380) − 右栏(clamp 240~340)，
 *  1300 以下主区就不到 700px，两行图例横着铺不下。 */
const legendOpen = ref(false)
/** 用户手动点过之后就不再自动跟随窗口宽度 —— 他的选择优先。 */
let legendTouched = false
const mqWide = window.matchMedia('(min-width: 1280px)')
/** 具名函数，不能写成两个匿名箭头函数 —— 那样 add 和 remove 拿到的不是同一个
 *  引用，removeEventListener 会静默失效，监听器越积越多。 */
function onMqChange(e: MediaQueryListEvent) {
  if (!legendTouched) legendOpen.value = e.matches
}
if (!legendTouched) legendOpen.value = mqWide.matches
mqWide.addEventListener('change', onMqChange)
onUnmounted(() => mqWide.removeEventListener('change', onMqChange))

function toggleLegend() {
  legendTouched = true
  legendOpen.value = !legendOpen.value
}
</script>

<template>
  <div class="dp-wrap">
    <!-- 缩放和指令状态共用工具条；空间不足时换行，不叠压。 -->
    <div class="dp-toolbar">
      <!-- 缩放控制 -->
      <div class="zoom-bar">
        <span class="zoom-label">缩放</span>
        <n-slider class="zoom-slider" :value="zoom" :min="ZOOM_MIN" :max="ZOOM_MAX"
          :step="0.05" :tooltip="false" @update:value="setZoom" />
        <span class="zoom-value">{{ zoom.toFixed(2) }}×</span>
        <button type="button" @click="resetView">1:1</button>
      </div>

      <!-- 顶部状态条 -->
      <div class="status-pill">
        <span>周期 #{{ sim.cycleCount }}</span>
        <span class="sep">|</span>
        <span class="mono">{{ st?.pc ?? '0x80000000' }}</span>
        <span class="sep">|</span>
        <span class="mono strong instruction-text">{{ st?.disassembly ?? '尚未执行指令' }}</span>
        <span v-if="wave.total > 0" class="wave-tag">
          第 {{ wave.waveNo }} / {{ wave.total }} 波
          <em v-if="wave.playing">▶</em>
        </span>
        <span v-if="hl.trapActive" class="trap-tag">异常 / 中断</span>
      </div>
    </div>

    <!-- 图例。两行：上面是「线传的是什么」，下面是「高亮表示什么」。
         上面那一行的色块**全部由 WIRE_KINDS 渲染**，本组件里不出现任何 hex ——
         图例和图上画的线读的是同一张表，所以不可能出现「图例说蓝、图上画绿」。

         状态行里原来的「异常 / 中断」删掉了：红色线已经表达了同一件事，
         留着会变成「两个红说的是两件事」。 -->
    <div class="legend">
      <button type="button" class="lg-toggle" :title="legendOpen ? '收起图例' : '展开图例'" @click="toggleLegend">
        <ChevronDown v-if="legendOpen" :size="12" />
        <ChevronRight v-else :size="12" />
        图例
      </button>

      <template v-if="legendOpen">
        <div class="lg-row">
          <span class="lg-cap">线的类别</span>
          <span v-for="k in WIRE_KINDS" :key="k.kind" class="lg-item">
            <!-- 只有色块可点（且只有它开 pointer-events）—— 容器整块开 auto 会挡住
                 图区左下角的平移和连线悬停。点开的是「线型」词条。 -->
            <button
              type="button"
              class="lg-sw"
              :title="`${k.label}：点开「线型」词条`"
              @click="glossary.openRoot('wire-type')"
            >
              <i class="sw" :style="{ borderTopColor: k.color, borderTopStyle: k.dash ? 'dashed' : 'solid' }" />
            </button>
            {{ k.label }}
          </span>
        </div>

        <div class="lg-row">
          <span class="lg-cap">高亮状态</span>
          <span class="lg-item"><i class="sw on" />当前通路</span>
          <span class="lg-item"><i class="sw fresh" />本波新到</span>
          <span class="lg-item"><i class="sw off" />未激活</span>
          <span class="lg-item"><i class="sw badge" />实时数值</span>
        </div>
      </template>
    </div>

    <svg
      ref="svgEl"
      class="dp-svg"
      :class="{ dragging }"
      :viewBox="`${view.x} ${view.y} ${view.w} ${view.h}`"
      preserveAspectRatio="xMidYMid meet"
      @wheel.prevent="onWheel"
      @dragstart.prevent
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

/* 缩放条和状态条共同参与排版，窄窗口换行，空白区域仍可操作图。 */
.dp-toolbar { position: absolute; z-index: 3; top: 10px; left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100% - 20px); display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 8px; pointer-events: none; }

.status-pill { justify-self: center; min-width: 0; overflow: hidden; display: flex; gap: 9px; align-items: center; padding: 7px 14px; border-radius: 999px; background: rgba(15,23,42,.9); color: #e2e8f0; font-size: 12px; pointer-events: none; white-space: nowrap; }
.status-pill { max-width: 100%; }
.instruction-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.status-pill .sep { color: #64748b; }
.mono { font-family: Consolas, monospace; }
.strong { color: #bfdbfe; }
.trap-tag { padding: 1px 8px; border-radius: 999px; background: #dc2626; color: #fff; font-weight: 700; }
.wave-tag { font-family: Consolas, monospace; color: #93c5fd; }
.wave-tag em { font-style: normal; color: #4ade80; }

.zoom-bar { min-width: 0; max-width: 100%; display: flex; gap: 8px; align-items: center; padding: 5px 8px; border: 1px solid #e2e8f0; border-radius: 8px; background: rgba(255,255,255,.94); pointer-events: auto; }
.zoom-label, .zoom-value { flex-shrink: 0; color: #475569; font-size: 12px; font-weight: 700; }
.zoom-slider { width: clamp(70px, 14vw, 140px); }
.zoom-bar button { pointer-events: auto; padding: 5px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; font-size: 12px; cursor: pointer; }
.zoom-bar button:hover { border-color: #2563eb; color: #2563eb; }

/* 图例：两行，窄屏自动换行。整块保持 pointer-events:none —— 它压在图上，
   开 auto 会挡住左下角的平移与连线悬停。只有折叠按钮和色块单独开。 */
.legend { position: absolute; z-index: 3; left: 12px; bottom: 10px; display: flex; flex-direction: column; gap: 3px; padding: 5px 10px; border-radius: 8px; background: rgba(255,255,255,.94); border: 1px solid #e2e8f0; color: #475569; font-size: 11px; pointer-events: none; max-width: min(720px, calc(100% - 24px)); }
.legend .lg-row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 14px; }
.legend .lg-cap { color: #94a3b8; }
.legend .lg-item { display: flex; gap: 6px; align-items: center; }
.legend .lg-toggle { display: flex; gap: 3px; align-items: center; align-self: flex-start; margin-left: -4px; padding: 1px 4px; border: 0; border-radius: 4px; background: none; color: #64748b; font: inherit; cursor: pointer; pointer-events: auto; }
.legend .lg-toggle:hover { background: #f1f5f9; color: #0f172a; }
.legend .lg-sw { display: flex; align-items: center; margin: 0; padding: 5px 2px; border: 0; background: none; cursor: pointer; pointer-events: auto; }
.legend .lg-sw:hover { background: #f1f5f9; }
.sw { display: inline-block; width: 22px; height: 0; border-top-width: 4px; border-top-style: solid; }
.sw.on { border-color: #2563eb; }
.sw.fresh { border-top-style: dashed; border-color: #2563eb; }
.sw.off { border-color: #cbd5e1; }
.sw.badge { border: 0; width: 14px; height: 14px; border-radius: 3px; background: #fffbeb; border: 1.6px solid #d97706; }

.disconnected { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(255,255,255,.75); color: #64748b; font-size: 14px; }
</style>

<!-- 图上的高亮 / 数值气泡 / 悬停说明样式在 src/styles/datapath.css（全局引入）。
     抽出去是因为离线核对脚本 tools/hl_preview.mjs 要内联同一份 CSS 生成截图，
     样式分家的话核对的就是另一套效果。 -->
