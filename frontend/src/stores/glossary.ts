// ============================================================================
// glossary.ts —— 百科全书浮层的状态（Pinia）
//
// 为什么必须是个 store、不能放 App.vue 的 ref：浮层挂在 App.vue 下，而「点数据通路图
// 上的部件」这件事发生在 DatapathView 里（App.vue > main > DatapathView），两者是
// **兄弟**，够不到对方的 ref。项目本来就有 3 个 store，DatapathView 也已经在用
// simulator / wave，多一个零学习成本。
//
// 浮层的形态约束（决定了下面这些状态设计）：
//   · 非模态——学生要能边读词条边点「单步」，所以没有任何遮罩、不锁滚动、不抢焦点
//   · 常驻右侧，盖在「指令信号/寄存器/内存/波形」那一栏上面，不改变主布局
//   · 宽度可拖、可持久化，关掉浏览器再打开还是上次那条宽度
//
// 历史栈只记「顺着正文里的链接跳过去」这一种动作。列表点选和图上点击都是
// 「换一个主题重开」，会把历史清空——学生按返回时不该退回上一个不相干的词。
// ============================================================================

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ENTRIES, GLOSSARY_CATEGORIES, type GlossaryCategoryId } from '@/data/glossary'
import { buildIndex, resolveModule, searchGlossary, RELEVANCE_FLOOR } from '@/data/glossaryQuery'

/** 词条是静态数据，索引在模块加载时建一次就够，不必放进 store 的响应式状态 */
const byId = buildIndex(ENTRIES)

const WIDTH_KEY = 'rv32i.glossary.width'
export const MIN_WIDTH = 320
export const MAX_WIDTH = 760
const HISTORY_MAX = 20

function readWidth(): number {
  // 隐私模式下 localStorage 的读取本身就可能抛，解析失败也不能让浮层打不开，
  // 所以整段包起来、兜底成一个能用的默认值
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(n)) return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n))
  } catch {
    /* 读不到就用默认宽度 */
  }
  return 420
}

function writeWidth(w: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(w)))
  } catch {
    /* 写不进去就算了，本次会话内照样能拖 */
  }
}

export const useGlossaryStore = defineStore('glossary', () => {
  // ---------------- 状态 ----------------
  const open = ref(false)
  const width = ref(readWidth())
  const query = ref('')
  const category = ref<GlossaryCategoryId | 'all'>('all')
  /** 正在读的词条 id；null = 停在列表/检索结果页 */
  const currentId = ref<string | null>(null)
  /** 返回栈，栈顶 = 上一个读过的词条 */
  const history = ref<string[]>([])

  // ---------------- 派生 ----------------
  const current = computed(() => (currentId.value ? byId.get(currentId.value) ?? null : null))
  const backTarget = computed(() =>
    history.value.length ? byId.get(history.value[history.value.length - 1]) ?? null : null,
  )

  /** 检索结果；查询为空时返回全部（浏览态） */
  const hits = computed(() => searchGlossary(query.value, ENTRIES))

  /** 查询非空、但最高分够不上阈值（或压根没结果）——切「你是不是想找」视图 */
  const notFound = computed(
    () => query.value.trim() !== '' && (hits.value.length === 0 || hits.value[0].score < RELEVANCE_FLOOR),
  )

  /** 分类 chips：只列真有词条的分类，样条阶段不至于挂出一排空标签 */
  const groups = computed(() =>
    GLOSSARY_CATEGORIES.map((c) => ({
      id: c.id,
      label: c.label,
      entries: ENTRIES.filter((e) => e.category === c.id),
    })).filter((g) => g.entries.length > 0),
  )

  /** 按当前分类过滤后的命中；分类未选时为全部 */
  const visibleHits = computed(() =>
    category.value === 'all' ? hits.value : hits.value.filter((h) => h.entry.category === category.value),
  )

  /** 一条结果都没有时给学生的台阶：最基础的几条，总比空白面板强 */
  const basics = computed(() => ENTRIES.filter((e) => e.level === 1))

  // ---------------- 动作 ----------------
  /** 开一个新主题：清空历史。列表点选、图上命中都走这里 */
  function openRoot(id: string) {
    if (!byId.has(id)) return
    currentId.value = id
    history.value = []
    open.value = true
  }

  /** 顺着正文里的链接/相关词条跳过去：压栈，可以返回 */
  function openLinked(id: string) {
    if (!byId.has(id) || id === currentId.value) return
    if (currentId.value) {
      history.value.push(currentId.value)
      if (history.value.length > HISTORY_MAX) history.value.shift()
    }
    currentId.value = id
    open.value = true
  }

  function back() {
    const prev = history.value.pop()
    if (prev) currentId.value = prev
  }

  /**
   * 图上点了一个部件（DatapathView 做几何命中后调这里）。
   * 命中词条就直接开；没命中（还没写词的部件）就退回「相近词条」视图，
   * 把框内标题当查询词填进搜索框——学生看得见自己点了什么，也知道能改。
   */
  function openFromModule(moduleId: string, label: string) {
    const r = resolveModule(moduleId, label, byId)
    open.value = true
    if (r.entry) {
      openRoot(r.entry.id)
      return
    }
    currentId.value = null
    history.value = []
    category.value = 'all'
    query.value = label || moduleId
  }

  /** 回到列表（保留搜索词与分类，学生回来时还在原处） */
  function toList() {
    currentId.value = null
    history.value = []
  }

  function openPanel() {
    open.value = true
  }

  function close() {
    open.value = false
  }

  function toggle() {
    open.value = !open.value
  }

  /** 拖动左边缘时高频调用：只改状态，不落盘 */
  function setWidth(w: number) {
    width.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w))
  }

  /** 松手时落一次盘 */
  function commitWidth() {
    writeWidth(width.value)
  }

  return {
    open, width, query, category, currentId, history,
    current, backTarget, hits, notFound, groups, visibleHits, basics,
    openRoot, openLinked, back, openFromModule, toList,
    openPanel, close, toggle, setWidth, commitWidth,
  }
})
