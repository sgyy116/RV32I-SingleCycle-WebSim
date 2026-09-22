// ============================================================================
// preview.mjs —— 把数据通路场景树渲染成独立 SVG（离线预览 / 截图核对用）
//
// 几何计算全在 frontend/src/data/datapathScene.ts 里，网页端用的是同一份。
// 这个脚本只负责「读 JSON → 建场景 → 序列化成 SVG 字符串」。
//
// 用法：node tools/preview.mjs
//
// 注意：本脚本只写 SVG。要看 PNG 得再单独跑一次无头 Edge 截图，见文件末尾注释。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildDatapathScene } from '../frontend/src/data/datapathScene.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const layoutPath = path.join(root, 'frontend', 'src', 'data', 'datapathLayout.json')
const outDir = path.join(here, 'out')
const outPath = path.join(outDir, 'datapath-preview.svg')

const L = JSON.parse(fs.readFileSync(layoutPath, 'utf8'))

// ---------------------------------------------------------------- SVG 序列化

const ESC = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** attrs 里的布尔/数字统一成字符串；属性顺序按插入顺序，稳定可 diff */
function attrStr(attrs) {
  if (!attrs) return ''
  const parts = []
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue
    parts.push(`${k}="${ESC(v)}"`)
  }
  return parts.length ? ' ' + parts.join(' ') : ''
}

function nodeToSvg(n, indent) {
  const pad = '  '.repeat(indent)
  const kids = n.children || []
  const inner = n.text !== undefined ? ESC(n.text) : ''
  if (!kids.length && !inner) return `${pad}<${n.tag}${attrStr(n.attrs)}/>`
  if (!kids.length) return `${pad}<${n.tag}${attrStr(n.attrs)}>${inner}</${n.tag}>`
  const body = kids.map((c) => nodeToSvg(c, indent + 1)).join('\n')
  return `${pad}<${n.tag}${attrStr(n.attrs)}>\n${body}\n${pad}</${n.tag}>`
}

// ---------------------------------------------------------------- 主流程

const scene = buildDatapathScene(L)
const parts = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}">`,
  ...scene.nodes.map((n) => nodeToSvg(n, 1)),
  '</svg>',
]

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outPath, parts.join('\n'), 'utf8')
console.log(`[preview] scale=${L.scale} 画布 ${scene.width}x${scene.height}，部件 ${(L.modules || []).length} 个，端口 ${(L.ports || []).length} 个，连线 ${(L.wires || []).length} 条`)
console.log(`[preview] 已写出 ${outPath}`)
console.log('[preview] 看 PNG 要再跑一次无头 Edge 截图（本脚本只写 SVG）：')
console.log('  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless --disable-gpu \\')
console.log(`    --user-data-dir="C:/Users/lenovo/AppData/Local/Temp/edgeshot" --window-size=${scene.width},${scene.height} \\`)
console.log(`    --screenshot="${path.join(outDir, 'datapath-preview.png')}" "file:///${outPath.replace(/\\/g, '/')}"`)
