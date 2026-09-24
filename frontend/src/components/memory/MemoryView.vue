<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NInput } from 'naive-ui'
import { RefreshCw } from 'lucide-vue-next'
import { useSimulatorStore } from '@/stores/simulator'
import { useWaveStore } from '@/stores/wave'

const sim = useSimulatorStore()
const wave = useWaveStore()
const g = computed(() => wave.gates)

const baseAddr = ref('0x80000000')

const rows = computed(() => {
  const dump = sim.memoryDump
  if (!dump) return []
  const base = parseInt(dump.addr, 16)
  const bytes = dump.bytes
  const out: Array<{ addr: string; bytes: string[] }> = []
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    out.push({
      addr: '0x' + (base + i).toString(16),
      bytes: [
        bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3],
      ].map((b) => (b & 0xff).toString(16).padStart(2, '0')),
    })
  }
  return out
})

// 本周期被访问的地址。只门控这一处黄色高亮：内存内容是 mount / 换程序时异步
// 拉一次的快照，本来就不跟周期走，为动画去重新拉取只会让整块内容闪烁。
// 这里只保证「访问波还没到就先别标黄」。
const accessAddr = computed(() => {
  if (!g.value.mem) return null
  const m = sim.cycleState?.memory
  if (m && (m.access_type === 'READ' || m.access_type === 'WRITE')) return m.addr
  return null
})

function isHighlighted(rowAddr: string): boolean {
  if (!accessAddr.value) return false
  const a = parseInt(accessAddr.value, 16)
  const r = parseInt(rowAddr, 16)
  return a >= r && a < r + 4
}

function fetchMemory() {
  sim.fetchMemory(baseAddr.value, 32)
}

function onAddrInput() {
  fetchMemory()
}

onMounted(() => {
  setTimeout(fetchMemory, 800)
})

// 程序加载后自动刷新
watch(() => sim.programEntry, () => {
  baseAddr.value = sim.programEntry
  fetchMemory()
})
</script>

<template>
  <div>
    <div class="px-3 py-2 text-xs font-semibold text-slate-500 bg-slate-50 flex items-center justify-between">
      <span>数据存储器 (DMEM)</span>
      <div class="flex items-center gap-1">
        <n-input
          v-model:value="baseAddr"
          size="tiny"
          class="w-28"
          placeholder="地址"
          @keyup.enter="onAddrInput"
          @blur="onAddrInput"
        />
        <n-button size="tiny" quaternary @click="fetchMemory">
          <template #icon><RefreshCw :size="12" /></template>
        </n-button>
      </div>
    </div>
    <div v-if="rows.length" class="p-2 font-mono text-[11px]">
      <div
        v-for="(row, i) in rows"
        :key="i"
        class="flex items-center gap-2 py-0.5 rounded px-1"
        :class="isHighlighted(row.addr) ? 'bg-amber-100' : ''"
      >
        <span class="w-24 text-slate-400 shrink-0">{{ row.addr }}</span>
        <span class="text-slate-600">{{ row.bytes.join(' ') }}</span>
        <span v-if="isHighlighted(row.addr)" class="ml-auto text-[9px] text-amber-600">访问</span>
      </div>
    </div>
    <div v-else class="p-3 text-xs text-slate-400">
      暂无内存数据。加载程序后自动读取。
    </div>
  </div>
</template>
