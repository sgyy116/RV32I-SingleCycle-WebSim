<script setup lang="ts">
import { NTabs, NTabPane } from 'naive-ui'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'
import CodeEditor from '@/components/editor/CodeEditor.vue'
import InstructionList from '@/components/editor/InstructionList.vue'
import { useLayoutStore } from '@/stores/layout'

const layout = useLayoutStore()
</script>

<template>
  <!--
    收起时保留组件实例，用 visibility 和 inert 隐藏交互，保留撤销栈与光标。
    展开态宽度用 clamp：窄屏自动收窄，不必等用户去点折叠。
  -->
  <aside
    class="relative shrink-0 flex flex-col min-h-0 transition-[width] duration-200"
    :class="layout.leftCollapsed ? 'w-0' : 'w-[clamp(240px,26vw,380px)] border-r border-slate-200 bg-white overflow-hidden'"
  >
    <template v-if="layout.leftCollapsed">
      <button
        type="button"
        class="panel-expand panel-expand-left"
        title="展开左侧面板"
        aria-label="展开左侧面板"
        aria-controls="left-panel-content"
        :aria-expanded="false"
        @click="layout.toggleLeft()"
      >
        <PanelLeftOpen :size="16" />
      </button>
    </template>

    <n-tabs id="left-panel-content" type="line" animated size="small" class="flex-1 min-h-0 flex flex-col"
      :class="{ 'panel-content-concealed': layout.leftCollapsed }"
      :aria-hidden="layout.leftCollapsed" :inert="layout.leftCollapsed">
      <!-- 折叠按钮挂在 tab 栏右端（naive 的 suffix 插槽），省掉单独一整行标题栏 -->
      <template #suffix>
        <button
          type="button"
          class="mr-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-800"
          title="收起左侧面板"
          @click="layout.toggleLeft()"
        >
          <PanelLeftClose :size="15" />
        </button>
      </template>

      <n-tab-pane name="editor" tab="汇编代码" display-directive="show" class="flex-1 min-h-0">
        <CodeEditor />
      </n-tab-pane>
      <n-tab-pane name="instr" tab="指令列表" display-directive="show" class="flex-1 min-h-0">
        <InstructionList />
      </n-tab-pane>
    </n-tabs>
  </aside>
</template>
