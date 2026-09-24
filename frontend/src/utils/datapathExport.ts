// ============================================================================
// datapathExport.ts —— 将画布上所有部件与连线导出为独立 SVG 字符串
//
// 单一数据源：直接读取 data/datapathLayout 的静态布局，
// 输出可独立打开的 SVG（含图例、端口文字、图例线段按真实颜色/线宽）。
// 传入 activeWires 时会叠加当前激活的高亮连线。
// ============================================================================

import { MODULES, W, WIRE_LABELS, WIRE_LABEL_POINTS, MUX_SEL_LABELS, JUNCTION_DOTS, CANVAS_W, CANVAS_H } from '@/data/datapathLayout'
import type { ActiveWire, ModuleLayout } from '@/types/datapath'

const KIND_COLOR: Record<string, string> = {
  data: '#475569',
  control: '#64748b',
  branch: '#e02020',
  zf: '#00a8cc',
  interrupt: '#ff7a00',
  mret: '#8a2be2',
}
const KIND_WIDTH: Record<string, number> = {
  data: 2,
  control: 1.2,
  branch: 1.5,
  zf: 1.6,
  interrupt: 2,
  mret: 1.8,
}
const KIND_DASH: Record<string, string> = {
  data: '7 5',
  control: '',
  branch: '',
  zf: '7 5',
  interrupt: '7 5',
  mret: '7 5',
}

function shapePoints(m: ModuleLayout): string {
  const { x, y, width: w, height: h } = m
  return [
    `${x},${y}`,
    `${x + w},${y + h * 0.25}`,
    `${x + w},${y + h * 0.75}`,
    `${x},${y + h}`,
    `${x},${y + h * 0.625}`,
    `${x + w * 0.2},${y + h * 0.5}`,
    `${x},${y + h * 0.375}`,
  ].join(' ')
}

function stadiumPath(m: ModuleLayout): string {
  const { x, y, width: w, height: h } = m
  const r = w / 2
  return `M ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} L ${x + w} ${y + h - r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} Z`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildExportSvg(activeWires: ActiveWire[] = []): string {
  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" font-family="'Microsoft YaHei','PingFang SC',sans-serif">`)
  parts.push(`<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="#fafcff"/>`)

  // 连线基线（已激活的不画，交给下方高亮层）
  const activeIds = new Set(activeWires.map((w) => w.id))
  parts.push('<g fill="none">')
  for (const [id, w] of Object.entries(W)) {
    if (activeIds.has(id)) continue
    const dash = KIND_DASH[w.kind] ? ` stroke-dasharray="${KIND_DASH[w.kind]}"` : ''
    parts.push(`<path d="${w.d}" stroke="${KIND_COLOR[w.kind]}" stroke-width="${KIND_WIDTH[w.kind]}"${dash} stroke-linecap="round" stroke-linejoin="round"/>`)
  }
  parts.push('</g>')

  // 活跃连线高亮（可选）
  if (activeWires.length) {
    parts.push('<g fill="none">')
    for (const w of activeWires) {
      const base = W[w.id]
      if (!base) continue
      parts.push(`<path d="${base.d}" stroke="${KIND_COLOR[w.kind]}" stroke-width="${KIND_WIDTH[w.kind] + 0.8}" stroke-dasharray="7 5" stroke-linecap="round"/>`)
    }
    parts.push('</g>')
  }

  // 结点
  parts.push('<g fill="#3f4a5a">')
  for (const d of JUNCTION_DOTS) {
    parts.push(`<circle cx="${d.x}" cy="${d.y}" r="3"/>`)
  }
  parts.push('</g>')

  // 连线文字
  parts.push('<g font-size="10" fill="#334155" text-anchor="middle">')
  for (const [id, pt] of Object.entries(WIRE_LABEL_POINTS)) {
    const label = WIRE_LABELS[id]
    if (!label) continue
    const color = KIND_COLOR[W[id]?.kind ?? 'data']
    parts.push(`<text x="${pt.x}" y="${pt.y}" fill="${color}">${esc(label)}</text>`)
  }
  parts.push('</g>')

  // MUX 选择端文字
  parts.push('<g font-size="10" font-weight="600" text-anchor="middle">')
  for (const s of MUX_SEL_LABELS) {
    parts.push(`<text x="${s.x}" y="${s.y}" fill="${s.color}">${esc(s.text)}</text>`)
  }
  parts.push('</g>')

  // 部件
  for (const m of MODULES) {
    const fill = m.id === 'oval-taken' ? '#fdeaea' : '#dbeafe'
    const stroke = m.id === 'oval-taken' ? '#e02020' : '#94a3b8'
    const sw = m.id === 'oval-taken' ? 2 : 1.8
    if (m.shape === 'rect') {
      parts.push(`<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`)
    } else if (m.shape === 'stadium') {
      parts.push(`<path d="${stadiumPath(m)}" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>`)
    } else if (m.shape === 'ellipse' || m.shape === 'gate') {
      parts.push(`<ellipse cx="${m.x + m.width / 2}" cy="${m.y + m.height / 2}" rx="${m.width / 2}" ry="${m.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`)
    } else {
      parts.push(`<polygon points="${shapePoints(m)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`)
    }
    if (m.label && m.id !== 'decoder') {
      const ty = m.sublabel ? m.y + m.height / 2 + 10 : m.id === 'csr' ? m.y + 30 : m.y + m.height / 2
      parts.push(`<text x="${m.x + m.width / 2}" y="${ty}" text-anchor="middle" dominant-baseline="middle" font-size="${m.nameSize}" fill="#000000">${esc(m.label)}</text>`)
    }
    if (m.sublabel) {
      parts.push(`<text x="${m.x + m.width / 2}" y="${m.y + m.height / 2 - 14}" text-anchor="middle" dominant-baseline="middle" font-size="${m.nameSize * 0.8}" fill="#4b5563">${esc(m.sublabel)}</text>`)
    }
    if (m.ports && m.id !== 'decoder') {
      for (const p of m.ports) {
        parts.push(`<text x="${p.x}" y="${p.y}" text-anchor="${p.anchor ?? 'start'}" font-size="${m.nameSize * 0.8}" fill="#4b5563">${esc(p.text)}</text>`)
      }
    }
    if (m.id === 'decoder' && m.ports) {
      for (const p of m.ports) {
        parts.push(`<text x="${p.x}" y="${p.y}" text-anchor="middle" font-size="${m.nameSize}" font-weight="700" fill="#000000">${esc(p.text)}</text>`)
      }
    }
    if (m.muxPorts) {
      for (const p of m.muxPorts) {
        parts.push(`<text x="${p.x}" y="${p.y}" text-anchor="middle" font-size="10" fill="#4b5563">${esc(p.text)}</text>`)
      }
    }
  }

  // 图例
  const legend: Array<[string, string, string]> = [
    ['数据通路（虚线）', 'data', ''],
    ['控制信号（实线）', 'control', ''],
    ['跳转/分支', 'branch', ''],
    ['数据高亮', 'zf', ''],
    ['中断/异常（新增）', 'interrupt', ''],
    ['mret 返回（新增）', 'mret', ''],
  ]
  parts.push('<g transform="translate(20,1244)">')
  parts.push('<text x="0" y="5" fill="#334155" font-weight="600" font-size="11">图例</text>')
  let lx = 40
  for (const [text, kind] of legend) {
    const dash = KIND_DASH[kind] ? ` stroke-dasharray="${KIND_DASH[kind]}"` : ''
    parts.push(`<line x1="${lx}" y1="2" x2="${lx + 22}" y2="2" stroke="${KIND_COLOR[kind]}" stroke-width="${KIND_WIDTH[kind]}"${dash}/>`)
    parts.push(`<text x="${lx + 27}" y="6" fill="#475569" font-size="10">${esc(text)}</text>`)
    lx += 27 + text.length * 10.5 + 14
  }
  parts.push('</g>')

  parts.push('</svg>')
  return parts.join('\n')
}
