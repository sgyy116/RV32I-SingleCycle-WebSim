<script setup lang="ts">
// 把 glossaryQuery.parseBody 切出来的片段画成「纯文本 + 蓝色可点词」。
//
// 用 <button> 而不是 <a>：项目没有 vue-router，<a> 会带上浏览器默认的链接语义
// （可拖拽、可新标签打开、右键菜单里那堆），而这里只是在同一个浮层里换一条词条。
// 不用 v-html：正文没有任何富文本需求，引它只会白送一个 XSS 面。
import type { BodySegment } from '@/data/glossaryQuery'

defineProps<{ segments: BodySegment[] }>()
const emit = defineEmits<{ (e: 'link', id: string): void }>()
</script>

<template>
  <p class="text-[13px] leading-6 text-slate-700">
    <template v-for="(seg, i) in segments" :key="i">
      <button
        v-if="seg.linkId"
        type="button"
        class="gloss-link"
        @click="emit('link', seg.linkId!)"
      >{{ seg.text }}</button>
      <span v-else>{{ seg.text }}</span>
    </template>
  </p>
</template>

<style scoped>
/* 下划线用虚线：正文和链接一眼能分开，又不至于满屏实线晃眼 */
.gloss-link {
  color: #2563eb;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
  cursor: pointer;
}
.gloss-link:hover {
  background: #eff6ff;
}
</style>
