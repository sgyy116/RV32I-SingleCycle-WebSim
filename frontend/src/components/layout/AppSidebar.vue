<script setup lang="ts">
import { NTabs, NTabPane } from 'naive-ui'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import CodeEditor from '@/components/editor/CodeEditor.vue'
import InstructionList from '@/components/editor/InstructionList.vue'

defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ (e: 'toggle'): void }>()
</script>

<template>
  <aside id="left-panel" class="relative shrink-0 border-r border-slate-200 bg-white flex flex-col transition-[width] duration-200" :class="collapsed ? 'w-10' : 'w-[min(380px,32vw)]'">
    <button type="button" class="panel-toggle right-1" :aria-label="collapsed ? '展开左侧面板' : '收起左侧面板'" :aria-expanded="!collapsed" aria-controls="left-panel-content" @click="emit('toggle')">
      <ChevronRight v-if="collapsed" :size="17" />
      <ChevronLeft v-else :size="17" />
    </button>
    <n-tabs v-show="!collapsed" id="left-panel-content" type="line" animated size="small" class="flex-1 min-h-0 flex flex-col">
      <n-tab-pane name="editor" tab="汇编代码" class="flex-1 min-h-0">
        <CodeEditor />
      </n-tab-pane>
      <n-tab-pane name="instr" tab="指令列表" class="flex-1 min-h-0">
        <InstructionList />
      </n-tab-pane>
    </n-tabs>
  </aside>
</template>

<style scoped>
:deep(.n-tabs) {
  height: 100%;
}
:deep(.n-tabs-nav) {
  padding: 0 28px;
}
:deep(.n-tabs-tab) {
  font-weight: 700;
  padding: 14px 10px;
}
:deep(.n-tab-pane) {
  padding: 0;
}
.panel-toggle {
  position: absolute;
  z-index: 5;
  top: 8px;
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  background: white;
  color: #475569;
}
.panel-toggle:hover { color: #2563eb; border-color: #93c5fd; }
</style>
