// ============================================================================
// glossaryQuery.ts —— 词条的解析、计数与检索算法。纯函数，无副作用。
//
// 与 glossary.ts 分家的理由：数据文件会长到几百条（审的是文字），算法要保持短
// （审的是逻辑）。更要紧的是**字数口径只能有一份实现**——tools/_glossary_check.mjs
// import 的就是这里的 visibleLength，检查脚本不重抄一遍口径。
//
// 本文件只值导入 ./glossary.ts（它自己不 import 任何东西），所以整个依赖链
// 在 tools/ 下没有 node_modules 时也能被 Node 类型剥离直接跑。
//
// 语法约束：只能用可擦除语法（禁 enum / namespace / 构造器参数属性）。
// ============================================================================

import {
  GLOSSARY_CATEGORIES,
  LABEL_GLOSSARY,
  MODULE_GLOSSARY,
  type GlossaryCategoryId,
  type GlossaryEntry,
} from './glossary.ts'

// ---------------------------------------------------------------- 索引

export function buildIndex(entries: GlossaryEntry[]): Map<string, GlossaryEntry> {
  return new Map(entries.map((e) => [e.id, e]))
}

/** 参数收成 string 是刻意的：调用处常拿到的是 `id | 'all'` 这类联合类型，
 *  为了取个显示名去写收窄分支不值；查不到就原样回显，不会假装知道 */
export function categoryLabel(id: GlossaryCategoryId | string): string {
  return GLOSSARY_CATEGORIES.find((c) => c.id === id)?.label ?? id
}

// ---------------------------------------------------------------- 正文互链

/** 一段正文切出来的片段。linkId 为 undefined 就是纯文本 */
export interface BodySegment {
  text: string
  linkId?: string
}

const LINK_RE = /\[\[([a-z0-9-]+)(?:\|([^\]]*))?\]\]/g

/**
 * 取正文里出现的全部链接目标（**不检查目标是否存在**）。
 * 渲染走 parseBody（目标不存在就降级成纯文本），离线断言走这个。
 */
export function linkTargets(body: string): string[] {
  const out: string[] = []
  LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LINK_RE.exec(body))) out.push(m[1])
  return out
}

/**
 * 把正文切成渲染片段。目标词条不存在时，该标记降级为纯文本
 * （显示文字照用），保证界面永远不会出现点了没反应的死链。
 */
export function parseBody(body: string, byId: Map<string, GlossaryEntry>): BodySegment[] {
  const out: BodySegment[] = []
  LINK_RE.lastIndex = 0
  let last = 0
  let m: RegExpExecArray | null
  while ((m = LINK_RE.exec(body))) {
    if (m.index > last) out.push({ text: body.slice(last, m.index) })
    const target = byId.get(m[1])
    const display = m[2] ?? target?.term ?? m[1]
    if (target) out.push({ text: display, linkId: target.id })
    else out.push({ text: display })
    last = m.index + m[0].length
  }
  if (last < body.length) out.push({ text: body.slice(last) })
  return out.length ? out : [{ text: '' }]
}

// ---------------------------------------------------------------- 字数口径

// 连续的拉丁字母/数字算一个「字」。按字符去罚会逼作者为了凑字数把
// `MemtoReg`、`0x80000000`、`mtimecmp` 这些准确的名字砍掉，那是本末倒置。
const LATIN_RUN = /[A-Za-z0-9]+/g

/** 只看学生真正读到的字符数：链接标记本身不计，计它显示出来的文字 */
export function countVisible(text: string): number {
  // 展开成码点数组再取长度，代理对（生僻字）算 1 而不是 2
  return [...text.replace(LATIN_RUN, '#')].length
}

/** 正文的可见字数。链接按显示文字计，来源小字不计 */
export function visibleLength(body: string, byId: Map<string, GlossaryEntry>): number {
  return countVisible(parseBody(body, byId).map((s) => s.text).join(''))
}

export const MAX_BODY_CHARS = 150

// ---------------------------------------------------------------- 归一化

// 抹平大小写、全角半角、以及各种分隔符。抹完之后
// MemtoReg / mem-to-reg / MEM_TO_REG / mem to reg 是同一个串。
const STRIP_RE = /[\s\-_.·'’/+()（）]/g

export function normalize(s: string): string {
  return s
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(STRIP_RE, '')
    .toLowerCase()
}

// ---------------------------------------------------------------- 检索

export interface GlossaryHit {
  entry: GlossaryEntry
  score: number
}

type Field = 'term' | 'id' | 'en' | 'alias'

// id 单列一档、压在 term 之下、en 之上，为的是解决「两个词条的 en 拆出同一个词」
// 这类并列：alu-flags 的 en 是「ALU Flags · ZF / LT」，会拆出一个裸词 ALU，与
// alu 自己的「ALU · Arithmetic Logic Unit」拆出的 ALU 同为 EXACT.en(920)；并列后
// 按 term 长度决胜，「标志位」(3 字) 反而压过「算术逻辑单元」(6 字)——学生敲 ALU
// 落到「标志位」，而 ALU 恰好是数据通路图上最醒目的部件之一。
// 加这一档后，「查询正好等于某条词条的 id」的那一条直接胜出。这是条能说清理由的
// 规则：学生敲出 slug 本身时，他要的就是以这个 slug 命名的那一条。
const EXACT: Record<Field, number> = { term: 1000, id: 980, en: 920, alias: 880 }
const PREFIX: Record<Field, number> = { term: 640, id: 600, en: 580, alias: 560 }
const CONTAINS: Record<Field, number> = { term: 430, id: 390, en: 390, alias: 360 }

// 「用户搜了个没收录的长词」的兜底分：查询里**包含**了某个词条名。
// 300 起，按命中串占查询的比例上浮——搜「addi指令的用法」时应该让 addi 压过
// 「指令」，因为 addi 覆盖了查询里更大的一段。封顶 420，不越过 termContains(430)。
const REVERSE_BASE = 300
const REVERSE_SPAN = 120

// 反向包含要求命中串盖住查询的**四分之一以上**，否则不算数。
//
// 不设这条会出现下面这种结果：学生把 register 打成 registor，查询里恰好含着
// `or` 两个字母，于是「OR 指令」按反向包含拿到 360 分——高过收录阈值，系统
// 认定「找到了」，把真正的答案挤出去。而 register 那条走拼写近似只有 240 分
// （低于阈值），被过滤掉。学生看到的就只有 OR / XOR / ORI 指令，且不知道系统
// 其实没把握。
//
// 去掉这两个字母的巧合之后，registor 没有任何一条够得上阈值，检索退回「未收录，
// 你是不是想找」视图，把 register 当近似结果列出来——那才是该有的表现。
//
// 阈值取 1/4 而不是更大，是为了不误伤「中文里夹一个短缩写」：`pc是啥` 里 pc 占
// 一半、`我想用sw存` 里 sw 占三分之一，都该照常命中。
const REVERSE_MIN_COVER = 4 // 命中串长度 × 4 > 查询长度，即覆盖超过 1/4

// 拼写近似只在「纯 ASCII 查询 + 一条精确/前缀/包含都没命中」时才启用。
// 中文**刻意不用编辑距离**：「寄存器」与「寄存器堆」、「指令」与「伪指令」
// 距离都是 1，那会把语义上的包含关系误判成拼写错误，高分淹没真正想要的条目；
// 更坏的是 mtvec/mepc/mcause 这类只差几个字母但语义完全不同的 CSR 会互相误配。
//
// 两边都得够长（≥4）才比：3 个字母的短串之间距离几乎必然 ≤3，
// 搜 mux 会把「CPU」「RISC-V」也算成拼写相近，纯粹是噪声。
const FUZZY_BASE = 260
const FUZZY_STEP = 20
const FUZZY_MAX_DIST = 3
const FUZZY_MIN_LEN = 4

/** 一条词条的全部可搜字段。term / en 会按分隔符再拆出子串 */
function fieldCandidates(e: GlossaryEntry): Array<{ field: Field; raw: string }> {
  const out: Array<{ field: Field; raw: string }> = []
  const push = (field: Field, raw: string) => {
    if (raw.trim()) out.push({ field, raw: raw.trim() })
  }
  // en 形如 "MUX · Multiplexer" / "Clock Cycle / Clock Period"，
  // 整串归一后是 muxmultiplexer，搜 mux 永远命中不了——所以整串和子串都要放
  push('term', e.term)
  for (const part of e.term.split(/[\s·/]+/)) push('term', part)
  push('id', e.id) // slug 也算：搜 register-file 应命中「寄存器堆」
  if (e.en) {
    push('en', e.en)
    for (const part of e.en.split(/[\s·/]+/)) push('en', part)
  }
  for (const a of e.aliases ?? []) push('alias', a)
  return out
}

function scoreEntry(q: string, e: GlossaryEntry): number {
  let best = 0
  for (const c of fieldCandidates(e)) {
    const v = normalize(c.raw)
    if (!v) continue
    let s = 0
    if (v === q) s = EXACT[c.field]
    else if (v.startsWith(q)) s = PREFIX[c.field]
    else if (v.includes(q)) s = CONTAINS[c.field]
    else if (v.length >= 2 && v.length * REVERSE_MIN_COVER > q.length && q.includes(v)) {
      s = REVERSE_BASE + Math.min(REVERSE_SPAN, Math.round((REVERSE_SPAN * 2 * v.length) / q.length))
    }
    if (s > best) best = s
  }
  if (best > 0) return best

  if (q.length >= FUZZY_MIN_LEN && /^[\x21-\x7e]+$/.test(q)) {
    for (const c of fieldCandidates(e)) {
      const v = normalize(c.raw)
      if (v.length < FUZZY_MIN_LEN) continue
      const d = editDistance(q, v, FUZZY_MAX_DIST)
      if (d <= FUZZY_MAX_DIST) {
        const s = FUZZY_BASE - d * FUZZY_STEP
        if (s > best) best = s
      }
    }
  }
  return best
}

/**
 * 按相关度检索。空查询返回全部（浏览态）。
 * 并列时按 level 升序、term 长度升序——更基础、更短的名字排前面。
 */
export function searchGlossary(query: string, entries: GlossaryEntry[], limit = 40): GlossaryHit[] {
  const q = normalize(query)
  const hits: GlossaryHit[] = []
  if (!q) {
    for (const e of entries) hits.push({ entry: e, score: 0 })
  } else {
    for (const e of entries) {
      const score = scoreEntry(q, e)
      if (score > 0) hits.push({ entry: e, score })
    }
    hits.sort(
      (a, b) => b.score - a.score || a.entry.level - b.entry.level || a.entry.term.length - b.entry.term.length,
    )
  }
  // 一旦有真正相关的命中，就把 RELEVANCE_FLOOR 以下的噪声全丢掉。
  // 拼写近似的满分是 260-20=240，天生低于这条线，所以这行等于
  // 「有实在的命中时，就不再附带拼写猜测」——搜 MUX 不会顺带列出「中央处理器」。
  const strong = hits.length > 0 && hits[0].score >= RELEVANCE_FLOOR
  return (strong ? hits.filter((h) => h.score >= RELEVANCE_FLOOR) : hits).slice(0, limit)
}

/** 最高分低于这个值就认为「没收录」，列表顶部切到「你是不是想找」 */
export const RELEVANCE_FLOOR = 260

/** 带 early-exit 的编辑距离。超过 maxD 立即返回 maxD+1，不做无用的全表 */
export function editDistance(a: string, b: string, maxD = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > maxD) return maxD + 1
  let prev: number[] = new Array(b.length + 1)
  let cur: number[] = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > maxD) return maxD + 1
    const t = prev
    prev = cur
    cur = t
  }
  return prev[b.length]
}

// ---------------------------------------------------------------- 图上部件 → 词条

export interface ModuleResolution {
  /** 映射表里登记的目标词条 id，没登记就是 null */
  entryId: string | null
  /** 目标词条；没登记、或登记了但还没写正文，都是 null */
  entry: GlossaryEntry | null
}

/**
 * 图上某个部件对应哪条词条。
 * 按 module id 精确查是第一优先（MUX 这个 label 在图上有 12 份、
 * ADD 有 2 份，label 本身不含糊）；id 没登记时才退回按框内主标题查。
 */
export function resolveModule(
  moduleId: string,
  label: string | undefined,
  byId: Map<string, GlossaryEntry>,
): ModuleResolution {
  const target = MODULE_GLOSSARY[moduleId] ?? (label ? LABEL_GLOSSARY[label] : undefined)
  if (!target) return { entryId: null, entry: null }
  return { entryId: target, entry: byId.get(target) ?? null }
}
