// ============================================================================
// hl_preview.mjs —— 把「某一周期的数据通路高亮」渲染成一张独立 SVG
//
// 用途：核对高亮到底点亮了哪几条线、数值气泡放得合不合适。网页端要手点编译
// 和单步才看得到，这个脚本直接从 cycle_state 流里取一帧静态渲染，方便反复看。
//
// 高亮的类名和样式与网页端完全共用：
//   类名 → 由 datapathScene 的 meta + datapathHighlight 的规则算出来，和
//          SceneNode.vue 里的判断是同一套规则（见下面 litOf）
//   样式 → 原样内联 frontend/src/styles/datapath.css
//
// 用法：
//   node tools/hl_preview.mjs tools/out/_hl_states.jsonl 4
//   参数2 是周期号（cycle_state 的 cycle 字段），省略则取最后一个周期。
//   node tools/hl_preview.mjs tools/out/_hl_states.jsonl 4 3
//   参数3 是波次 k（已点亮几波），省略 = 全亮，即原来的行为。
//
// 波次划分**不在这里重算**：直接调 datapathWave.ts 的 computeWaves + sliceHighlight。
// 抄第二份实现必然和网页端漂移，那核对出来的就不是网页上看到的东西了。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildDatapathScene } from '../frontend/src/data/datapathScene.ts'
import { computeHighlight } from '../frontend/src/data/datapathHighlight.ts'
import { computeWaves, sliceHighlight, freshWires } from '../frontend/src/data/datapathWave.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const L = JSON.parse(fs.readFileSync(path.join(root, 'frontend/src/data/datapathLayout.json'), 'utf8'))
const CSS = fs.readFileSync(path.join(root, 'frontend/src/styles/datapath.css'), 'utf8')

// SVG 是按 XML 解析的，style 元素里出现半角尖括号或 & 会被当成标签/实体，
// 报 "Unclosed closing tag: style" 然后整页渲染失败（踩过一次，注释里写了个 g 标签）。
const bad = CSS.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /[<&]/.test(l))
if (bad.length) {
  throw new Error(`datapath.css 第 ${bad.map(([n]) => n).join(', ')} 行有尖括号或 &，无法内联进 SVG`)
}

const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter((l) => l.trim().startsWith('{'))
const states = lines.map((l) => JSON.parse(l)).filter((m) => m.type === 'cycle_state')
if (!states.length) throw new Error('输入里没有 cycle_state')

const want = process.argv[3] !== undefined ? Number(process.argv[3]) : states[states.length - 1].cycle
const frame = states.find((s) => s.cycle === want)
if (!frame) throw new Error(`没有周期 ${want} 的状态，可选：${states.map((s) => s.cycle).join(',')}`)

const scene = buildDatapathScene(L)

// 不带参数 3 就是「全亮」，与改造前逐像素一致
const FULL = computeHighlight(frame.state, L)
const plan = computeWaves(FULL, L)
const k = process.argv[4] !== undefined ? Number(process.argv[4]) : plan.count
const hl = sliceHighlight(FULL, plan, k)
const fresh = freshWires(FULL, plan, k)
console.log(`周期 ${frame.cycle}：共 ${plan.count} 波，本次渲染到第 ${k} 波`
  + `（存活连线 ${hl.wires.size}/${FULL.wires.size}，本波新到 ${fresh.size} 条）`)

// ---------------------------------------------------------------- 点亮判定
// 与 SceneNode.vue 的 lit / trapLit 计算保持一致（那边逐节点算，这里算同一件事）
const trapLitOf = (meta, on) =>
  !!on && hl.trapActive && meta?.kind === 'module' && meta.group === 'TRAP'

function litOf(meta, on) {
  if (!meta || !on) return false
  if (trapLitOf(meta, on)) return true
  switch (meta.kind) {
    case 'wire': return (meta.wires || []).some((id) => hl.wires.has(id))
    case 'arrow': return !!meta.id && hl.wires.has(meta.id)
    case 'netLabel': return !!meta.net && hl.nets.has(meta.net)
    case 'module': return !!meta.id && hl.modules.has(meta.id)
    default: return false
  }
}
const dimOf = (meta, on, lit) =>
  !!meta && on && !lit && (meta.kind === 'wire' || meta.kind === 'arrow')
// 本波新到的连线（流动虚线）。与 SceneNode.vue 的 freshLit 同一套判断：
// 只给 wire 加，箭头是实心小三角，虚线化会把它描花。
const freshOf = (meta, on, lit) =>
  !!meta && on && lit && meta.kind === 'wire' && (meta.wires || []).some((id) => fresh.has(id))

// ---------------------------------------------------------------- 序列化
const ESC = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function attrStr(attrs) {
  if (!attrs) return ''
  const parts = []
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue
    parts.push(`${k}="${ESC(v)}"`)
  }
  return parts.length ? ' ' + parts.join(' ') : ''
}

function nodeToSvg(n, indent, on) {
  const pad = '  '.repeat(indent)
  const m = n.meta
  const lit = litOf(m, on)
  const dim = dimOf(m, on, lit)
  const trapLit = trapLitOf(m, on)
  const cls = [
    n.attrs && n.attrs.class ? String(n.attrs.class) : '',
    lit ? 'dp-lit' : '', dim ? 'dp-dim' : '', trapLit ? 'dp-trap-lit' : '',
    freshOf(m, on, lit) ? 'dp-fresh' : '',
  ].filter(Boolean).join(' ')
  const attrs = { ...(n.attrs || {}) }
  if (cls) attrs.class = cls
  else delete attrs.class

  const kids = n.children || []
  const inner = n.text !== undefined ? ESC(n.text) : ''
  if (!kids.length && !inner) return `${pad}<${n.tag}${attrStr(attrs)}/>`
  if (!kids.length) return `${pad}<${n.tag}${attrStr(attrs)}>${inner}</${n.tag}>`
  const body = kids.map((c) => nodeToSvg(c, indent + 1, on)).join('\n')
  return `${pad}<${n.tag}${attrStr(attrs)}>\n${body}\n${pad}</${n.tag}>`
}

// ---------------------------------------------------------------- 数值气泡
const BADGE_DY = 30
const BADGE_H = 24
const badgeW = (t) => t.length * 9 + 14

// 放置规则（网页端 DatapathView.vue 用的是同一套）：
//   1. 落在该连线线名标签的正下方，复用线名的避让结果
//   2. 越出画布就往回夹，否则左边缘那几条会被裁掉半个气泡
//   3. 近处已经有同样数值的气泡就不重复放——单周期图上一串串联的线常带同一个值
//      （比如 src1 数据一路传过 muxa0 和 ALU），全画出来只是一片重复
const placedBadges = []
const NEAR = 240
for (const [id, text] of hl.values) {
  const a = scene.wireAnchors[id]
  if (!a) continue
  const w = badgeW(text)
  const x = Math.min(Math.max(a[0], w / 2 + 8), scene.width - w / 2 - 8)
  const y = a[1] + BADGE_DY
  if (placedBadges.some((b) => b.text === text && Math.hypot(b.x - x, b.y - y) < NEAR)) continue
  placedBadges.push({ id, x, y, w, text })
}
const badges = placedBadges

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" class="dp-svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}" style="background:${scene.background}">`,
  `  <style>${CSS}</style>`,
  ...scene.nodes.map((n) => nodeToSvg(n, 1, true)),
  '  <g class="dp-badges">',
  ...badges.map((b) =>
    `    <g transform="translate(${b.x - b.w / 2}, ${b.y - BADGE_H / 2})">` +
    `<rect width="${b.w}" height="${BADGE_H}" rx="4"/>` +
    `<text x="${b.w / 2}" y="${BADGE_H / 2 + 5.5}" text-anchor="middle">${ESC(b.text)}</text></g>`),
  '  </g>',
  '</svg>',
].join('\n')

const outDir = path.join(here, 'out')
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, `hl-cycle${frame.cycle}.svg`)
fs.writeFileSync(outPath, svg, 'utf8')

console.log(`周期 ${frame.cycle}  ${frame.state.pc}  ${frame.state.disassembly}`)
console.log(`  亮线 ${hl.wires.size} 条，网络 ${[...hl.nets].join(',') || '-'}，部件 ${hl.modules.size} 个${hl.trapActive ? '  ★TRAP' : ''}`)
console.log(`  数值气泡 ${badges.length} 个`)
console.log(`  已写出 ${outPath}`)
console.log('  看 PNG：用无头 Edge 截这张 SVG（--user-data-dir 必须给个临时目录）')
console.log(`  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless --disable-gpu \\`)
console.log(`    --user-data-dir="C:/Users/lenovo/AppData/Local/Temp/edgeshot" --window-size=${scene.width},${scene.height} \\`)
console.log(`    --screenshot="${path.join(outDir, `hl-cycle${frame.cycle}.png`)}" "file:///${outPath.replace(/\\/g, '/')}"`)
