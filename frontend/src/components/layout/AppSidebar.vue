<script setup lang="ts">
import { NTabs, NTabPane } from 'naive-ui'
import CodeEditor from '@/components/editor/CodeEditor.vue'
import InstructionList from '@/components/editor/InstructionList.vue'
</script>

<template>
  <aside class="w-[380px] shrink-0 border-r border-slate-200 bg-white flex flex-col">
    <n-tabs type="line" animated size="small" class="flex-1 min-h-0 flex flex-col side-tabs">
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
/* “汇编代码 / 指令代码”对称留边：nav 左右等距内边距 + 标签间距 */
:deep(.side-tabs .n-tabs-nav) {
  padding: 0 28px;
}
:deep(.side-tabs .n-tabs-tab) {
  font-weight: 700;
  padding-left: 14px;
  padding-right: 14px;
}
:deep(.n-tab-pane) {
  padding: 0;
}
</style>
