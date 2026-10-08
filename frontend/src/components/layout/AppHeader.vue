<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { NSlider, NConfigProvider } from 'naive-ui'
import { Play, Pause, RotateCcw, ChevronRight, ChevronsRight, ArrowLeft, ArrowRight, BookOpen } from 'lucide-vue-next'
import { useSimulatorStore } from '@/stores/simulator'
import { useWaveStore } from '@/stores/wave'
import { useGlossaryStore } from '@/stores/glossary'
// 校徽是仓库里的静态资源，Vite 会收进 dist/assets/ 并改名（env.d.ts 已声明 *.webp）
import hduLogo from '../../../hdu.webp'

const sim = useSimulatorStore()
const wave = useWaveStore()
const glossary = useGlossaryStore()
const headerEl = ref<HTMLElement | null>(null)
const compactBrand = ref(false)
let heightObserver: ResizeObserver | null = null

onMounted(() => {
  const updateHeight = () => {
    const header = headerEl.value
    if (header) {
      const style = getComputedStyle(header)
      const brand = header.querySelector('.header-brand') as HTMLElement
      const name = header.querySelector('.header-name') as HTMLElement
      const margin = (el: Element) => { const s = getComputedStyle(el); return parseFloat(s.marginLeft) + parseFloat(s.marginRight) }
      const groups = [...header.children].filter(el => !el.classList.contains('header-spacer') && el !== brand)
      // 名称隐藏时仍在不可见的绝对定位层中测量，不以当前换行结果作为判据。
      const fullBrand = 32 + 8 + name.getBoundingClientRect().width + margin(brand)
      const required = fullBrand + groups.reduce((n, el) => n + el.getBoundingClientRect().width + margin(el), 0)
        + groups.length * parseFloat(style.columnGap) + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      compactBrand.value = header.clientWidth <= 600 || header.clientWidth < required + 2
    }
    if (headerEl.value) document.documentElement.style.setProperty('--rv-header-h', `${headerEl.value.getBoundingClientRect().height}px`)
  }
  updateHeight()
  heightObserver = new ResizeObserver(updateHeight)
  if (headerEl.value) heightObserver.observe(headerEl.value)
})
onUnmounted(() => heightObserver?.disconnect())

/** 复位要连波次一起清，否则画面上还留着上一份程序的全亮态 */
function onReset() {
  wave.resetWaves()
  sim.reset()
}

// ---------------------------------------------------------------------------
// 顶栏按钮：原生 <button> + Tailwind，不走 naive 的 n-button。
//
// 为什么不用 naive 的按钮：naive 的默认型按钮是「**透明底 + 深灰字 #333639**
// + 浅灰描边」，为浅色背景设计。压在深色顶栏上对比度只有 1.46:1，这就是
// 「单步等指令看不清」的真正原因——**不是底色太深**。而 naive 的按钮要改成
// 白字方案得同时覆盖 color/colorHover/colorPressed/colorFocus/colorDisabled
// 加上 textColor*5、border*5 十几个键，漏一个就会在 hover 的瞬间露出浅底深字。
// 顶栏是全项目唯一的深色区，就这五个按钮 + 两个历史按钮，自己写反而确定。
//
// 代价：失去 naive 的 ripple/focus 动画，所以下面自己补了 focus-visible 描边
// 和 disabled 态。写 Tailwind 类名而不是动态拼字符串，是为了让 Tailwind 的
// 扫描器能直接认出这些类（它是纯文本正则扫的，拼出来的名字扫不到）。
// ---------------------------------------------------------------------------
const BTN_BASE =
  'h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md border text-xs font-bold whitespace-nowrap ' +
  'transition-colors cursor-pointer ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#93c5fd] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'
/** 普通按钮：白字 + 浅描边 + 透明底 */
const BTN_GHOST =
  BTN_BASE +
  ' border-[#64748b] text-[#f8fafc] hover:bg-white/10 hover:border-[#94a3b8] active:bg-white/20' +
  ' disabled:hover:bg-transparent disabled:hover:border-[#64748b]'
/** 主操作（运行）：实心蓝 */
const BTN_PRIMARY =
  BTN_BASE +
  ' border-[#2563eb] bg-[#2563eb] text-white hover:bg-[#3b82f6] hover:border-[#3b82f6] active:bg-[#1d4ed8]' +
  ' disabled:hover:bg-[#2563eb] disabled:hover:border-[#2563eb]'
/** 术语词典展开态 */
const BTN_ON = BTN_BASE + ' border-[#2563eb] bg-[#2563eb] text-white hover:bg-[#3b82f6] hover:border-[#3b82f6]'
/** 只有图标的 */
const BTN_ICON = BTN_GHOST + ' px-2'

/** 速度滑轨在深色顶栏上也必须是浅色，否则深蓝滑轨压在深蓝底上等于没有 */
const sliderTheme = {
  Slider: {
    fillColor: '#93c5fd',
    fillColorHover: '#bfdbfe',
    railColor: 'rgba(255,255,255,.25)',
    railColorHover: 'rgba(255,255,255,.4)',
    handleColor: '#f8fafc',
  },
}
</script>

<template>
  <!-- 顶栏可换行；实际高度同步给词典浮层。示例选择仅保留编辑器内一处。 -->
  <header ref="headerEl" class="app-header shrink-0 flex items-center gap-2 px-3 md:px-4 bg-slate-700 text-[#f8fafc] border-b border-slate-600">
    <!-- Logo：窄屏只留徽标。徽标加白底是因为校徽本身是深色线条，压在 slate-700 上看不清 -->
    <div class="header-brand flex shrink-0 items-center gap-2 mr-2">
      <img :src="hduLogo" alt="杭州电子科技大学" class="w-8 h-8 rounded-lg object-contain bg-white" />
      <div class="header-name leading-tight" :class="{ 'is-concealed': compactBrand }" :aria-hidden="compactBrand">
        <div class="text-sm font-semibold whitespace-nowrap">RV32I 单周期模型机</div>
        <div class="text-[10px] text-slate-300 whitespace-nowrap">教学可视化仿真平台</div>
      </div>
    </div>

    <!-- 术语词典：界面上遇到的任何专有名词都能在这里查到 -->
    <button
      type="button"
      class="header-glossary"
      :class="glossary.open ? BTN_ON : BTN_GHOST"
      title="术语词典：看不懂的部件名、指令名、术语都查这里"
      @click="glossary.toggle()"
    >
      <BookOpen :size="14" />
      <span>术语词典</span>
    </button>

    <div class="header-spacer flex-1 min-w-0"></div>

    <!-- 控制按钮组：粒度由细到粗 -->
    <div class="primary-controls shrink-0 flex items-center gap-1">
        <button type="button" :class="BTN_GHOST" :disabled="!wave.canAdvance" @click="wave.stepWave()">
          <ChevronRight :size="15" />单步
        </button>

        <button type="button" :class="BTN_GHOST" :disabled="!wave.canAdvance" @click="wave.playInstruction()">
          <ChevronsRight :size="15" />单条指令
        </button>

        <button type="button" :class="BTN_PRIMARY" :disabled="!wave.canAdvance || wave.playing" @click="wave.startRun()">
          <Play :size="15" />运行
        </button>

        <button type="button" :class="BTN_GHOST" :disabled="!wave.playing" @click="wave.pause()">
          <Pause :size="15" />暂停
        </button>

        <button type="button" :class="BTN_GHOST" :disabled="!sim.connected" @click="onReset">
          <RotateCcw :size="15" />复位
        </button>
    </div>

    <!-- 速度调节始终可用，窄屏随顶栏换行；嵌套主题让深底上的滑轨可见。 -->
    <n-config-provider abstract :theme-overrides="sliderTheme">
      <div class="header-speed flex shrink-0 items-center gap-2 text-xs font-bold text-white">
        <span class="whitespace-nowrap">速度</span>
        <n-slider v-model:value="wave.speed" class="w-20 2xl:w-24" :min="1" :max="20" :step="1" :tooltip="false" />
        <span class="w-14 font-mono text-slate-300 whitespace-nowrap">{{ wave.speed }} 波/秒</span>
      </div>
    </n-config-provider>

    <!-- 历史步进保留文字，避免仅凭箭头理解操作。 -->
    <div class="header-history flex shrink-0 items-center gap-1">
      <button type="button" :class="BTN_ICON" :disabled="sim.historyIndex <= 0" @click="sim.goBack()">
        <ArrowLeft :size="14" />上一步
      </button>
      <button
        type="button"
        :class="BTN_ICON"
        :disabled="sim.historyIndex >= sim.stateHistory.length - 1"
        @click="sim.goForward()"
      >
        <ArrowRight :size="14" />下一步
      </button>
    </div>
  </header>
</template>

<style scoped>
.header-name { width: max-content; }
.header-name.is-concealed { position: absolute; visibility: hidden; pointer-events: none; }
.app-header { min-height: 56px; padding-top: 8px; padding-bottom: 8px; flex-wrap: wrap; }
@media (max-width: 1100px) {
  .app-header { justify-content: center; }
  .header-spacer { display: none; }
}
/* 窄窗口使用固定分组，避免复位按钮独自换行。 */
@media (max-width: 600px) {
  .app-header { display: grid; grid-template-columns: 32px repeat(3, minmax(0, 1fr)); gap: 6px; padding-inline: 12px; }
  .header-brand { grid-column: 1; grid-row: 1 / 3; margin: 0; }
  .primary-controls { display: contents; }
  .primary-controls button { justify-content: center; padding-inline: 6px; }
  .primary-controls button:nth-child(1) { grid-column: 2; grid-row: 1; }
  .primary-controls button:nth-child(2) { grid-column: 3; grid-row: 1; }
  .primary-controls button:nth-child(3) { grid-column: 4; grid-row: 1; }
  .primary-controls button:nth-child(4) { grid-column: 2; grid-row: 2; }
  .primary-controls button:nth-child(5) { grid-column: 3; grid-row: 2; }
  .header-glossary { grid-column: 4; grid-row: 2; justify-content: center; padding-inline: 4px; }
  .app-header :deep(button svg) { display: none; }
  .header-speed { grid-column: 1 / 3; grid-row: 3; gap: 4px; }
  .header-speed :deep(.n-slider) { width: 64px; }
  .header-speed > span:last-child { width: auto; }
  .header-history { grid-column: 3 / 5; grid-row: 3; justify-content: flex-end; }
  .header-history button { padding-inline: 6px; }
}
@media (max-width: 380px) {
  .header-speed { grid-column: 1 / -1; justify-content: center; }
  .header-history { grid-column: 1 / -1; grid-row: 4; justify-content: center; }
}
</style>
