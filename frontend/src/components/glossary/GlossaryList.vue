<script setup lang="ts">
// 词条列表：没在搜就按分类分组陈列，在搜就平铺结果。
// 「未收录」不是空白页——顶部给一句提示，下面照常摆相近的词条；
// 连相近的都没有（比如学生敲了拼音 jicunqi），就退到最基础的几条，
// 总比甩一个空面板让他以为软件坏了强。
import { computed } from 'vue'
import { useGlossaryStore } from '@/stores/glossary'
import { buildIndex, categoryLabel, parseBody } from '@/data/glossaryQuery'
import { ENTRIES, type GlossaryEntry } from '@/data/glossary'

const g = useGlossaryStore()
const byId = buildIndex(ENTRIES)

/** 没查询也没选分类 → 按分类分组浏览；否则平铺 */
const browsing = computed(() => g.query.trim() === '' && g.category === 'all')

// 分组标题只在每组第一行挂一次，这样整张列表可以用同一段模板渲染，
// 不用把行标记写成两份（两份迟早会改歪一份）
const rows = computed(() => {
  if (browsing.value) {
    return g.groups.flatMap((grp) =>
      grp.entries.map((e, i) => ({ e, group: i === 0 ? grp.label : '' })),
    )
  }
  return g.visibleHits.map((h) => ({ e: h.entry, group: '' }))
})

/** 列表里的一行摘要。截断在 JS 里做，不引 line-clamp（少一个 Tailwind 版本依赖） */
function preview(e: GlossaryEntry): string {
  const text = parseBody(e.body, byId).map((s) => s.text).join('')
  const chars = [...text]
  return chars.length > 52 ? chars.slice(0, 52).join('') + '…' : text
}

/**
 * 「确实收录了，只是被分类筛掉了」这个情形要和「没收录」分开说。
 * 合成一句话会写出「未收录『寄存器』」却又能让学生点「全部」把它变出来——
 * 自相矛盾的提示比没有提示更糟。
 */
const filteredOut = computed(() => !rows.value.length && !g.notFound)
</script>

<template>
  <div class="p-3">
    <div v-if="g.notFound" class="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <div class="text-[12px] font-medium text-amber-700">未收录「{{ g.query }}」</div>
      <div class="mt-0.5 text-[11px] leading-4 text-amber-600">
        {{ rows.length ? '你是不是想找下面这些：' : '暂时没有相近的词条，换个说法试试。' }}
      </div>
    </div>
    <div v-else-if="filteredOut" class="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div class="text-[11px] leading-4 text-slate-500">
        「{{ g.query }}」在「{{ categoryLabel(g.category) }}」这一类里没有匹配，点「全部」看看全部结果。
      </div>
    </div>

    <template v-if="rows.length">
      <!-- 分组标题的间距挂在外层：标签自己是父元素的第一个子元素，
           用 first: 变体永远命中不了「整张列表的第一行」 -->
      <div v-for="(row, i) in rows" :key="row.e.id" :class="i > 0 && row.group ? 'mt-3' : ''">
        <div v-if="row.group" class="mb-1 text-[10px] font-semibold text-slate-400">
          {{ row.group }}
        </div>
        <button
          type="button"
          class="mb-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-left hover:border-blue-300 hover:bg-blue-50/50"
          @click="g.openRoot(row.e.id)"
        >
          <div class="flex items-baseline gap-2">
            <span class="text-[13px] font-medium text-slate-700">{{ row.e.term }}</span>
            <span v-if="row.e.en" class="truncate text-[10px] text-slate-400">{{ row.e.en }}</span>
            <div class="flex-1"></div>
            <span
              v-if="row.e.scope === 'project'"
              class="shrink-0 rounded-full bg-amber-100 px-1.5 text-[9px] text-amber-700"
            >自定义</span>
            <span class="shrink-0 text-[10px] text-slate-300">{{ categoryLabel(row.e.category) }}</span>
          </div>
          <div class="mt-0.5 text-[11px] leading-4 text-slate-500">{{ preview(row.e) }}</div>
        </button>
      </div>
    </template>

    <div v-else>
      <div class="mb-1 text-[10px] font-semibold text-slate-400">先看这些最基础的</div>
      <button
        v-for="e in g.basics"
        :key="e.id"
        type="button"
        class="mb-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-left hover:border-blue-300 hover:bg-blue-50/50"
        @click="g.openRoot(e.id)"
      >
        <span class="text-[13px] font-medium text-slate-700">{{ e.term }}</span>
        <span v-if="e.en" class="ml-2 text-[10px] text-slate-400">{{ e.en }}</span>
      </button>
    </div>
  </div>
</template>
