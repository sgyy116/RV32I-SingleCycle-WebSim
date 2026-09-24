<script setup lang="ts">
// ============================================================================
// WaveformPanel.vue —— 波形图（SVG 折线），GTKWave 风格：勾谁画谁
//   电平信号(RegWrite/TRAP…)  → 方波：1=高 0=低
//   数值信号/总线(PC/ALU/寄存器) → 折线：值映射 Y，值变时标注
//   顶栏「选择信号」可勾选内置信号或任意寄存器 x0~x31
// ============================================================================
import { computed, nextTick, ref, watch } from 'vue'
import { useSimulatorStore } from '@/stores/simulator'
import type { CycleSnapshot, CycleState } from '@/types/simulation'

const sim = useSimulatorStore()
const hist = computed<CycleSnapshot[]>(() => sim.stateHistory)
const scrollEl = ref<HTMLElement | null>(null)
const showPicker = ref(false)

const COLW = 30
const RH = 30
const PAD = 6

const REG_NAMES = ['zero','ra','sp','gp','tp','t0','t1','t2','s0','s1',
  'a0','a1','a2','a3','a4','a5','a6','a7','s2','s3','s4','s5','s6','s7',
  's8','s9','s10','s11','t3','t4','t5','t6']

type Def = {
  key: string
  label: string
  kind: 'bit' | 'num'
  bit?: (s: CycleState) => boolean
  num?: (s: CycleState) => number
  color: string
}
const DEFS: Def[] = [
  { key: 'pc', label: 'PC', kind: 'num', num: (s) => parseInt(s.pc, 16) - 0x80000000, color: '#2563eb' },
  { key: 'reg_write', label: 'RegWrite', kind: 'bit', bit: (s) => !!s.control_signals.reg_write, color: '#16a34a' },
  { key: 'alu_src', label: 'ALUSrc', kind: 'bit', bit: (s) => !!s.control_signals.alu_src, color: '#16a34a' },
  { key: 'mem_read', label: 'MemRead', kind: 'bit', bit: (s) => !!s.control_signals.mem_read, color: '#16a34a' },
  { key: 'mem_write', label: 'MemWrite', kind: 'bit', bit: (s) => !!s.control_signals.mem_write, color: '#16a34a' },
  { key: 'branch', label: 'Branch', kind: 'bit', bit: (s) => !!s.control_signals.branch, color: '#16a34a' },
  { key: 'jump', label: 'Jump', kind: 'bit', bit: (s) => !!s.control_signals.jump, color: '#16a34a' },
  { key: 'alu', label: 'ALU', kind: 'num', num: (s) => s.alu.result, color: '#ea580c' },
  { key: 'trap', label: 'TRAP', kind: 'bit', bit: (s) => !!s.trap.taken, color: '#dc2626' },
]
const REG_COLOR = '#7c3aed'   // 寄存器轨迹统一紫色

// 默认选中全部内置信号（寄存器不默认开，避免挤爆）
const selected = ref<Set<string>>(new Set(DEFS.map((d) => d.key)))
function toggle(k: string) {
  const s = new Set(selected.value)
  if (s.has(k)) s.delete(k); else s.add(k)
  selected.value = s
}

// ---- 波形路径生成（离散/骤变：值每周期保持，变化只发生在周期边界，竖直跳变） ----
function stepYPath(ys: number[]): string {
  if (!ys.length) return ''
  let d = ''
  for (let i = 0; i < ys.length; i++) {
    const x0 = i * COLW, x1 = (i + 1) * COLW
    if (i === 0) d += `M ${x0} ${ys[i]}`
    d += ` L ${x1} ${ys[i]}`
    if (i < ys.length - 1 && ys[i] !== ys[i + 1]) d += ` L ${x1} ${ys[i + 1]}`
  }
  return d
}

function bitY(b: boolean) { return b ? PAD : RH - PAD }
function bitRow(label: string, color: string, bits: boolean[]): Row {
  return { label, kind: 'bit', color, path: stepYPath(bits.map(bitY)) }
}

type LabelPt = { x: number; y: number; text: string }
type Row = { label: string; kind: string; color: string; path: string; labels?: LabelPt[] }

function numRow(label: string, color: string, nums: number[]): Row {
  if (!nums.length) return { label, kind: 'num', color, path: '', labels: [] }
  const lo = Math.min(...nums), hi = Math.max(...nums)
  const yOf = (v: number) => (hi > lo ? RH - PAD - ((v - lo) / (hi - lo)) * (RH - 2 * PAD) : RH / 2)
  const ys = nums.map(yOf)
  // 值在变的那一拍开头标注（阶梯：骤变，不是斜线）
  const labels: LabelPt[] = []
  // 十六进制显示；超过 6 位只显示高 4 位加省略号
  const hexLabel = (v: number) => {
    const h = (v >>> 0).toString(16)
    return h.length > 6 ? h.slice(0, 4) + '…' : h
  }
  nums.forEach((v, i) => {
    if (i === 0 || v !== nums[i - 1]) {
      // 信号处于高电平（线段在顶部）时，文字下移到线段下方，避免与信号线重叠
      const high = ys[i] < RH * 0.35
      const y = high ? ys[i] + 12 : Math.max(ys[i] - 3, 10)
      labels.push({ x: i * COLW + COLW / 2, y, text: hexLabel(v) })
    }
  })
  return { label, kind: 'num', color, path: stepYPath(ys), labels }
}

const rows = computed<Row[]>(() => {
  const h = hist.value
  const out: Row[] = []
  for (const k of selected.value) {
    if (k.startsWith('reg:')) {
      const n = parseInt(k.slice(4), 10)
      out.push(numRow(`x${n}(${REG_NAMES[n]})`, REG_COLOR, h.map((s) => s.regfile[n] ?? 0)))
      continue
    }
    const d = DEFS.find((x) => x.key === k)
    if (!d) continue
    if (d.kind === 'bit' && d.bit) out.push(bitRow(d.label, d.color, h.map(d.bit)))
    else if (d.kind === 'num' && d.num) out.push(numRow(d.label, d.color, h.map((s) => d.num!(s))))
  }
  return out
})

// 顶行指令助记符
const instrs = computed(() => hist.value.map((s) => (s.disassembly || '—').split(' ')[0]))
const svgW = computed(() => Math.max(hist.value.length, 1) * COLW)

watch(hist, async () => {
  await nextTick()
  if (scrollEl.value) scrollEl.value.scrollLeft = scrollEl.value.scrollWidth
})
</script>

<template>
  <div class="p-2">
    <!-- 标题 + 选择按钮 -->
    <div class="flex items-center justify-between mb-1.5">
      <span class="text-xs font-semibold text-slate-400">波形（每列=一个周期）</span>
      <button @click="showPicker = !showPicker" class="text-xs text-blue-600 hover:underline">
        选择信号 {{ showPicker ? '▴' : '▾' }}
      </button>
    </div>

    <!-- 信号选择器 -->
    <div v-if="showPicker" class="border border-slate-200 rounded-lg bg-white p-2 mb-2 space-y-2">
      <div>
        <div class="text-[11px] text-slate-400 mb-1">常用信号</div>
        <div class="flex flex-wrap gap-1">
          <button v-for="d in DEFS" :key="d.key" @click="toggle(d.key)"
                  class="px-1.5 py-0.5 rounded text-[11px] border font-mono"
                  :class="selected.has(d.key) ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-400'">
            {{ d.label }}
          </button>
        </div>
      </div>
      <div>
        <div class="text-[11px] text-slate-400 mb-1">寄存器（点一下加入波形）</div>
        <div class="flex flex-wrap gap-1">
          <button v-for="(nm, i) in REG_NAMES" :key="i" @click="toggle('reg:' + i)"
                  class="px-1.5 py-0.5 rounded text-[11px] border font-mono"
                  :class="selected.has('reg:' + i) ? 'bg-violet-100 border-violet-300 text-violet-700' : 'bg-white border-slate-200 text-slate-400'">
            x{{ i }}<span class="opacity-60">/{{ nm }}</span>
          </button>
        </div>
      </div>
      <button @click="showPicker = false" class="w-full text-[11px] text-slate-400 text-right">收起</button>
    </div>

    <div v-if="hist.length" ref="scrollEl" class="overflow-x-auto border border-slate-200 rounded-lg bg-white">
      <div class="min-w-max">
        <!-- 表头：周期号 + 指令 -->
        <div class="flex">
          <div class="sticky left-0 z-10 bg-slate-50 w-[60px] shrink-0 text-xs text-slate-400 px-1.5 py-1">周期</div>
          <div v-for="(_, i) in instrs" :key="'c' + i" class="shrink-0 text-center text-xs text-slate-400 py-1 border-l border-slate-100"
               :style="{ width: COLW + 'px' }">{{ i }}</div>
        </div>
        <div class="flex">
          <div class="sticky left-0 z-10 bg-slate-50 w-[60px] shrink-0 text-xs text-slate-500 font-medium px-1.5 py-1">指令</div>
          <div v-for="(it, i) in instrs" :key="'i' + i" class="shrink-0 text-center text-[11px] font-mono text-slate-500 truncate py-1 border-l border-slate-100"
               :style="{ width: COLW + 'px' }" :title="hist[i].disassembly">{{ it }}</div>
        </div>

        <!-- 每选中信号一行 SVG 波形 -->
        <div v-for="r in rows" :key="r.label" class="flex">
          <div class="sticky left-0 z-10 bg-white w-[60px] shrink-0 text-xs text-slate-500 font-medium px-1.5 flex items-center border-t border-slate-100">{{ r.label }}</div>
          <svg class="shrink-0 border-t border-slate-100" :width="svgW" :height="RH">
            <g v-if="r.kind === 'num' && r.labels">
              <text v-for="(p, i) in r.labels" :key="i" :x="p.x" :y="p.y" text-anchor="middle"
                    :fill="r.color" font-size="10" font-family="monospace">{{ p.text }}</text>
            </g>
            <path :d="r.path" fill="none" :stroke="r.color" stroke-width="1.6" stroke-linejoin="round" />
          </svg>
        </div>
      </div>
    </div>

    <div v-else class="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-400 text-center">
      点「单步」或「运行」后，这里会画出信号波形
    </div>
  </div>
</template>
