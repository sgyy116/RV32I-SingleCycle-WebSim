<script setup lang="ts">
// 百科全书浮层的外壳：定位、宽度、左边缘拖拽、ESC、页脚。
//
// 为什么自己搭而不用 NModal / NDrawer：
//   · 必须**非模态**——NModal 的遮罩默认拦截指针事件，学生就没法边读词条边点「单步」，
//     而「边读边试」正是这个功能存在的理由。自己搭就根本不放遮罩元素。
//   · 必须能拖宽且记得住——NDrawer 的宽度是组件内部状态，接进 store 做持久化
//     要跟组件内部同步，绕。
//   · 项目零先例——全项目只用过 NTooltip 一个 naive-ui 组件；引 NDrawer 意味着
//     第一次踩它的 z-index 层与 teleport 挂载点（默认挂到 body，会跑到
//     NConfigProvider 外面把主题丢掉）。
//   · 形态正好——卡在 AppHeader 与 AppFooter 之间，不遮住任何一个工具栏。
//     上下边距走 --rv-header-h / --rv-footer-h（style.css 里的全局变量），
//     不再写死 top-14 / bottom-8，改顶栏底栏高度时不用回来追这里。
//
// 代价是 ESC 与焦点要自己管，就下面这几行。
// 刻意**不做**「点外部关闭」：学生要在浮层外面点数据通路图上的部件，
// 点外部关闭会跟这个动作打架。
import { onMounted, onUnmounted, ref } from 'vue'
import { BookOpen, X } from 'lucide-vue-next'
import { useGlossaryStore } from '@/stores/glossary'
import { ENTRIES } from '@/data/glossary'
import GlossarySearch from './GlossarySearch.vue'
import GlossaryList from './GlossaryList.vue'
import GlossaryEntryView from './GlossaryEntryView.vue'

const g = useGlossaryStore()

function onKey(ev: KeyboardEvent) {
  if (ev.key === 'Escape' && g.open) g.close()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

// ---------------- 左边缘拖宽 ----------------
// 拖动中只改 store 里的 width（每帧都会触发重排，落盘太浪费），
// 松手才写一次 localStorage
const resizing = ref(false)
let start = { x: 0, w: 0 }

function onResizeDown(ev: PointerEvent) {
  if (ev.button !== 0) return
  resizing.value = true
  start = { x: ev.clientX, w: g.width }
  ;(ev.currentTarget as Element).setPointerCapture(ev.pointerId)
}
function onResizeMove(ev: PointerEvent) {
  if (!resizing.value) return
  // 手柄在左边缘：往左拖是变宽，所以是减
  g.setWidth(start.w - (ev.clientX - start.x))
}
function onResizeUp(ev: PointerEvent) {
  if (!resizing.value) return
  resizing.value = false
  g.commitWidth()
  ;(ev.currentTarget as Element).releasePointerCapture(ev.pointerId)
}
</script>

<template>
  <div
    v-if="g.open"
    class="fixed right-0 top-[var(--rv-header-h)] bottom-[var(--rv-footer-h)] z-30 flex flex-col border-l border-slate-200 bg-white shadow-2xl max-w-[92vw]"
    :style="{ width: g.width + 'px' }"
  >
    <div
      class="absolute bottom-0 left-0 top-0 -ml-0.5 w-1.5 cursor-col-resize hover:bg-blue-400/40"
      :class="{ 'bg-blue-400/60': resizing }"
      title="拖动调整宽度"
      @pointerdown="onResizeDown"
      @pointermove="onResizeMove"
      @pointerup="onResizeUp"
      @pointercancel="onResizeUp"
    ></div>

    <header class="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
      <BookOpen :size="15" class="text-blue-600" />
      <span class="text-[13px] font-semibold text-slate-700">术语词典</span>
      <span class="text-[10px] text-slate-400">{{ ENTRIES.length }} 条</span>
      <div class="flex-1"></div>
      <button
        type="button"
        class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        title="关闭（ESC）"
        @click="g.close()"
      >
        <X :size="15" />
      </button>
    </header>

    <GlossarySearch />

    <div class="min-h-0 flex-1 overflow-y-auto">
      <GlossaryEntryView v-if="g.current" />
      <GlossaryList v-else />
    </div>

    <footer class="border-t border-slate-100 px-3 py-1.5 text-[10px] leading-4 text-slate-400">
      点正文里带虚线下划线的蓝词可以跳转；标「本项目自定义」的不是标准术语。
    </footer>
  </div>
</template>
