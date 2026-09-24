<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSimulatorStore } from '@/stores/simulator'

const sim = useSimulatorStore()

// 当前执行到的 PC（高亮）
const currentPc = computed(() => sim.cycleState?.pc ?? null)

// 断点标记
function isBreakpoint(pc: string): boolean {
  return sim.breakpoints.has(pc.toLowerCase())
}

function toggleBp(pc: string) {
  sim.toggleBreakpoint(pc)
}

// ---- 滑动条 + 滚轮滚动（传统方式：滚轮直接滚动列表内容） ----
const listEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const scrollMax = ref(0)

function updateScroll() {
  const el = listEl.value
  if (!el) return
  scrollTop.value = el.scrollTop
  scrollMax.value = Math.max(1, el.scrollHeight - el.clientHeight)
}

function onSlider(v: number) {
  const el = listEl.value
  if (!el) return
  el.scrollTop = (v / 100) * scrollMax.value
  scrollTop.value = el.scrollTop
}

function onWheel(e: WheelEvent) {
  // 传统滚动：滚轮增量直接作用于列表纵向滚动
  const el = listEl.value
  if (!el) return
  e.preventDefault()
  el.scrollTop += e.deltaY
  updateScroll()
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="px-3 py-2 text-xs font-semibold text-slate-500 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
      <span>指令列表（反汇编）</span>
      <span class="text-slate-400 font-normal">{{ sim.disassembly.length }} 条</span>
    </div>
    <div
      ref="listEl"
      class="flex-1 overflow-y-auto instr-scroll"
      @scroll="updateScroll"
      @wheel="onWheel"
    >
      <table class="w-full text-xs font-mono">
        <tbody>
          <tr
            v-for="(ins, i) in sim.disassembly"
            :key="i"
            class="border-b border-slate-100"
            :class="currentPc === ins.pc ? 'bg-blue-100' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50'"
          >
            <td class="pl-2 w-6 cursor-pointer select-none text-center"
                :class="isBreakpoint(ins.pc) ? 'text-red-500' : 'text-transparent hover:text-red-300'"
                @click="toggleBp(ins.pc)">
              ●
            </td>
            <td class="py-1 px-1 text-slate-400 w-24">{{ ins.pc }}</td>
            <td class="py-1 px-1 text-slate-400 w-24">{{ ins.bytes }}</td>
            <td class="py-1 px-1"
                :class="currentPc === ins.pc ? 'text-blue-700 font-bold' : 'text-slate-700'">
              {{ ins.text }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 滑动条（滚动位置指示，可拖动） -->
    <div class="px-3 py-1.5 border-t border-slate-200 bg-slate-50 flex items-center gap-2">
      <span class="text-[10px] text-slate-400 shrink-0">滚动</span>
      <input
        type="range"
        min="0"
        max="100"
        :value="scrollMax > 0 ? Math.round((scrollTop / scrollMax) * 100) : 0"
        class="flex-1 accent-blue-500"
        @input="onSlider(Number(($event.target as HTMLInputElement).value))"
      />
    </div>
  </div>
</template>

<style scoped>
/* 指令列表：常显滑动条（滚动条） */
.instr-scroll::-webkit-scrollbar {
  width: 12px;
}
.instr-scroll::-webkit-scrollbar-track {
  background: #eef2f7;
}
.instr-scroll::-webkit-scrollbar-thumb {
  background: #aebacc;
  border-radius: 6px;
  border: 2px solid #eef2f7;
}
.instr-scroll::-webkit-scrollbar-thumb:hover {
  background: #8fa0b3;
}
</style>
