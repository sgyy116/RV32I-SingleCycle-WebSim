<script setup lang="ts">
// 搜索框 + 分类标签。
//
// 用原生 <input> 而不是 NInput：这里只需要值和占位符，NInput 会带进来一整套
// 主题层、尺寸体系与插槽约定，为了一个搜索框不值。项目零先例，踩坑面却是实打实的。
import { computed } from 'vue'
import { Search, X } from 'lucide-vue-next'
import { useGlossaryStore } from '@/stores/glossary'

const g = useGlossaryStore()

// 读着词条的时候不摆分类标签：那一排标签是「浏览目录」用的，
// 在详情页只会挤占本就有限的宽度
const showChips = computed(() => !g.current)

const chipClass = (active: boolean) =>
  active
    ? 'rounded-full bg-blue-600 px-2 py-0.5 text-[11px] text-white'
    : 'rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:border-slate-300 hover:text-slate-700'
</script>

<template>
  <div class="border-b border-slate-200 px-3 py-2">
    <div class="relative">
      <Search :size="14" class="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        v-model="g.query"
        type="text"
        placeholder="搜术语：寄存器 / register / MUX / ADDI 都行"
        class="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-7 pr-7 text-[13px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:bg-white"
        @keydown.esc.stop.prevent="g.query = ''"
      />
      <button
        v-if="g.query"
        type="button"
        class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        title="清空"
        @click="g.query = ''"
      >
        <X :size="14" />
      </button>
    </div>

    <div v-if="showChips" class="mt-2 flex flex-wrap gap-1">
      <button type="button" :class="chipClass(g.category === 'all')" @click="g.category = 'all'">全部</button>
      <button
        v-for="grp in g.groups"
        :key="grp.id"
        type="button"
        :class="chipClass(g.category === grp.id)"
        @click="g.category = grp.id"
      >{{ grp.label }}</button>
    </div>
  </div>
</template>
