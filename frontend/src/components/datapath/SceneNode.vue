<script setup lang="ts">
// ============================================================================
// SceneNode.vue —— 把 datapathScene.ts 产出的场景树递归渲染成 SVG
//
// 这个组件只做三件事：
//   1. 按 node.tag 生成对应 SVG 元素，node.attrs 直接绑上去（几何全在那里）
//   2. 按 node.meta 判断这个节点当前是否「通电」，加 lit / dim 两个 class
//   3. 把鼠标事件带上 meta 抛给父组件，父组件拿 meta 去查说明文字
//
// 它不含任何几何计算，也不认识后端字段——那些分别在 datapathScene.ts 和
// datapathHighlight.ts 里。这样离线预览（tools/preview.mjs）和网页端渲染的
// 形状永远一致，因为它们读的是同一棵树。
// ============================================================================

import { computed } from 'vue'
import type { SceneMeta, SceneNode } from '@/data/datapathScene'
import type { HighlightResult } from '@/data/datapathHighlight'

const props = defineProps<{
  node: SceneNode
  hl: HighlightResult
  /** 是否已经有周期状态。没有就完全不高亮，保持图纸原色。 */
  on: boolean
  /** 本波「新生」的连线 id。这些线加流动虚线，让学生看清信号刚传到哪一段 */
  fresh: Set<string>
}>()

const emit = defineEmits<{
  (e: 'hover', meta: SceneMeta, ev: MouseEvent): void
  (e: 'leave'): void
}>()

const meta = computed<SceneMeta | undefined>(() => props.node.meta)

/** 真发生了 trap 才把 TRAP 组的部件染红。
    不能写成「TRAP 组的部件被点亮就染红」——csrrw 这类普通 CSR 指令会正常用到
    csr 部件，那时它该是蓝色的「在用」，不是红色的「出事了」。 */
const trapLit = computed<boolean>(
  () => props.on && props.hl.trapActive && meta.value?.kind === 'module' && meta.value.group === 'TRAP',
)

/** 这个节点在当前周期是否通电 */
const lit = computed<boolean>(() => {
  const m = meta.value
  if (!m || !props.on) return false
  if (trapLit.value) return true
  switch (m.kind) {
    // 连线：合并段可能由多条线贡献，任一条激活就整段点亮
    case 'wire':
      return (m.wires || []).some((id) => props.hl.wires.has(id))
    case 'arrow':
      return !!m.id && props.hl.wires.has(m.id)
    case 'netLabel':
      return !!m.net && props.hl.nets.has(m.net)
    case 'module':
      return !!m.id && props.hl.modules.has(m.id)
    default:
      return false
  }
})

/** 有状态时把没通电的连线和箭头压暗，让当前通路浮出来 */
const dim = computed<boolean>(() => {
  const m = meta.value
  if (!m || !props.on || lit.value) return false
  return m.kind === 'wire' || m.kind === 'arrow'
})

/** 这一波刚点亮的连线：加流动虚线。
    只给 wire 加，不给 arrow —— 箭头是实心小三角，虚线化只会把它描边描花。 */
const freshLit = computed<boolean>(() => {
  const m = meta.value
  if (!m || !props.on || !lit.value) return false
  if (m.kind !== 'wire') return false
  return (m.wires || []).some((id) => props.fresh.has(id))
})

function onEnter(ev: MouseEvent) {
  if (meta.value) emit('hover', meta.value, ev)
}
</script>

<template>
  <component
    :is="node.tag"
    v-bind="node.attrs"
    :class="{ 'dp-lit': lit, 'dp-dim': dim, 'dp-trap-lit': trapLit, 'dp-fresh': freshLit }"
    @mouseenter="onEnter"
    @mouseleave="emit('leave')"
  >
    <template v-if="node.children">
      <SceneNode
        v-for="(child, i) in node.children"
        :key="i"
        :node="child"
        :hl="hl"
        :on="on"
        :fresh="fresh"
        @hover="(m: SceneMeta, e: MouseEvent) => emit('hover', m, e)"
        @leave="emit('leave')"
      />
    </template>
    <template v-else-if="node.text !== undefined">{{ node.text }}</template>
  </component>
</template>

<!-- 样式全在 src/styles/datapath.css 里（全局引入），不在本组件写 scoped style：
     离线核对脚本 tools/hl_preview.mjs 会内联同一份 CSS 截图，两份样式必然一致。 -->
