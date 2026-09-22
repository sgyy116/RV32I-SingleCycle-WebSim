<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useSimulatorStore } from '@/stores/simulator'

const sim = useSimulatorStore()
const listEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const scrollMax = ref(0)

// 当前执行到的 PC（高亮）
const currentPc = computed(() => sim.cycleState?.pc ?? null)

// 断点标记
function isBreakpoint(pc: string): boolean {
  return sim.breakpoints.has(pc.toLowerCase())
}

function toggleBp(pc: string) {
  sim.toggleBreakpoint(pc)
}

function updateScroll() {
  const el = listEl.value
  if (!el) return
  scrollTop.value = el.scrollTop
  scrollMax.value = Math.max(0, el.scrollHeight - el.clientHeight)
}

function onSlider(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  scrollTop.value = value
  if (listEl.value) listEl.value.scrollTop = value
}

function onWheel(event: WheelEvent) {
  if (!listEl.value || !scrollMax.value) return
  event.preventDefault()
  listEl.value.scrollTop = Math.max(0, Math.min(scrollMax.value, listEl.value.scrollTop + event.deltaY))
}

onMounted(() => nextTick(updateScroll))
watch(() => sim.disassembly.length, () => nextTick(updateScroll))
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="px-3 py-2 text-xs font-semibold text-slate-500 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
      <span>指令列表（反汇编）</span>
      <span class="text-slate-400 font-normal">{{ sim.disassembly.length }} 条</span>
    </div>
    <div ref="listEl" class="flex-1 overflow-y-auto" @scroll="updateScroll" @wheel="onWheel">
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
    <div class="px-3 py-2 border-t border-slate-200 bg-slate-50">
      <input
        class="w-full accent-blue-600"
        type="range"
        min="0"
        :max="scrollMax"
        :value="scrollTop"
        :disabled="scrollMax === 0"
        aria-label="指令列表滚动位置"
        @input="onSlider"
      />
    </div>
  </div>
</template>
