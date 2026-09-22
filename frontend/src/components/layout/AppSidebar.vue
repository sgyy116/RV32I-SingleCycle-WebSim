<script setup lang="ts">
import { NTabs, NTabPane } from 'naive-ui'
import CodeEditor from '@/components/editor/CodeEditor.vue'
import InstructionList from '@/components/editor/InstructionList.vue'
</script>

<template>
  <aside class="w-[380px] shrink-0 border-r border-slate-200 bg-white flex flex-col">
    <n-tabs type="line" animated size="small" class="flex-1 min-h-0 flex flex-col">
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
  padding: 0 8px;
}
:deep(.n-tab-pane) {
  padding: 0;
}
</style>
