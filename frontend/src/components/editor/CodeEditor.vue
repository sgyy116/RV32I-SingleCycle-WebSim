<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { EditorView, lineNumbers, highlightActiveLine, keymap, drawSelection } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { indentWithTab, defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { defaultHighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, foldGutter } from '@codemirror/language'
import { NButton, NSelect } from 'naive-ui'
import { Play } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'
import { useSimulatorStore } from '@/stores/simulator'
import { riscvLang } from '@/utils/riscvLang'
import { EXAMPLES } from '@/data/examples'

const editor = useEditorStore()
const sim = useSimulatorStore()

const containerRef = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
const languageCompartment = new Compartment()

function createEditor() {
  if (!containerRef.value) return
  view = new EditorView({
    state: EditorState.create({
      doc: editor.code,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        foldGutter(),
        history(),
        bracketMatching(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle),
        languageCompartment.of(riscvLang),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            editor.setSource(update.state.doc.toString())
          }
        }),
      ],
    }),
    parent: containerRef.value,
  })
}

function compileAndLoad() {
  sim.compileAndLoad(editor.code)
}

onMounted(() => {
  createEditor()
})

onUnmounted(() => {
  view?.destroy()
  view = null
})

// 外部更新（如选择示例）时同步编辑器内容
watch(
  () => editor.currentExample,
  () => {
    if (view && view.state.doc.toString() !== editor.code) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: editor.code } })
    }
  },
)
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 工具栏 -->
    <div class="flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50">
      <n-select
        v-model:value="editor.currentExample"
        class="flex-1"
        size="small"
        :options="EXAMPLES.map((e, i) => ({ label: e.name, value: i }))"
        @update:value="editor.loadExample"
      />
      <n-button
        size="small"
        type="primary"
        :loading="sim.compiling"
        :disabled="!sim.connected"
        @click="compileAndLoad"
      >
        <template #icon><Play :size="14" /></template>
        编译 &amp; 加载
      </n-button>
    </div>

    <!-- 编辑器 -->
    <div ref="containerRef" class="flex-1 overflow-hidden text-sm" />
  </div>
</template>

<style scoped>
:deep(.cm-editor) {
  height: 100%;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
}
:deep(.cm-scroller) {
  overflow: auto;
}
</style>
