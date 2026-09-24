<script setup lang="ts">
import { ref } from 'vue'
import { NConfigProvider, zhCN, NTabs, NTabPane } from 'naive-ui'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import DatapathView from '@/components/datapath/DatapathView.vue'
import RegFilePanel from '@/components/registers/RegFilePanel.vue'
import MemoryView from '@/components/memory/MemoryView.vue'
import InstructionPanel from '@/components/panels/InstructionPanel.vue'
import WaveformPanel from '@/components/panels/WaveformPanel.vue'

// 在较窄的窗口中优先留出数据通路空间；用户仍可手动展开任一侧栏。
const initiallyCompact = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
const leftCollapsed = ref(initiallyCompact)
const rightCollapsed = ref(initiallyCompact)
</script>

<template>
  <n-config-provider :locale="zhCN">
    <div class="app-shell flex flex-col bg-slate-100 text-slate-800">
      <!-- 顶部控制栏 -->
      <AppHeader />

      <div class="flex-1 min-h-0 flex overflow-hidden">
        <!-- 左侧：代码编辑器 + 指令列表 -->
        <AppSidebar :collapsed="leftCollapsed" @toggle="leftCollapsed = !leftCollapsed" />

        <!-- 中央：数据通路可视化 -->
        <main class="flex-1 relative min-w-0">
          <DatapathView />
        </main>

        <!-- 右侧：指令信号 / 寄存器 / 内存 -->
        <aside class="relative shrink-0 border-l border-slate-200 bg-white flex flex-col transition-[width] duration-200" :class="rightCollapsed ? 'w-10' : 'w-[min(340px,30vw)]'">
          <button type="button" class="right-panel-toggle" :aria-label="rightCollapsed ? '展开右侧面板' : '收起右侧面板'" :aria-expanded="!rightCollapsed" aria-controls="right-panel-content" @click="rightCollapsed = !rightCollapsed">
            <ChevronLeft v-if="rightCollapsed" :size="17" />
            <ChevronRight v-else :size="17" />
          </button>
          <n-tabs v-show="!rightCollapsed" id="right-panel-content" type="line" size="small" animated class="flex-1 min-h-0 flex flex-col">
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
.app-shell { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; }
.right-panel-toggle {
  position: absolute;
  z-index: 5;
  top: 8px;
  left: 4px;
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  background: white;
  color: #475569;
}
.right-panel-toggle:hover { color: #2563eb; border-color: #93c5fd; }
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
</style>
