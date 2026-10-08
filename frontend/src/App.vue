<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { NConfigProvider, zhCN, NTabs, NTabPane } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'
import { PanelRightClose, PanelRightOpen } from 'lucide-vue-next'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import DatapathView from '@/components/datapath/DatapathView.vue'
import RegFilePanel from '@/components/registers/RegFilePanel.vue'
import MemoryView from '@/components/memory/MemoryView.vue'
import InstructionPanel from '@/components/panels/InstructionPanel.vue'
import WaveformPanel from '@/components/panels/WaveformPanel.vue'
import GlossaryOverlay from '@/components/glossary/GlossaryOverlay.vue'
import { useLayoutStore } from '@/stores/layout'
import { resolveWorkspaceMode, type WorkspacePanel } from '@/utils/workspaceLayout'

const layout = useLayoutStore()
const viewportEl = ref<HTMLElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
const datapathRef = ref<InstanceType<typeof DatapathView> | null>(null)
const panels: { key: WorkspacePanel; label: string }[] = [
  { key: 'datapath', label: '数据通路' },
  { key: 'editor', label: '汇编代码' },
  { key: 'state', label: '运行状态' },
]
let sizeObserver: ResizeObserver | null = null
let resizeFrame = 0
function updateWorkspace() {
  if (!viewportEl.value) return
  // 测外层宽度，内部出现滚动条不会反过来改变布局判据。
  const next = resolveWorkspaceMode(viewportEl.value.getBoundingClientRect().width, window.innerHeight, layout.mode)
  if (next === 'single' && layout.mode !== 'single') {
    // 正在编辑或查看状态时拖窄窗口，继续显示用户正在操作的工作区。
    const focused = document.activeElement
    if (focused?.closest('#workspace-editor')) layout.activePanel = 'editor'
    else if (focused?.closest('#workspace-state')) layout.activePanel = 'state'
  }
  layout.mode = next
}
onMounted(() => {
  updateWorkspace()
  sizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(updateWorkspace)
  })
  if (viewportEl.value) sizeObserver.observe(viewportEl.value)
})
onUnmounted(() => {
  sizeObserver?.disconnect()
  cancelAnimationFrame(resizeFrame)
})
watch(() => [layout.mode, layout.activePanel], async () => {
  await nextTick()
  scrollEl.value?.scrollTo({ top: 0 })
})

/** naive 的全局主题覆盖。
 *  Tabs 的标签间距默认是 36px（naive 的 tabGapSmallLine），四个标签光间隙就
 *  吃掉 140px —— 右栏稍窄一点，「波形」就会被挤出可视区（实测 261px 宽时确实没了）。
 *  收到 14px 后四个标签在 240px 宽的栏里也放得下。
 *  themeOverrides 是全项目唯一一处改 naive 默认外观的地方，别再散落到组件里。 */
const themeOverrides: GlobalThemeOverrides = {
  Tabs: { tabGapSmallLine: '14px' },
  // naive 的主色默认是**绿色** #18a058，在本项目里只出现在「编译 & 加载」按钮和
  // 顶栏速度滑轨上，跟整页的蓝色调完全不搭。统一改成主色蓝。
  common: {
    primaryColor: '#2563eb',
    primaryColorHover: '#3b82f6',
    primaryColorPressed: '#1d4ed8',
    primaryColorSuppl: '#3b82f6',
  },
}
</script>

<template>
  <!-- abstract 必须保留！不带它时 naive 会渲染一个**没有 height** 的包裹 div，
       夹在 #app 和下面这个根 div 之间，把整条百分比高度链切断 —— 根 div 的
       h-full 退化成 auto、按内容撑高，于是窗口一改比例整个界面就缩成一小块、
       剩下全是空白。删掉 abstract 或给它加 height 都会退回那个状态。
       （它的另一个好处：abstract 不渲染 div，所以不占布局，也不影响 flex。） -->
  <n-config-provider abstract :locale="zhCN" :theme-overrides="themeOverrides">
    <div class="h-full flex flex-col bg-slate-100 text-slate-800">
      <!-- 顶部控制栏 -->
      <AppHeader />

      <nav v-show="layout.mode === 'single'" class="workspace-navigation" aria-label="工作区视图">
        <button v-for="panel in panels" :key="panel.key" type="button"
          :aria-pressed="layout.activePanel === panel.key" :aria-controls="`workspace-${panel.key}`"
          @click="layout.activePanel = panel.key">{{ panel.label }}</button>
      </nav>

      <div ref="viewportEl" class="workspace-viewport flex-1 min-h-0">
        <div ref="scrollEl" class="workspace-scroll">
          <div class="workspace-grid" :class="[`is-${layout.mode}`, { 'left-collapsed': layout.leftConcealed, 'right-collapsed': layout.rightConcealed }]">
            <!-- 左侧：代码编辑器 + 指令列表 -->
            <AppSidebar id="workspace-editor" class="workspace-editor"
              :class="{ 'workspace-hidden': layout.mode === 'single' && layout.activePanel !== 'editor' }"
              :inert="layout.mode === 'single' && layout.activePanel !== 'editor'"
              :aria-hidden="layout.mode === 'single' && layout.activePanel !== 'editor'" />

            <!-- 中央：数据通路可视化 -->
            <main id="workspace-datapath" class="workspace-datapath relative min-w-0 min-h-0 overflow-hidden"
              :class="{ 'workspace-hidden': layout.mode === 'single' && layout.activePanel !== 'datapath' }"
              :inert="layout.mode === 'single' && layout.activePanel !== 'datapath'"
              :aria-hidden="layout.mode === 'single' && layout.activePanel !== 'datapath'">
              <DatapathView ref="datapathRef" />
            </main>

            <!-- 右侧：指令信号 / 寄存器 / 内存 / 波形。
                 折叠逻辑与左侧同源，见 AppSidebar.vue 的注释。 -->
            <aside
              id="workspace-state" class="workspace-state relative flex flex-col min-h-0 min-w-0"
              :class="[layout.rightConcealed ? '' : 'border-l border-slate-200 bg-white overflow-hidden', { 'workspace-hidden': layout.mode === 'single' && layout.activePanel !== 'state' }]"
              :inert="layout.mode === 'single' && layout.activePanel !== 'state'"
              :aria-hidden="layout.mode === 'single' && layout.activePanel !== 'state'"
            >
              <template v-if="layout.rightConcealed">
                <button
                  type="button"
                  class="panel-expand panel-expand-right"
                  title="展开右侧面板"
                  aria-label="展开右侧面板"
                  aria-controls="right-panel-content"
                  :aria-expanded="false"
                  @click="layout.toggleRight()"
                >
                  <PanelRightOpen :size="16" />
                </button>
              </template>

              <n-tabs id="right-panel-content" type="line" size="small" justify-content="space-between" animated class="flex-1 min-h-0 flex flex-col"
                :class="{ 'panel-content-concealed': layout.rightConcealed }"
                :aria-hidden="layout.rightConcealed" :inert="layout.rightConcealed">
                <template v-if="layout.mode === 'wide'" #prefix>
                  <button
                    type="button"
                    class="ml-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-800"
                    title="收起右侧面板"
                    @click="layout.toggleRight()"
                  >
                    <PanelRightClose :size="15" />
                  </button>
                </template>

                <!-- 各 pane 一律保持 overflow-y-auto：RegFilePanel 的 NDataTable 写死
                     :max-height="300"、WaveformPanel 的冻结列依赖 overflow-x-auto 当
                     最近滚动容器，改成 hidden 会让内容被裁且滚不动。 -->
                <n-tab-pane name="signal" tab="指令信号" display-directive="show" class="flex-1 min-h-0 overflow-y-auto">
                  <InstructionPanel />
                </n-tab-pane>
                <n-tab-pane name="reg" tab="寄存器" display-directive="show" class="flex-1 min-h-0 overflow-y-auto">
                  <RegFilePanel />
                </n-tab-pane>
                <n-tab-pane name="mem" tab="内存" display-directive="show" class="flex-1 min-h-0 overflow-y-auto">
                  <MemoryView />
                </n-tab-pane>
                <n-tab-pane name="wave" tab="波形" display-directive="show" class="flex-1 min-h-0 overflow-y-auto">
                  <WaveformPanel />
                </n-tab-pane>
              </n-tabs>
            </aside>
          </div>
        </div>
      </div>

      <!-- 底部状态栏 -->
      <AppFooter :zoom="datapathRef?.zoom ?? 1" :zoom-min="datapathRef?.zoomMin ?? 1" :zoom-max="datapathRef?.zoomMax ?? 1"
        @update:zoom="datapathRef?.setZoom($event)" @reset-view="datapathRef?.resetView()" />
    </div>

    <!-- 百科全书：常驻右侧的浮层，盖在右侧标签栏上。
         刻意放在最外层、且**非模态**——学生要能边读词条边点「单步」试。
         它从 store 读开关，所以数据通路图里的点击也能把它叫起来。 -->
    <GlossaryOverlay />
  </n-config-provider>
</template>
