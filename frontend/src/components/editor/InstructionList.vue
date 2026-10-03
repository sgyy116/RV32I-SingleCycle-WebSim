<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useSimulatorStore } from '@/stores/simulator'

const sim = useSimulatorStore()

// 当前执行到的 PC（高亮）
const currentPc = computed(() => sim.cycleState?.pc ?? null)

// 自动跟随：程序跑过 20 条以后，高亮行会滚出可视区，用户得自己找。
// 这里在 PC 变化后把高亮行带回视野。
const listEl = ref<HTMLDivElement | null>(null)
const scrollTop = ref(0)
const scrollMax = ref(0)
let sizeObserver: ResizeObserver | null = null

function updateScroll() {
  if (!listEl.value) return
  scrollTop.value = listEl.value.scrollTop
  scrollMax.value = Math.max(0, listEl.value.scrollHeight - listEl.value.clientHeight)
}

function onSlider(event: Event) {
  if (listEl.value) listEl.value.scrollTop = Number((event.target as HTMLInputElement).value)
  updateScroll()
}

onMounted(() => {
  sizeObserver = new ResizeObserver(updateScroll)
  if (listEl.value) sizeObserver.observe(listEl.value)
  nextTick(updateScroll)
})
onUnmounted(() => sizeObserver?.disconnect())
watch(() => sim.disassembly.length, () => nextTick(updateScroll))

// 用 data-pc 直接查那一行，而不是维护一份元素数组：disassembly 换了程序以后
// 行的数量会变，数组里会留下已经卸载的旧元素，查 DOM 则永远是当前这一份。
watch(currentPc, async (pc) => {
  if (!pc) return
  await nextTick()
  const row = listEl.value?.querySelector<HTMLElement>(`tr[data-pc="${pc}"]`)
  // block:'nearest' —— 行已经在视野里就一动不动，只有滚出可视区才带动。
  // 这样手动拖着看代码时不会被每一步都拽回去。
  row?.scrollIntoView({ block: 'nearest' })
  updateScroll()
})

// 断点标记
function isBreakpoint(pc: string): boolean {
  return sim.breakpoints.has(pc.toLowerCase())
}

function toggleBp(pc: string) {
  sim.toggleBreakpoint(pc)
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="px-3 py-2 text-xs font-semibold text-slate-500 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
      <span>指令列表（反汇编）</span>
      <span class="text-slate-400 font-normal">{{ sim.disassembly.length }} 条</span>
    </div>
    <div ref="listEl" class="flex-1 min-h-0 overflow-y-auto" @scroll="updateScroll">
      <table class="w-full text-xs font-mono">
        <tbody>
          <tr
            v-for="(ins, i) in sim.disassembly"
            :key="i"
            :data-pc="ins.pc"
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
      <input class="w-full accent-blue-600" type="range" min="0" :max="scrollMax"
        :value="scrollTop" :disabled="scrollMax === 0" aria-label="指令列表滚动位置" @input="onSlider" />
    </div>
  </div>
</template>
