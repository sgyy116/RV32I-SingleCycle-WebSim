// ============================================================================
// layout.ts —— 工作区重排、视图选择和宽屏折叠状态（Pinia）
//
// 为什么必须是 store、不能放 App.vue 的 ref：左栏的折叠按钮长在 AppSidebar 里，
// 而左栏 <aside> 元素本身写在 App.vue 里——两者是**兄弟**，够不到对方的 ref。
// （同一个理由见 glossary.ts 开头的说明。）
//
// 宽屏三栏、较窄窗口上下两层、窄屏单列。布局模式不写入持久化偏好，
// 浏览器窗口与缩放后的有效宽高比和宽度决定模式；宽屏折叠偏好继续独立保留。
//
// 折叠的形态约束：**不能**用 display:none / v-show。CodeMirror 在 display:none
// 的容器里量到的高度是 0，再展开时可能整片白。当前收起时用 visibility 和
// inert 保留组件实例；展开重新测量编辑器，不销毁撤销栈、光标和面板选项。
// ============================================================================

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { resolveWorkspaceMode, type WorkspaceMode, type WorkspacePanel } from '@/utils/workspaceLayout'

const LEFT_KEY = 'rv32i.layout.leftCollapsed'
const RIGHT_KEY = 'rv32i.layout.rightCollapsed'

/** 窄于这个宽度、且用户还没手动表过态时，默认把两侧都收起来，先保证图够大 */
const NARROW_PX = 1000

/** 读持久化偏好。隐私模式下 localStorage 本身就可能抛，读不到就返回 null 交给调用方 */
function read(key: string): boolean | null {
  try {
    const v = localStorage.getItem(key)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* 读不到就当作没有偏好 */
  }
  return null
}

function write(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? '1' : '0')
  } catch {
    /* 存不下也不影响本次会话 */
  }
}

/** 没有偏好时按窗口宽度定初值；有偏好就一律听用户的 */
function initial(pref: boolean | null): boolean {
  if (pref !== null) return pref
  return window.innerWidth < NARROW_PX
}

export const useLayoutStore = defineStore('layout', () => {
  const mode = ref<WorkspaceMode>(resolveWorkspaceMode(window.innerWidth, window.innerHeight))
  const activePanel = ref<WorkspacePanel>('datapath')
  const leftCollapsed = ref(initial(read(LEFT_KEY)))
  const rightCollapsed = ref(initial(read(RIGHT_KEY)))
  // 折叠偏好只用于宽屏；上下布局始终提供两个面板，单列布局按当前视图展示。
  const leftConcealed = computed(() => mode.value === 'wide' && leftCollapsed.value)
  const rightConcealed = computed(() => mode.value === 'wide' && rightCollapsed.value)
  const editorVisible = computed(() => !leftConcealed.value && (mode.value !== 'single' || activePanel.value === 'editor'))

  // 只要用户动过一次，之后就一直按他选的来，不再看窗口宽度
  watch(leftCollapsed, (v) => write(LEFT_KEY, v))
  watch(rightCollapsed, (v) => write(RIGHT_KEY, v))

  function toggleLeft() {
    leftCollapsed.value = !leftCollapsed.value
  }
  function toggleRight() {
    rightCollapsed.value = !rightCollapsed.value
  }

  return { mode, activePanel, leftConcealed, rightConcealed, editorVisible, leftCollapsed, rightCollapsed, toggleLeft, toggleRight }
})
