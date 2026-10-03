// ============================================================================
// _glossary_check.mjs —— 百科全书（术语词典）的格式与引用完整性校验
//
// 机器查不了「这条解释对不对」——那是人的事。但格式与引用这一层可以做到 100%
// 可靠，于是人工复核时就只剩内容要盯。这个脚本让下面这些错**在写作阶段就红**：
//   · 正文超过 150 字（口径见下）、两条词条正文雷同（复制粘贴留下的）
//   · [[链接]] 指向一个不存在的词条 / 指向自己不比自己更基础的词条
//   · 别名撞车（两个词条共用一个别名，学生搜出来不知道该跳哪个）
//   · 图上有部件没登记映射（学生点了没反应）
//
// 另外出一份报表：图上渲染出的每一个字符串（线名、部件标题、副标题）逐个过一遍
// 检索函数，列出搜不到的那些。报表不判失败——像标点、纯数字、含义存疑的缩写
// 本来就不该有词条——但它能照出「新加了一根线叫 xxx、却忘了补词条」。
//
// 「150 字」的口径只写在 glossaryQuery.ts 的 visibleLength 里，本文件 import 那个
// 函数而不重抄——口径抄成两份迟早会分叉，然后就有两套「150 字」互相打架。
//
// 词条数据本身是 .ts，靠 Node 的类型剥离直接 import（两份文件都不 import 裸包名，
// 所以不用 frontend/node_modules）。
//
// 用法：node tools/_glossary_check.mjs [--strict]
//       默认：映射目标词条尚未录入只警告（样条阶段必然如此）
//       --strict：连这条也判失败（词条补齐后该用它）
// 退出码：0 = 全过，1 = 有断言失败，3 = 跳过（读不到 .ts）
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const strict = process.argv.includes('--strict')

// 交付包故意不带 frontend/node_modules。这里的依赖链目前一个裸包名都没有，
// 但静态 import 一旦哪天被加上就会甩 ERR_MODULE_NOT_FOUND 堆栈退出，
// check_all.py 会把「环境没装」误报成「断言失败」。所以走动态 import + 退出码 3。
const SKIP = 3
let ENTRIES, GLOSSARY_CATEGORIES, MODULE_GLOSSARY, LABEL_GLOSSARY
let buildIndex, parseBody, visibleLength, linkTargets, normalize, MAX_BODY_CHARS
let searchGlossary, RELEVANCE_FLOOR
try {
  ;({ ENTRIES, GLOSSARY_CATEGORIES, MODULE_GLOSSARY, LABEL_GLOSSARY } =
    await import('../frontend/src/data/glossary.ts'))
  ;({ buildIndex, parseBody, visibleLength, linkTargets, normalize, MAX_BODY_CHARS,
      searchGlossary, RELEVANCE_FLOOR } =
    await import('../frontend/src/data/glossaryQuery.ts'))
} catch (e) {
  if (e && e.code === 'ERR_MODULE_NOT_FOUND') {
    console.log(`  跳过：读不到词条数据（${e.message.split('\n')[0]}）`)
    process.exit(SKIP)
  }
  throw e
}

const fails = []
const warns = []
const bad = (m) => fails.push(m)
const warn = (m) => warns.push(m)

const byId = buildIndex(ENTRIES)
const CATS = new Set(GLOSSARY_CATEGORIES.map((c) => c.id))
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

// ---------------------------------------------------------------- 形状

for (const e of ENTRIES) {
  if (!ID_RE.test(e.id)) bad(`${e.id}：id 不合规（只许小写字母/数字/连字符，首尾不能是连字符）`)
  if (!e.term || !e.term.trim()) bad(`${e.id}：term 为空`)
  if (!CATS.has(e.category)) bad(`${e.id}：category「${e.category}」不在 GLOSSARY_CATEGORIES 里`)
  if (e.scope !== 'standard' && e.scope !== 'project') bad(`${e.id}：scope 只能是 standard 或 project`)
  if (!Number.isInteger(e.level) || e.level < 1) bad(`${e.id}：level 必须是 ≥1 的整数`)
  if (!e.body || !e.body.trim()) bad(`${e.id}：body 为空`)
}

// id 与 term 的全局唯一性。term 比的是归一化后的串——「RISC-V」和「Risc V」
// 在学生眼里就是同一个词，不能各占一条。
{
  const seen = new Map()
  for (const e of ENTRIES) {
    for (const [kind, raw] of [['id', e.id], ['term', e.term]]) {
      const key = normalize(raw ?? '')
      if (!key) continue
      const prev = seen.get(key)
      if (prev && prev.entry !== e.id) {
        bad(`id/term 冲突：${prev.entry} 与 ${e.id} 都占用了「${raw}」（归一化后同为 ${key}）`)
      } else if (!prev) {
        seen.set(key, { entry: e.id, kind })
      }
    }
  }
}

// ---------------------------------------------------------------- 正文

const nearLimit = []
for (const e of ENTRIES) {
  const body = e.body ?? ''

  const n = visibleLength(body, byId)
  if (n > MAX_BODY_CHARS) bad(`${e.id}：正文可见 ${n} 字，超出 ${MAX_BODY_CHARS} 字上限 ${n - MAX_BODY_CHARS} 字`)
  else if (n >= MAX_BODY_CHARS - 15) nearLimit.push(`${e.id}（${n} 字）`)

  // 混进了 HTML / Markdown 的痕迹。正文走的是分段渲染、不用 v-html，
  // 这些字符只会原样显示出来给学生看，所以在源头挡掉。
  for (const token of ['<', '>', '**', '](']) {
    if (body.includes(token)) bad(`${e.id}：正文出现 ${JSON.stringify(token)}，正文不支持 HTML / Markdown`)
  }

  // 链接标记与解析出的目标数量必须一致。[[CPU]]（大写）、[[id]（少一个方括号）
  // 都不会被 LINK_RE 匹配到，会静默地原样显示——这条能把它们抓出来。
  const targets = linkTargets(body)
  const opens = (body.match(/\[\[/g) || []).length
  if (opens !== targets.length) {
    bad(`${e.id}：有 ${opens} 处 [[，却只解析出 ${targets.length} 个合法链接（id 只许小写字母/数字/连字符）`)
  }

  for (const t of targets) {
    if (t === e.id) {
      bad(`${e.id}：正文链接指向自己`)
      continue
    }
    const target = byId.get(t)
    if (!target) {
      bad(`${e.id}：正文链接 [[${t}]] 指向未收录的词条`)
      continue
    }
    if (target.level > e.level) {
      bad(`${e.id}（level ${e.level}）链接了更难的 ${t}（level ${target.level}）——只许链接更基础的词条`)
    } else if (target.level === e.level) {
      warn(`${e.id} 与 ${t} 同级（都 level ${e.level}），确认「${target.term}」确实该链到这里`)
    }
  }

  for (const r of e.related ?? []) {
    if (r === e.id) bad(`${e.id}：related 里有自己`)
    else if (!byId.has(r)) bad(`${e.id}：related 里的 ${r} 未收录`)
  }

  if (!e.sources?.length) warn(`${e.id}：没标出处`)
  for (const s of e.sources ?? []) {
    if (!s.label || !s.label.trim()) bad(`${e.id}：sources 里有一条 label 为空`)
    if (s.url && !/^https?:\/\//.test(s.url)) bad(`${e.id}：出处 url「${s.url}」不以 http 开头`)
  }
}

// 两条词条正文雷同（学生看到两遍一样的话）
{
  const seen = new Map()
  for (const e of ENTRIES) {
    const text = parseBody(e.body ?? '', byId).map((s) => s.text).join('')
    if (!text) continue
    const prev = seen.get(text)
    if (prev) bad(`${e.id} 与 ${prev} 的正文完全相同（复制粘贴留下的？）`)
    else seen.set(text, e.id)
  }
}

// ---------------------------------------------------------------- 别名

{
  // 先登记全部 id 与 term，别名不许撞上别人的正式名字
  const claims = new Map() // 归一化串 -> { entry, raw, kind }
  for (const e of ENTRIES) {
    for (const [kind, raw] of [['id', e.id], ['term', e.term]]) {
      const key = normalize(raw ?? '')
      if (key && !claims.has(key)) claims.set(key, { entry: e.id, raw, kind })
    }
  }
  for (const e of ENTRIES) {
    const own = new Set()
    for (const a of e.aliases ?? []) {
      const key = normalize(a)
      if (!key) { bad(`${e.id}：有个别名为空`); continue }
      if (own.has(key)) { bad(`${e.id}：别名「${a}」在本条内重复`); continue }
      own.add(key)

      const hit = claims.get(key)
      if (!hit) claims.set(key, { entry: e.id, raw: a, kind: 'alias' })
      else if (hit.entry === e.id) warn(`${e.id}：别名「${a}」和本条自己的 ${hit.kind} 重复，可以删掉`)
      else bad(`${e.id} 的别名「${a}」撞上了 ${hit.entry} 的 ${hit.kind}「${hit.raw}」`)
    }
  }
}

// ---------------------------------------------------------------- 图上映射

const layoutPath = path.join(root, 'frontend', 'src', 'data', 'datapathLayout.json')
const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'))
const modules = layout.modules ?? []
const realIds = new Set(modules.map((m) => m.id))
const realLabels = new Set(modules.map((m) => m.label).filter(Boolean))

for (const [k, v] of Object.entries(MODULE_GLOSSARY)) {
  if (!realIds.has(k)) bad(`MODULE_GLOSSARY 的键 ${k} 在 datapathLayout.json 里没有对应部件`)
  if (!byId.has(v)) {
    const msg = `MODULE_GLOSSARY[${k}] -> ${v}，但词条 ${v} 还没写`
    if (strict) bad(msg)
    else warn(msg)
  }
}
for (const [k, v] of Object.entries(LABEL_GLOSSARY)) {
  if (!realLabels.has(k)) bad(`LABEL_GLOSSARY 的键「${k}」在 datapathLayout.json 里没有对应部件标题`)
  if (!byId.has(v)) {
    const msg = `LABEL_GLOSSARY[${k}] -> ${v}，但词条 ${v} 还没写`
    if (strict) bad(msg)
    else warn(msg)
  }
}

// 图上每个部件都必须登记映射。否则学生点上去毫无反应——那是最难查的一类坑。
const unmapped = modules.filter((m) => !MODULE_GLOSSARY[m.id]).map((m) => m.id)
if (unmapped.length) bad(`这些部件没登记 MODULE_GLOSSARY，点上去会没反应：${unmapped.join('、')}`)

// ---------------------------------------------------------------- 报表

const covered = modules.filter((m) => byId.has(MODULE_GLOSSARY[m.id]))
const pending = modules.filter((m) => MODULE_GLOSSARY[m.id] && !byId.has(MODULE_GLOSSARY[m.id]))

console.log(`词条 ${ENTRIES.length} 条，分类 ${GLOSSARY_CATEGORIES.length} 个`)
console.log(`图上 ${modules.length} 个部件：已收录 ${covered.length} 个，待补 ${pending.length} 个`)
if (pending.length) {
  const byTarget = new Map()
  for (const m of pending) {
    const t = MODULE_GLOSSARY[m.id]
    if (!byTarget.has(t)) byTarget.set(t, [])
    byTarget.get(t).push(m.id)
  }
  const list = [...byTarget.entries()].map(([t, ids]) => `${t}（${ids.join(' ')}）`).join('、')
  console.log(`待补词条：${list}`)
}
if (nearLimit.length) console.log(`接近 ${MAX_BODY_CHARS} 字上限：${nearLimit.join('、')}`)

// 「学生看得到的东西，他都搜得到」——把图上真正渲染出来的字符串
// （线名、部件标题、部件副标题）逐条丢进检索函数，看有多少低于收录阈值。
//
// 只报信息、不算失败：这些字符串是作图的产物，不是词表的一部分，
// 有些（标点、纯数字、含义存疑的缩写）本来就不该有词条。
// 但它能把「新加了一根线叫 xxx、忘了补词条」这类漏洞当场照出来——
// 那正是学生最常遇挫的地方。
//
// 每条都按分隔符**拆成词**再试检索：学生看到部件副标题写着
// `mtvec/mepc/mcause/mstatus/mie/mip`，他会敲其中一个，不会把整串粘进去。
// 以前不拆也照样全绿，是因为整串里含着 `mtvec`，靠**反向包含**凑巧够到了阈值；
// 低覆盖的反向包含一收紧，它立刻露馅。拆开才是如实的口径。
// 纯标点（`||` 之类）顺手滤掉：它们永远搜不到，只会撑大这个数字、埋掉真问题。
const rendered = []
const addRendered = (s) => {
  for (const w of String(s).split(/[\s/|]+/)) {
    if (/[\p{L}\p{N}]/u.test(w)) rendered.push(w)
  }
}
for (const w of layout.wires ?? []) if (w.label) addRendered(w.label)
for (const m of modules) {
  if (m.label) addRendered(m.label)
  if (m.sub) addRendered(m.sub)
}
const allRendered = [...new Set(rendered)]
const unsearchable = []
for (const q of allRendered) {
  const hits = searchGlossary(q, ENTRIES)
  if (!hits.length || hits[0].score < RELEVANCE_FLOOR) unsearchable.push(q)
}
console.log(
  `界面渲染出的字符串 ${allRendered.length} 个：搜得到的 ${allRendered.length - unsearchable.length} 个，` +
    `搜不到的 ${unsearchable.length} 个${unsearchable.length ? `（${unsearchable.join(' ')}）` : ''}`,
)

if (warns.length) {
  console.log(`\n警告 ${warns.length} 条（不算失败${strict ? '，但 --strict 下部分已升级为失败' : ''}）：`)
  for (const w of warns) console.log(`  ! ${w}`)
}
if (fails.length) {
  console.log(`\n断言失败 ${fails.length} 处：`)
  for (const f of fails) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\n  ✓ 格式与引用完整性全部通过')
process.exit(0)
