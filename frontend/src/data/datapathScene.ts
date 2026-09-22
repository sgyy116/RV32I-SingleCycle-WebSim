// ============================================================================
// datapathScene.ts —— 数据通路的「场景树」生成器（纯几何，唯一真相源）
//
// 输入 datapathLayout.json，输出一棵与框架无关的 SceneNode 树：
//   - Vue 侧：components/datapath/SceneNode.vue 递归渲染成真实 SVG 元素，
//             可以挂事件和动态 class，用来做高亮。
//   - Node 侧：tools/preview.mjs 序列化成静态 SVG 文件（离线预览用）。
//
// 这样做是为了让几何计算只有一份。三色线规则、逐条多边形箭头、交叉隆起、
// 网络标签方框、线名避让这些逻辑以前只在 preview.mjs 里，如果前端再抄一份，
// 两边会立刻开始漂移。
//
// 本文件不 import Vue，也不产出 SVG 字符串。
//
// 语法约束：Node 24 直接跑 .ts 靠的是「类型剥离」，所以这里只能用可擦除语法
// —— type / interface / as，不许出现 enum、namespace、构造器参数属性。
// ============================================================================

// ---------------------------------------------------------------- 场景树类型

export type SceneTag =
  | 'g' | 'path' | 'rect' | 'polygon' | 'ellipse' | 'circle' | 'line' | 'text'

export interface SceneMeta {
  kind: 'module' | 'wire' | 'arrow' | 'wireLabel' | 'portLabel' | 'netLabel' | 'dot' | 'stage'
  /** 部件 id / 连线 id / 端口 id，视 kind 而定 */
  id?: string
  /** 网络标签名（同名即同网） */
  net?: string
  /** 后端 cycle_state 的字段路径，供高亮用 */
  signal?: string
  /** 只有 kind='module' 才有：部件的分组（如 'TRAP'），高亮时整组按红色系处理 */
  group?: string
  /**
   * 只有 kind='wire' 的合并线段才有：这段线是哪些连线贡献的。
   * 共线合并会把同一行/列上的多条线并成一段，所以高亮时按
   * 「任一条激活即整段点亮」处理——这些线本来就是同一个信号分叉出去的。
   */
  wires?: string[]
}

export interface SceneNode {
  tag: SceneTag
  attrs?: Record<string, string | number>
  /** 文本节点的内容（Vue 自动转义；preview 侧手动转义） */
  text?: string
  meta?: SceneMeta
  children?: SceneNode[]
}

export interface DatapathScene {
  width: number
  height: number
  background: string
  nodes: SceneNode[]
  /**
   * 连线 id → 它的线名标签落点（缩放后坐标）。
   * 前端把「实时数值气泡」放在这个点上，就复用了线名的避让结果，不用另算一遍。
   */
  wireAnchors: Record<string, [number, number]>
}

// ---------------------------------------------------------------- 布局 JSON 类型

export interface LayoutModule {
  id: string
  shape?: 'rect' | 'alu' | 'mux' | 'circle' | 'text'
  x: number
  y: number
  w: number
  h: number
  label?: string
  sub?: string | string[]
  flip?: boolean
  group?: string
}

export interface LayoutPort {
  id: string
  module: string
  side: 'left' | 'right' | 'top' | 'bottom'
  offset: number
  label?: string
  net?: string
}

export interface LayoutWire {
  id: string
  from: string
  to: string
  kind?: string
  label?: string
  points: Array<[number, number]>
  signal?: string | null
}

export interface DatapathLayout {
  scale: number
  canvas: { width: number; height: number; background: string }
  modules: LayoutModule[]
  ports: LayoutPort[]
  wires: LayoutWire[]
}

// ---------------------------------------------------------------- 配色

const C: Record<string, { fill: string; stroke: string }> = {
  rect: { fill: '#ffffff', stroke: '#475569' },
  adder: { fill: '#fff7ed', stroke: '#ea580c' },
  alu: { fill: '#fff7ed', stroke: '#ea580c' },
  mux: { fill: '#f1f5f9', stroke: '#0284c7' },
  circle: { fill: '#eef2ff', stroke: '#4f46e5' },
  trap: { fill: '#fef2f2', stroke: '#dc2626' },
}

// 线色由信号性质决定（规则见 datapathLayout.json 的 _wire_rules）：
//   data    蓝实线 —— 线上传的是「值」（指令码/地址/寄存器数据/立即数/ALU 结果）
//   control 灰虚线 —— 线上传的是「判据或开关量」（译码器输出/选择端/写使能/分支判据）
//   clock   紫实线 —— 全局时序信号（clk / reset）
export const WIRE_COLOR: Record<string, string> = {
  data: '#2563eb', control: '#94a3b8', clock: '#7c3aed', trap: '#dc2626',
}
const WIRE_COLOR_DEFAULT = WIRE_COLOR.data
const LABEL_COLOR: Record<string, string> = {
  data: '#1d4ed8', control: '#64748b', clock: '#6d28d9', trap: '#dc2626',
}
const LABEL_COLOR_DEFAULT = LABEL_COLOR.data

/** 箭头尺寸（渲染像素）。每条线的末端都要有一个，方向 = 该线最后一段的走向。 */
export const ARROW_L = 17
export const ARROW_W = 6.5

/** 字号表（渲染后的最终像素值） */
const FS = {
  module: 20,   // 矩形部件名
  sub: 13,      // 矩形部件副标题（按长度降档 11/12/13）
  textMod: 20,  // 纯文字标签（reset / clock / 常量）
  circle: 15,   // 圆圈部件
  aluChar: 18,  // ALU / 加法器的竖排字母
  aluSub: 12,   // ALU 右侧竖排的 F / ZF 等
  port: 12,     // 端口名
  wire: 15,     // 线名
}

/** 交叉作图标准 */
const HOP_R = 8      // 跨越处半圆隆起的半径
const DOT_R = 3.6    // 电气连接点的实心圆点半径

const FX = (n: number): number => Math.round(n * 100) / 100

/** 建节点的简写 */
function mk(tag: SceneTag, attrs: Record<string, string | number>, extra?: Partial<SceneNode>): SceneNode {
  return { tag, attrs, ...extra }
}

// ---------------------------------------------------------------- 几何基础

interface ScaledModule extends LayoutModule { x: number; y: number; w: number; h: number }

/** 端口坐标（口径必须与 check_layout.py 完全一致） */
export function portPos(m: LayoutModule, side: string, off: number): [number, number] {
  if (side === 'left') return [m.x, m.y + off]
  if (side === 'right') return [m.x + m.w, m.y + off]
  if (side === 'top') return [m.x + off, m.y]
  return [m.x + off, m.y + m.h]
}

function colorsOf(m: LayoutModule): { fill: string; stroke: string } {
  if (m.group === 'TRAP') return C.trap
  return C[m.shape || 'rect'] || C.rect
}

/** 部件外形。返回 null 表示没有外框（纯文字标签）。 */
function shapeNode(m: ScaledModule): SceneNode | null {
  const { x, y, w, h, shape, flip } = m
  switch (shape) {
    case 'alu':
      // 梯形：输入侧那条边全高，输出侧收窄，缺口开在输入侧
      // flip=true 时整体左右镜像（输入在右边，例如 PC+imm 加法器）
      return mk('polygon', {
        points: flip
          ? `${x + w},${y} ${x},${y + h * 0.25} ${x},${y + h * 0.75} ${x + w},${y + h} ${x + w * 0.88},${y + h * 0.5}`
          : `${x},${y} ${x + w},${y + h * 0.25} ${x + w},${y + h * 0.75} ${x},${y + h} ${x + w * 0.12},${y + h * 0.5}`,
      })
    case 'mux':
      // 胶囊形（两端半圆的竖长条），还原示意图里 2 选 1 MUX 的画法
      return mk('rect', { x, y, width: w, height: h, rx: w / 2, ry: w / 2 })
    case 'circle':
      return mk('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 })
    case 'text':
      return null
    default:
      return mk('rect', { x, y, width: w, height: h, rx: 4 })
  }
}

// ---------------------------------------------------------------- 部件

function moduleNode(m: ScaledModule): SceneNode {
  const col = colorsOf(m)
  const cx = m.x + m.w / 2
  const cy = m.y + m.h / 2
  const subs = m.sub ? (Array.isArray(m.sub) ? m.sub : [m.sub]) : []
  const children: SceneNode[] = []

  if (m.shape === 'text') {
    // 纯文字标签（reset / clock / 常量 4 / 常量 0）：居中写字，无框
    children.push(mk('text', {
      x: cx, y: cy + 7, 'text-anchor': 'middle',
      'font-size': FS.textMod, 'font-weight': 700, fill: '#0f172a',
    }, { text: m.label ?? '' }))
  } else {
    const body = shapeNode(m)
    if (body) {
      children.push({ ...body, attrs: { ...body.attrs, fill: col.fill, stroke: col.stroke, 'stroke-width': 2 } })
    }

    if (m.shape === 'mux') {
      // 胶囊形 MUX 内部只写 0 / 1 两个端口号（由 portLabelNode 画），不写部件名。
      // 示意图原作就是这样：胶囊正中横排如果压了字，正好落在中线的那个端口号
      // （如 wbmux0.wb0_1、pcmux5.m5_0）就会被盖掉，读图时看不出它是 0 还是 1。
    } else if (m.shape === 'circle') {
      children.push(mk('text', {
        x: cx, y: cy + 5, 'text-anchor': 'middle',
        'font-size': FS.circle, 'font-weight': 700, fill: '#3730a3',
      }, { text: m.label ?? '' }))
    } else if (m.shape === 'alu') {
      // ALU / 加法器：标签竖排靠中间，副标题（ZF OF F）沿右边竖排
      const chars = String(m.label ?? '').split('')
      const cgap = 22
      chars.forEach((ch, i) => {
        children.push(mk('text', {
          x: cx - (subs.length ? 16 : 0),
          y: cy - (chars.length - 1) * (cgap / 2) + i * cgap + 6,
          'text-anchor': 'middle', 'font-size': FS.aluChar, 'font-weight': 700, fill: '#7c2d12',
        }, { text: ch }))
      })
      if (subs.length) {
        const words = subs.join(' ').split(/\s+/)
        words.forEach((wd, i) => {
          children.push(mk('text', {
            x: cx + 34, y: m.y + m.h * 0.18 + i * 17,
            'text-anchor': 'middle', 'font-size': FS.aluSub, fill: '#9a3412',
          }, { text: wd }))
        })
      }
    } else {
      // 矩形部件：标签 + 副标题整体垂直居中
      const lineH = 19
      const blockH = 24 + subs.length * lineH
      const top = cy - blockH / 2
      children.push(mk('text', {
        x: cx, y: top + 19, 'text-anchor': 'middle',
        'font-size': FS.module, 'font-weight': 700, fill: '#0f172a',
      }, { text: m.label ?? '' }))
      subs.forEach((s, i) => {
        const fs = s.length > 34 ? FS.sub - 2 : s.length > 24 ? FS.sub - 1 : FS.sub
        children.push(mk('text', {
          x: cx, y: top + 24 + lineH * (i + 1),
          'text-anchor': 'middle', 'font-size': fs, fill: '#64748b',
        }, { text: s }))
      })
    }
  }

  return mk('g', { class: 'module', 'data-id': m.id }, {
    meta: { kind: 'module', id: m.id, group: m.group }, children,
  })
}

// ---------------------------------------------------------------- 端口名

/** 端口名照示意图写在框内靠近该条边处 */
function portLabelNodes(ports: LayoutPort[], modById: Record<string, ScaledModule>): SceneNode[] {
  const out: SceneNode[] = []
  for (const p of ports) {
    if (!p.label) continue
    const m = modById[p.module]
    if (!m) continue
    const [px, py] = portPos(m, p.side, p.offset)
    let tx = px
    let ty = py + 4
    let anchor = 'middle'
    if (p.side === 'left') { tx = px + 9; anchor = 'start' }
    if (p.side === 'right') { tx = px - 9; anchor = 'end' }
    if (p.side === 'top') { ty = py + 15 }
    if (p.side === 'bottom') { ty = py - 7 }
    out.push(mk('text', {
      x: FX(tx), y: FX(ty), 'text-anchor': anchor,
    }, { text: p.label, meta: { kind: 'portLabel', id: p.id } }))
  }
  return out
}

// ---------------------------------------------------------------- 网络标签

// 跨越大半张图的同名信号（pc、pc+4）不拉长线，改成在端口旁标注网络名，
// 这是电路图的通行画法：同名即同网，读图时靠名字对应，而不是靠线找。
function netLabelNodes(ports: LayoutPort[], modById: Record<string, ScaledModule>): SceneNode[] {
  const out: SceneNode[] = []
  const H = FS.wire + 9
  const GAP = 15
  const wOf = (s: string) =>
    [...String(s)].reduce((n, ch) => n + (/[一-鿿＀-￯]/.test(ch) ? FS.wire : FS.wire * 0.62), 0) + 14

  for (const p of ports) {
    if (!p.net) continue
    const m = modById[p.module]
    if (!m) continue
    const [px, py] = portPos(m, p.side, p.offset)
    const w = wOf(p.net)
    let bx: number, by: number
    if (p.side === 'right') {
      bx = px + GAP; by = py - H / 2
    } else if (p.side === 'left') {
      bx = px - GAP - w; by = py - H / 2
    } else if (p.side === 'top') {
      bx = px - w / 2; by = py - GAP - H
    } else {
      bx = px - w / 2; by = py + GAP
    }
    const tx = bx + w / 2
    const ty = by + H / 2 + FS.wire * 0.34

    // 引线：从方框连到端口。网络标签接的都是数据端口，所以用 data 色（蓝）。
    const c = WIRE_COLOR.data
    const lx = p.side === 'right' ? bx : p.side === 'left' ? bx + w : px
    const ly = p.side === 'top' ? by + H : p.side === 'bottom' ? by : py
    // 箭头同样画在端口那头，方向指向端口（与普通连线一致）
    const dx = p.side === 'right' ? -1 : p.side === 'left' ? 1 : 0
    const dy = p.side === 'top' ? 1 : p.side === 'bottom' ? -1 : 0
    const abx = px - ARROW_L * dx
    const aby = py - ARROW_L * dy
    const anx = -dy
    const any = dx

    out.push(mk('g', { class: 'netlabel' }, {
      meta: { kind: 'netLabel', id: p.id, net: p.net, signal: p.net },
      children: [
        mk('line', { x1: FX(lx), y1: FX(ly), x2: FX(px), y2: FX(py), stroke: c, 'stroke-width': 2 }),
        mk('polygon', {
          points: `${FX(px)},${FX(py)} ${FX(abx + ARROW_W * anx)},${FX(aby + ARROW_W * any)} ${FX(abx - ARROW_W * anx)},${FX(aby - ARROW_W * any)}`,
          fill: c,
        }),
        mk('rect', {
          x: FX(bx), y: FX(by), width: FX(w), height: FX(H), rx: 4,
          fill: '#ffffff', stroke: c, 'stroke-width': 1.6, 'stroke-dasharray': '5 3',
        }),
        mk('text', {
          x: FX(tx), y: FX(ty), 'text-anchor': 'middle', 'font-size': FS.wire,
          'font-weight': 700, fill: c, 'font-family': 'ui-monospace,Consolas,monospace',
        }, { text: p.net }),
      ],
    }))
  }
  return out
}

// ---------------------------------------------------------------- 连线

interface Seg {
  horz: boolean
  fix: number
  a: number
  b: number
  flip: boolean
  kind: string
  /** 这一段是哪些连线贡献的。合并前恒为单元素，合并后取并集。 */
  ids: string[]
}

function wireStroke(kind?: string): string {
  return WIRE_COLOR[kind || 'data'] || WIRE_COLOR_DEFAULT
}

/** 线段展开 + 共线合并 */
function expandSegments(wires: LayoutWire[]): Seg[] {
  // 多条线从同一端口分叉时会有完全重合的线段，必须先合并，否则会重叠画两遍、
  // 而且分叉点会被误当成「端点落在中段」以外的情形。
  const groups = new Map<string, Seg[]>()
  for (const w of wires) {
    const kind = w.kind || 'data'
    const pts = w.points || []
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[i + 1]
      if (x1 === x2 && y1 === y2) continue
      const horz = Math.abs(y1 - y2) < 0.5
      const fix = horz ? y1 : x1
      const key = `${horz ? 'h' : 'v'}|${FX(fix)}|${kind}`
      if (!groups.has(key)) groups.set(key, [])
      ;(groups.get(key) as Seg[]).push({
        horz, fix,
        a: Math.min(horz ? x1 : y1, horz ? x2 : y2),
        b: Math.max(horz ? x1 : y1, horz ? x2 : y2),
        flip: (horz ? x1 : y1) > (horz ? x2 : y2),
        kind,
        ids: [w.id],
      })
    }
  }
  const segs: Seg[] = []
  for (const list of groups.values()) {
    list.sort((p, q) => p.a - q.a)
    let cur: Seg = { ...list[0], ids: [...list[0].ids] }
    for (let i = 1; i < list.length; i++) {
      const s = list[i]
      if (s.a <= cur.b + 0.5) {                                // 重叠或首尾相接 → 合成一段
        cur.b = Math.max(cur.b, s.b)
        cur.ids = [...new Set([...cur.ids, ...s.ids])]
      } else { segs.push(cur); cur = { ...s, ids: [...s.ids] } }
    }
    segs.push(cur)
  }
  return segs
}

/**
 * 交点分类
 *   十字（两段都在中段）→ 不连接 → 水平那条画半圆隆起，竖线直穿
 *   T 型（一条的端点落在另一条中段）→ 电气连接 → 画实心圆点
 */
function classifyCrossings(segs: Seg[]): { hops: Map<Seg, number[]>; joints: Set<string> } {
  const hSegs = segs.filter((s) => s.horz)
  const vSegs = segs.filter((s) => !s.horz)
  const hops = new Map<Seg, number[]>()
  const joints = new Set<string>()
  for (const h of hSegs) {
    for (const v of vSegs) {
      const vx = v.fix
      const hy = h.fix
      if (!(vx > h.a - 0.5 && vx < h.b + 0.5)) continue
      if (!(hy > v.a - 0.5 && hy < v.b + 0.5)) continue
      const atHEnd = Math.abs(vx - h.a) < 0.5 || Math.abs(vx - h.b) < 0.5
      const atVEnd = Math.abs(hy - v.a) < 0.5 || Math.abs(hy - v.b) < 0.5
      if (!atHEnd && !atVEnd) {
        if (!hops.has(h)) hops.set(h, [])
        ;(hops.get(h) as number[]).push(vx)
      } else if (atHEnd !== atVEnd) {
        joints.add(`${FX(vx)},${FX(hy)}`)
      }
      // 两者都是端点 → 拐角，跳过
    }
  }
  return { hops, joints }
}

/** 线名标签的落点 */
interface LabelPlacement {
  box: number[]
  mx: number
  my: number
  color: string
  text: string
  id: string
}

/**
 * 线名标签：挑最长的线段试落点，落点不能压部件框、不能和其他线名重叠；都失败才兜底。
 *
 * 结果同时被两处用：这里画线名方框；DatapathView 把实时数值气泡放在同一个锚点上。
 * 拆出来是为了让气泡复用线名的避让结果——不拆的话气泡得另算一遍避让，两份迟早漂移。
 */
function computeWireLabels(wires: LayoutWire[], mods: ScaledModule[], sc: number): LabelPlacement[] {
  const LABEL_H = (FS.wire + 8) * (sc / 1.7)
  const moduleBoxes = mods.map((m) => [m.x, m.y, m.x + m.w, m.y + m.h])
  const hit = (a: number[], b: number[]) =>
    !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1])

  const placed: number[][] = []
  const labels: LabelPlacement[] = []

  for (const w of wires) {
    if (!w.label) continue
    const pts = w.points || []
    if (pts.length < 2) continue

    const text = String(w.label)
    // 中文/全角按 1 个字号宽、拉丁字符按 0.62 个字号宽估算
    const tw = [...text].reduce((n, ch) => n + (/[一-鿿＀-￯]/.test(ch) ? FS.wire : FS.wire * 0.62), 0) * (sc / 1.7) + 8

    const order: Array<[number, number]> = []
    for (let i = 0; i < pts.length - 1; i++) {
      const len = Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1])
      order.push([len, i])
    }
    order.sort((a, b) => b[0] - a[0])

    // o = 垂直于该段的偏移。短线（比线名还短）上贴不住，就整体挪到线旁边去。
    const cand = (i: number, t: number, o: number): number[] => {
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[i + 1]
      const horz = Math.abs(y2 - y1) < 0.5
      const mx = x1 + (x2 - x1) * t + (horz ? 0 : o)
      const my = y1 + (y2 - y1) * t + (horz ? o : 0)
      return [mx - tw / 2, my - LABEL_H / 2, mx + tw / 2, my + LABEL_H / 2, mx, my]
    }

    // 末端那个箭头的包围盒（末端 17px 的实心三角）——线名绝不能压住它。
    // 早先用的是「终点 ±ARROW_L 的方框」，对短线来说每个落点都被判成压箭头，
    // 结果退化成硬放，框正好盖住箭头和端口名。改成按箭头的真实几何判定。
    const pn = pts[pts.length - 2]
    const [ex, ey] = pts[pts.length - 1]
    const adx = Math.sign(ex - pn[0])
    const ady = Math.sign(ey - pn[1])
    const arrowBox = [
      Math.min(ex, ex - ARROW_L * adx) - ARROW_W, Math.min(ey, ey - ARROW_L * ady) - ARROW_W,
      Math.max(ex, ex - ARROW_L * adx) + ARROW_W, Math.max(ey, ey - ARROW_L * ady) + ARROW_W,
    ]
    const OFF = LABEL_H / 2 + ARROW_W + 6

    let chosen: number[] | null = null
    for (const o of [0, -OFF, OFF, -2 * OFF, 2 * OFF]) {
      for (const [, i] of order) {
        for (const t of [0.5, 0.35, 0.65, 0.25, 0.75]) {
          const c = cand(i, t, o)
          const box = c.slice(0, 4)
          if (moduleBoxes.some((mb) => hit(box, mb))) continue
          if (placed.some((pb) => hit(box, pb))) continue
          if (hit(box, arrowBox)) continue
          chosen = c
          break
        }
        if (chosen) break
      }
      if (chosen) break
    }
    if (!chosen) chosen = cand(order[0][1], 0.5, -OFF)

    placed.push(chosen.slice(0, 4))
    labels.push({
      box: chosen.slice(0, 4),
      mx: chosen[4], my: chosen[5],
      color: LABEL_COLOR[w.kind || 'data'] || LABEL_COLOR_DEFAULT,
      text, id: w.id,
    })
  }
  return labels
}

function wireLabelNodes(labels: LabelPlacement[], sc: number): SceneNode[] {
  if (!labels.length) return []
  const fsz = FX(FS.wire * (sc / 1.7))
  return labels.map(({ box, mx, my, color, text, id }) =>
    mk('g', {}, {
      meta: { kind: 'wireLabel', id },
      children: [
        mk('rect', {
          x: FX(box[0]), y: FX(box[1]), width: FX(box[2] - box[0]),
          height: FX(box[3] - box[1]), rx: 3, fill: '#f8fafc', opacity: 0.92,
        }),
        mk('text', {
          x: FX(mx), y: FX(my + FS.wire * 0.32 * (sc / 1.7)), fill: color,
          'font-size': fsz, 'font-weight': 600, 'text-anchor': 'middle',
        }, { text }),
      ],
    }))
}

// ---------------------------------------------------------------- 主入口

export function buildDatapathScene(L: DatapathLayout): DatapathScene {
  const sc = Number(L.scale) || 1
  const W = L.canvas.width
  const H = L.canvas.height
  const BG = L.canvas.background

  // 统一缩放：把示意图原始坐标放大成渲染坐标。
  // 注意是生成新对象，绝不就地改入参 —— 前端那边传进来的是响应式对象，
  // 就地乘会让它每渲染一次就被放大一轮。
  const mods: ScaledModule[] = (L.modules || []).map((m) => ({
    ...m, x: m.x * sc, y: m.y * sc, w: m.w * sc, h: m.h * sc,
  }))
  const ports: LayoutPort[] = (L.ports || []).map((p) => ({ ...p, offset: p.offset * sc }))
  const wires: LayoutWire[] = (L.wires || []).map((w) => ({
    ...w, points: (w.points || []).map(([a, b]) => [a * sc, b * sc] as [number, number]),
  }))
  const modById: Record<string, ScaledModule> = Object.fromEntries(mods.map((m) => [m.id, m]))

  const nodes: SceneNode[] = [mk('rect', { width: W, height: H, fill: BG })]

  // 线名落点算一次，画标签和放数值气泡共用（见 computeWireLabels 的注释）
  const labelPlacements = computeWireLabels(wires, mods, sc)
  const wireAnchors: Record<string, [number, number]> = {}
  for (const p of labelPlacements) wireAnchors[p.id] = [p.mx, p.my]
  // 没线名的连线补一个兜底锚点，同样只为放数值气泡
  for (const w of wires) {
    if (wireAnchors[w.id]) continue
    const a = fallbackAnchor(w.points || [], 20 * (sc / 1.7))
    if (a) wireAnchors[w.id] = a
  }

  // ---- 部件 ----
  nodes.push(mk('g', {}, { children: mods.map(moduleNode) }))

  // ---- 连线 ----
  if (wires.length) {
    const segs = expandSegments(wires)
    const { hops, joints } = classifyCrossings(segs)

    // 画线
    const wireChildren: SceneNode[] = []
    for (const s of segs) {
      let d: string
      if (!s.horz) {
        d = `M ${FX(s.fix)} ${FX(s.flip ? s.b : s.a)} L ${FX(s.fix)} ${FX(s.flip ? s.a : s.b)}`
      } else {
        // 水平段：在每个跨越点处断开，插一段半圆隆起，从竖线上方跨过去。
        // 半圆用圆弧命令 A；sweep=1 是从左往右画时的「逆时针」，在本坐标系（y 向下）里正好向上凸。
        const xsAbs = [...new Set((hops.get(s) || []).map((x) => FX(x)))].sort((p, q) => p - q)
        const xs = s.flip ? [...xsAbs].reverse() : xsAbs
        const rad = new Map(xsAbs.map((x, i) => {
          const left = (i === 0 ? x - s.a : x - xsAbs[i - 1]) / 2 - 1.5
          const right = (i === xsAbs.length - 1 ? s.b - x : xsAbs[i + 1] - x) / 2 - 1.5
          return [x, Math.max(0, Math.min(HOP_R, left, right))]
        }))
        const sweep = s.flip ? 0 : 1
        const pieces = [`M ${FX(s.flip ? s.b : s.a)} ${FX(s.fix)}`]
        for (const x of xs) {
          const r = rad.get(x) as number
          if (r < 3) continue          // 太挤，这一处就不抬了，直线穿过去
          const near = FX(s.flip ? x + r : x - r)
          const far = FX(s.flip ? x - r : x + r)
          pieces.push(`L ${near} ${FX(s.fix)}`)
          pieces.push(`A ${FX(r)} ${FX(r)} 0 0 ${sweep} ${far} ${FX(s.fix)}`)
        }
        pieces.push(`L ${FX(s.flip ? s.a : s.b)} ${FX(s.fix)}`)
        d = pieces.join(' ')
      }
      const attrs: Record<string, string | number> = {
        d, stroke: wireStroke(s.kind), 'stroke-width': 2.5,
      }
      if (s.kind === 'control') attrs['stroke-dasharray'] = '6 4'
      wireChildren.push(mk('path', attrs, { meta: { kind: 'wire', wires: s.ids } }))
    }
    nodes.push(mk('g', {
      fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }, { children: wireChildren }))

    // 箭头：每条线的末端都画一个实心三角，方向 = 该线最后一段的走向，落点就是端口。
    //
    // 这里不走 SVG 的 marker-end：marker-end 挂在「合并后的线段」上，而多条线
    // 从同一端口分叉时共线的段会被合并成一段、方向取任意一条的，导致部分线
    // 的箭头丢失或反向。按线逐条画就没有这个问题 —— 每条线恰好一个箭头。
    const arrows: SceneNode[] = []
    for (const w of wires) {
      const pts = w.points || []
      if (pts.length < 2) continue
      const [x0, y0] = pts[pts.length - 2]
      const [x1, y1] = pts[pts.length - 1]
      const dx = Math.sign(x1 - x0)
      const dy = Math.sign(y1 - y0)
      if (!dx && !dy) continue
      const bx = x1 - ARROW_L * dx
      const by = y1 - ARROW_L * dy
      const nx = -dy
      const ny = dx                 // 垂线方向
      arrows.push(mk('polygon', {
        points: `${FX(x1)},${FX(y1)} ${FX(bx + ARROW_W * nx)},${FX(by + ARROW_W * ny)} ${FX(bx - ARROW_W * nx)},${FX(by - ARROW_W * ny)}`,
        fill: wireStroke(w.kind),
      }, { meta: { kind: 'arrow', id: w.id, signal: incomingSignal(w) } }))
    }
    nodes.push(mk('g', {}, { children: arrows }))

    // 电气连接点（T 型接点画实心圆点）
    if (joints.size) {
      const dots = [...joints].map((k) => {
        const [x, y] = k.split(',').map(Number)
        return mk('circle', { cx: FX(x), cy: FX(y), r: DOT_R, fill: '#1e293b' }, { meta: { kind: 'dot' } })
      })
      nodes.push(mk('g', {}, { children: dots }))
    }

    // 线名标签
    const lbls = wireLabelNodes(labelPlacements, sc)
    if (lbls.length) nodes.push(mk('g', { 'font-weight': 600 }, { children: lbls }))
  }

  // ---- 端口名 / 网络标签画在最上层（框内文字不该被线压住）----
  nodes.push(mk('g', { 'font-size': FS.port, 'font-weight': 600, fill: '#0f172a' }, {
    children: portLabelNodes(ports, modById),
  }))
  nodes.push(mk('g', {}, { children: netLabelNodes(ports, modById) }))

  return { width: W, height: H, background: BG, nodes, wireAnchors }
}

/** 取该线要跟着哪个后端信号高亮；优先用连线自己的 signal，其次看它出发的端口有没有 net */
function incomingSignal(w: LayoutWire): string | undefined {
  if (w.signal) return w.signal
  return undefined
}

/**
 * 没有线名的连线（57 条里有 14 条）没有现成落点，给它们算一个：
 * 取最长线段的中点，沿该段法线偏出去一点，免得实时数值气泡压在线上。
 */
function fallbackAnchor(pts: Array<[number, number]>, off: number): [number, number] | null {
  if (!pts || pts.length < 2) return null
  let best = 0
  let bestLen = -1
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1])
    if (len > bestLen) { bestLen = len; best = i }
  }
  const [x1, y1] = pts[best]
  const [x2, y2] = pts[best + 1]
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const horz = Math.abs(y2 - y1) < 0.5
  return horz ? [FX(mx), FX(my - off)] : [FX(mx + off), FX(my)]
}

/** 从布局反查：端口 → 它所属部件（用于「部件是否被激活」的推导，不硬编码） */
export function portToModule(L: DatapathLayout): Record<string, string> {
  return Object.fromEntries((L.ports || []).map((p) => [p.id, p.module]))
}

/** 从布局反查：连线 id → 它两端的端口 id */
export function wireEndpoints(L: DatapathLayout): Record<string, { from: string; to: string }> {
  return Object.fromEntries((L.wires || []).map((w) => [w.id, { from: w.from, to: w.to }]))
}
