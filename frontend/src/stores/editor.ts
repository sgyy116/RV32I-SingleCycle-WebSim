// ============================================================================
// editor.ts —— 代码编辑器状态（Pinia）
// ============================================================================

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { EXAMPLES } from '@/data/examples'

export const useEditorStore = defineStore('editor', () => {
  const code = ref(EXAMPLES[0].source)
  const currentExample = ref(0)
  const autoCompile = ref(true)

  function loadExample(index: number) {
    const ex = EXAMPLES[index]
    if (!ex) return
    currentExample.value = index
    code.value = ex.source
  }

  function setSource(source: string) {
    code.value = source
  }

  return { code, currentExample, autoCompile, loadExample, setSource }
})
