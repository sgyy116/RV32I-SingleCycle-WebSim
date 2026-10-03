<script setup lang="ts">
// 词条详情：标题 / 英文名 / 分类与自定义徽章 / 正文（互链）/ 返回上一词条 /
// 相关词条 / 出处小字。
//
// 「本项目自定义」这个徽章不是装饰：本项目里有一部分词是自己发明的
// （最典型的是「波次」），学生把它们当成计算机组成原理的标准术语记下来，
// 到了别的教材里找不到、甚至记反了。徽章负责让他当场看见这件事，
// 正文的第一句也必须自己点明（见 glossary.ts 的写作规矩）。
import { computed } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import { useGlossaryStore } from '@/stores/glossary'
import { buildIndex, categoryLabel, parseBody } from '@/data/glossaryQuery'
import { ENTRIES } from '@/data/glossary'
import GlossaryBody from './GlossaryBody.vue'

const g = useGlossaryStore()
const byId = buildIndex(ENTRIES)

const entry = computed(() => g.current)
const segments = computed(() => (entry.value ? parseBody(entry.value.body, byId) : []))
const related = computed(() =>
  (entry.value?.related ?? []).flatMap((id) => {
    const e = byId.get(id)
    return e ? [e] : []
  }),
)
</script>

<template>
  <div v-if="entry" class="p-3">
    <button
      type="button"
      class="mb-2 flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      @click="g.toList()"
    >
      <ArrowLeft :size="12" />词条列表
    </button>

    <h2 class="text-base font-semibold leading-6 text-slate-800">{{ entry.term }}</h2>
    <div v-if="entry.en" class="mt-0.5 text-[11px] text-slate-400">{{ entry.en }}</div>

    <div class="mt-2 flex flex-wrap items-center gap-1">
      <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
        {{ categoryLabel(entry.category) }}
      </span>
      <span
        v-if="entry.scope === 'project'"
        class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700"
        title="这不是计算机组成原理的标准术语，是本项目自己的约定"
      >本项目自定义</span>
    </div>

    <div class="mt-3">
      <GlossaryBody :segments="segments" @link="g.openLinked($event)" />
    </div>

    <!-- 返回刚才那条。只在「顺着链接跳过来」时出现；
         列表点选与图上点击都会清空历史，所以不会冒出一个不相干的返回目标 -->
    <button
      v-if="g.backTarget"
      type="button"
      class="mt-3 flex w-full items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-600 hover:border-blue-300 hover:text-blue-600"
      @click="g.back()"
    >
      <ArrowLeft :size="12" />返回「{{ g.backTarget.term }}」
    </button>

    <div v-if="related.length" class="mt-4">
      <div class="mb-1 text-[10px] font-semibold text-slate-400">相关</div>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="r in related"
          :key="r.id"
          type="button"
          class="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:border-blue-300 hover:text-blue-600"
          @click="g.openLinked(r.id)"
        >{{ r.term }}</button>
      </div>
    </div>

    <div v-if="entry.sources?.length" class="mt-4 border-t border-slate-100 pt-2">
      <div class="mb-1 text-[10px] font-semibold text-slate-400">出处</div>
      <ul>
        <li
          v-for="(s, i) in entry.sources"
          :key="i"
          class="text-[10px] leading-4 text-slate-400"
        >
          <a
            v-if="s.url"
            :href="s.url"
            target="_blank"
            rel="noopener noreferrer"
            class="underline hover:text-blue-500"
          >{{ s.label }}</a>
          <span v-else>{{ s.label }}</span>
          <span v-if="s.locator"> · {{ s.locator }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
