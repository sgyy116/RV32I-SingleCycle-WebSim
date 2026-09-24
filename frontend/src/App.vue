<script setup lang="ts">
import { NConfigProvider, zhCN, NTabs, NTabPane } from 'naive-ui'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import DatapathCanvas from '@/components/datapath/DatapathCanvas.vue'
import RegFilePanel from '@/components/registers/RegFilePanel.vue'
import MemoryView from '@/components/memory/MemoryView.vue'
import InstructionPanel from '@/components/panels/InstructionPanel.vue'
import WaveformPanel from '@/components/panels/WaveformPanel.vue'
</script>

<template>
  <n-config-provider :locale="zhCN">
    <div class="h-full flex flex-col bg-slate-100 text-slate-800">
      <!-- 顶部控制栏 -->
      <AppHeader />

      <div class="flex-1 flex overflow-hidden">
        <!-- 左侧：代码编辑器 + 指令列表 -->
        <AppSidebar />

        <!-- 中央：数据通路可视化 -->
        <main class="flex-1 relative min-w-0">
          <DatapathCanvas />
        </main>

        <!-- 右侧：指令信号 / 寄存器 / 内存 / 波形 -->
        <aside class="w-[340px] shrink-0 border-l border-slate-200 bg-white flex flex-col">
          <n-tabs type="line" size="small" animated class="flex-1 min-h-0 flex flex-col side-tabs">
            <n-tab-pane name="signal" tab="指令信号" class="flex-1 min-h-0 overflow-y-auto">
              <InstructionPanel />
            </n-tab-pane>
            <n-tab-pane name="reg" tab="寄存器" class="flex-1 min-h-0 overflow-y-auto">
              <RegFilePanel />
            </n-tab-pane>
            <n-tab-pane name="mem" tab="内存" class="flex-1 min-h-0 overflow-y-auto">
              <MemoryView />
            </n-tab-pane>
            <n-tab-pane name="wave" tab="波形" class="flex-1 min-h-0 overflow-y-auto">
              <WaveformPanel />
            </n-tab-pane>
          </n-tabs>
        </aside>
      </div>

      <!-- 底部状态栏 -->
      <AppFooter />
    </div>
  </n-config-provider>
</template>

<style scoped>
:deep(.n-tabs) {
  height: 100%;
}
/* 右沿顶部选项与左沿一致：对称留边 + 加粗 */
:deep(.side-tabs .n-tabs-nav) {
  padding: 0 8px;
}
:deep(.side-tabs .n-tabs-tab) {
  font-weight: 700;
  padding-left: 2px;
  padding-right: 2px;
}
:deep(.n-tab-pane) {
  padding: 0;
}
</style>
