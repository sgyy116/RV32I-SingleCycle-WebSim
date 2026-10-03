// ============================================================================
// _palette_check.mjs —— 连线配色标准的离线断言
//
// 这一轮把线色收进 datapathPalette.ts 一份，但有三处**跨文件、跨语言**的约定
// 是编译器管不到的，而且全都会静默失效（不报错、页面照常渲染，只是颜色不对）：
//
//   1. datapath.css 的 --dp-hl-* 必须等于 palette 的 HILITE。
//      CSS 引用不了 TS，只能靠这里反过来断言。
//   2. datapath.css 全文（含注释）不许出现半角左尖括号和半角与号。
//      它要被内联进独立 SVG，而 SVG 按 XML 解析 —— 出现就会被当成标签/实体，
//      报 "Unclosed closing tag: style" 然后整页白屏。hl_preview.mjs 里也有这道
//      检查，但那要等到跑离线截图才炸；放这里更早。
//   3. datapathLayout.json 里每条线的 kind 必须是六个合法值之一。
//      拼错（adress）不会报错，wireSpec() 会静默回落到 data 蓝 —— 线悄悄变蓝，
//      只有靠断言才抓得住。
//
// 另外两条是防「规矩被后人写松」的：
//   4. .wk-control.dp-lit 必须排在 .dp-lit.dp-fresh 之前。
//      两者权重同为 (0,3,0)，同权重后写的赢 —— 顺序反了会把「本波新到」的
//      流动动画压成静态虚线，效果是可用的，只是逐波播放时看不出信号在流动。
//   5. 六个类别每个都至少有一条线。否则图例上就是一条永远对不上图的死条目。
//
// 最后三条是用户反馈「有些线的颜色比较相像」之后补的，不对应上面那种跨文件约定，
// 而是直接把颜色算出来比距离：
//   6. 图例必须 v-for 迭代 WIRE_KINDS —— 色值只可能从表里来，不许手抄。
//   7. 六类线两两之间，在正常视觉和三种色盲模拟下都要分得开（CIEDE2000）。
//   8. 线色与部件描边色之间同样要分得开 —— 线插进框里时不能和框一个颜色。
//
// 退出码：0 通过 / 1 断言失败 / 3 跳过（读不到源文件）。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SKIP = 3
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const CSS_PATH = path.join(root, 'frontend/src/styles/datapath.css')
const LAYOUT_PATH = path.join(root, 'frontend/src/data/datapathLayout.json')

let WIRE_KINDS, HILITE
try {
  ;({ WIRE_KINDS, HILITE } = await import('../frontend/src/data/datapathPalette.ts'))
} catch (e) {
  if (e && e.code === 'ERR_MODULE_NOT_FOUND') {
    console.log(`  跳过：读不到调色板（${e.message.split('\n')[0]}）`)
    process.exit(SKIP)
  }
  throw e
}

if (!fs.existsSync(CSS_PATH) || !fs.existsSync(LAYOUT_PATH)) {
  console.log('  跳过：datapath.css 或 datapathLayout.json 不在预期位置')
  process.exit(SKIP)
}

const css = fs.readFileSync(CSS_PATH, 'utf8')
const layout = JSON.parse(fs.readFileSync(LAYOUT_PATH, 'utf8'))
const fails = []
const bad = (m) => fails.push(m)

// --- 1. CSS 里的高亮色 == palette 的 HILITE -------------------------------
for (const [key, varName] of [['module', '--dp-hl-module'], ['trap', '--dp-hl-trap']]) {
  const m = css.match(new RegExp(`${varName}\\s*:\\s*(#[0-9a-fA-F]{3,8})`))
  if (!m) {
    bad(`datapath.css 里找不到 ${varName} 的定义`)
  } else if (m[1].toLowerCase() !== HILITE[key].toLowerCase()) {
    bad(`${varName}=${m[1]} 与 palette 的 HILITE.${key}=${HILITE[key]} 不一致`)
  }
}
// 定义出来了却没人用，等于白定义（改了值也不会有效果）
for (const varName of ['--dp-hl-module', '--dp-hl-trap']) {
  if (!css.includes(`var(${varName})`)) bad(`${varName} 定义了但没有任何规则引用它`)
}

// --- 2. 禁字符 -------------------------------------------------------------
const badChars = css.split('\n')
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => /[<&]/.test(l))
for (const [n, l] of badChars) {
  bad(`datapath.css 第 ${n} 行有半角尖括号或 &，内联进 SVG 会整页白屏：${l.trim().slice(0, 60)}`)
}

// --- 3. 每条线的 kind 合法 --------------------------------------------------
const legal = new Set(WIRE_KINDS.map((k) => k.kind))
const illegal = layout.wires.filter((w) => !legal.has(w.kind))
for (const w of illegal) bad(`连线 ${w.id} 的 kind="${w.kind}" 不是六个合法值之一`)
const missing = layout.wires.filter((w) => !w.kind)
for (const w of missing) bad(`连线 ${w.id} 没有 kind 字段`)

// --- 4. wk-control 规则的位置 -----------------------------------------------
// 必须先剥掉注释再找位置：注释里也会出现这些选择器名（本文件上面那条规则的
// 注释就写着「必须写在下一条 .dp-lit.dp-fresh 之前」），直接 indexOf 会命中
// 注释、得出与事实相反的结论。踩过一次。
const cssBare = css.replace(/\/\*[\s\S]*?\*\//g, '')
const iCtl = cssBare.indexOf('.wk-control.dp-lit')
const iFresh = cssBare.indexOf('.dp-lit.dp-fresh')
if (iCtl < 0) {
  bad('datapath.css 里没有 .wk-control.dp-lit —— 控制线通电后虚线会消失')
} else if (iFresh >= 0 && iCtl > iFresh) {
  bad('.wk-control.dp-lit 排在了 .dp-lit.dp-fresh 之后，同权重下会压掉「本波新到」的流动动画')
}

// --- 5. 每一类都真的有线 ----------------------------------------------------
const used = new Set(layout.wires.map((w) => w.kind))
for (const k of WIRE_KINDS) {
  if (!used.has(k.kind)) bad(`类别 ${k.kind}（${k.label}）在布局里一条线都没有，图例上会是死条目`)
}

// --- 6. 图例必须由调色板渲染 ------------------------------------------------
// 这里刻意**不**去扫「DatapathView 里出现了线色 hex 没有」——试过，误报：
// control 的 #64748b 就是 slate-500，本来还被 .status-pill/.disconnected 当
// 普通文字灰用着，扫出来三条全不是线色。改成断言结构本身：图例的 v-for 必须
// 直接迭代 WIRE_KINDS，这样色值只可能从表里来。
const VIEW_PATH = path.join(root, 'frontend/src/components/datapath/DatapathView.vue')
if (fs.existsSync(VIEW_PATH)) {
  const view = fs.readFileSync(VIEW_PATH, 'utf8')
  if (!/v-for="k in WIRE_KINDS"/.test(view)) {
    bad('DatapathView.vue 的图例没有 v-for 迭代 WIRE_KINDS —— 色值会重新变成手抄的')
  }
  if (!/wireKindLabel/.test(view)) {
    bad('DatapathView.vue 没有用 wireKindLabel —— 悬停提示会把 control 这种英文 token 露给学生')
  }
}

// --- 7. 六类线之间必须真的分得开 --------------------------------------------
// 这一条是用户反馈「有些线的颜色不一样，但是比较相像」之后补的。旧配色
// （蓝 #1d4ed8 / 紫 #6d28d9）在红绿色盲模拟下 ΔE 只有 0.66 —— 图上就是
// 同一个颜色，而且没有任何断言拦得住，因为「颜色不同」这件事在源码层面
// 完全成立。所以这里直接算 CIEDE2000，把「分得开」变成可执行的判据。
//
// 阈值留了一点余量（当前实测 28.03 / 10.67，阈值 26 / 10），够抓退化，又不至于
// 微调一下就红。
//
// MIN_CONTRAST 是 3.2 而不是 3.5，专门为「金黄」让的：亮金黄在白底上物理上
// 就到不了（#EAB308 只有 1.92:1，#CA8A04 2.94:1），能用的最早一档是
// #b8860b 的 3.25:1，再亮 2.5px 细线就糊了。其余五色实测都在 3.68:1 以上，
// 3.2 这个下限仍然拦得住「谁把颜色改浅到看不见」。
const MIN_NORMAL = 26
const MIN_CVD = 10
const MIN_CONTRAST = 3.2

const hex2rgb = (h) => {
  const s = h.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16))
}
const toLin = (c) => {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const toSrgb = (c) => {
  c = Math.min(1, Math.max(0, c))
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
}
const relLum = (h) => {
  const [r, g, b] = hex2rgb(h).map(toLin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrastWhite = (h) => 1.05 / (relLum(h) + 0.05)

const fLab = (t) => (t > 216 / 24389 ? t ** (1 / 3) : (841 / 108) * t + 4 / 29)
function toLab(h) {
  const [r, g, b] = hex2rgb(h).map(toLin)
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
  const Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
  const Z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b
  const [fx, fy, fz] = [X / 0.95047, Y, Z / 1.08883].map(fLab)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

// 色觉模拟：Machado et al. 2009，severity = 1.0，作用在线性 RGB 上
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}
function cvd(h, kind) {
  const lin = hex2rgb(h).map(toLin)
  const out = MACHADO[kind].map((row) => row.reduce((a, m, j) => a + m * lin[j], 0))
  return '#' + out.map((v) => Math.round(toSrgb(v) * 255).toString(16).padStart(2, '0')).join('')
}

function de2000(l1, l2) {
  const [L1, a1, b1] = l1
  const [L2, a2, b2] = l2
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2)
  const Cb = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
  const [a1p, a2p] = [(1 + G) * a1, (1 + G) * a2]
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2)
  const h1p = (Math.atan2(b1, a1p) * 180 / Math.PI + 360) % 360
  const h2p = (Math.atan2(b2, a2p) * 180 / Math.PI + 360) % 360
  const dLp = L2 - L1, dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (Math.abs(dhp) > 180) dhp += dhp > 0 ? -360 : 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360)
  const Lb = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2
  let hb
  if (C1p * C2p === 0) hb = h1p + h2p
  else if (Math.abs(h1p - h2p) <= 180) hb = (h1p + h2p) / 2
  else hb = (h1p + h2p < 360 ? h1p + h2p + 360 : h1p + h2p - 360) / 2
  const rad = (d) => d * Math.PI / 180
  const T = 1 - 0.17 * Math.cos(rad(hb - 30)) + 0.24 * Math.cos(rad(2 * hb))
    + 0.32 * Math.cos(rad(3 * hb + 6)) - 0.20 * Math.cos(rad(4 * hb - 63))
  const dth = 30 * Math.exp(-(((hb - 275) / 25) ** 2))
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
  const SL = 1 + 0.015 * (Lb - 50) ** 2 / Math.sqrt(20 + (Lb - 50) ** 2)
  const SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T
  const RT = -Math.sin(rad(2 * dth)) * RC
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2
    + RT * (dCp / SC) * (dHp / SH))
}

const colors = WIRE_KINDS.map((k) => k.color)
for (const k of WIRE_KINDS) {
  const c = contrastWhite(k.color)
  if (c < MIN_CONTRAST) {
    bad(`${k.label} ${k.color} 白底对比只有 ${c.toFixed(2)}:1，低于 ${MIN_CONTRAST}:1（2.5px 细线的可见性下限）`)
  }
}
let worst = { d: Infinity, vision: '', a: '', b: '' }
for (const vision of ['normal', 'protan', 'deutan', 'tritan']) {
  const sim = colors.map((c) => (vision === 'normal' ? c : cvd(c, vision)))
  const labs = sim.map(toLab)
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      const d = de2000(labs[i], labs[j])
      if (d < worst.d) {
        worst = { d, vision, a: `${WIRE_KINDS[i].label} ${colors[i]}`, b: `${WIRE_KINDS[j].label} ${colors[j]}` }
      }
    }
  }
}
const limit = worst.vision === 'normal' ? MIN_NORMAL : MIN_CVD
if (worst.d < limit) {
  bad(`最像的一对在「${worst.vision}」下 ΔE 只有 ${worst.d.toFixed(2)}（要求 >= ${limit}）：`
    + `${worst.a} vs ${worst.b} —— 图上会看成同一个颜色`)
}

// --- 8. 线色与部件描边色也要分得开 ------------------------------------------
// 这一组是 MUX 描边从青改灰时补的。改之前这里是全图最差的一对：地址 / PC 的
// 青 #0891b2 vs MUX 描边 #0284c7，ΔE 只有 10.94（色相只差 7 度）—— 青色地址线
// 插进青色边框的 MUX 时线框分不干净。这类问题同样不会让任何东西报错：颜色
// 当然「不一样」，源码里也看不出问题，只有把距离算出来才知道。
//
// 这里刻意**不**去读 datapathScene.ts 里那张私有配色表（正则捞 const C 太脆），
// 而是直接 buildDatapathScene() 把场景树跑出来，再从 kind='module' 的节点上取
// 真正发出去的 stroke —— 断言渲染产物而不是源码里的表，中间少一层能各自漂移
// 的地方。datapathScene 本来就能在 Node 里跑（可擦除语法），preview.mjs 一直这么用。
//
// 只断言正常视觉：色盲模拟下有一处**早就存在、与本次改动无关**的瓶颈 ——
// 「立即数金黄 #b8860b vs 加法器 / ALU 橙 #ea580c」在 deutan 下只差 1.03，
// 断言会立刻红。那是独立问题（见 datapathPalette.ts 顶部注释），这里把它算出来
// 打印但不拦：既不被静默无视，也不会被误读成「已经通过」。
const MIN_WIRE_MODULE = 11

const SCENE_TS = path.join(root, 'frontend/src/data/datapathScene.ts')
let modStrokes = null
if (!fs.existsSync(SCENE_TS)) {
  bad('找不到 datapathScene.ts，第 8 组（线 vs 框）没有执行')
} else {
  try {
    const { buildDatapathScene } = await import('../frontend/src/data/datapathScene.ts')
    const set = new Set()
    const walk = (n) => {
      if (n.meta && n.meta.kind === 'module') {
        // 部件外形是 group 的第一个带 stroke 的子节点；shape='text' 的部件没有框
        const body = (n.children || []).find((c) => c.attrs && typeof c.attrs.stroke === 'string')
        if (body) set.add(body.attrs.stroke)
      }
      for (const c of n.children || []) walk(c)
    }
    for (const n of buildDatapathScene(layout).nodes) walk(n)
    modStrokes = [...set].sort()
  } catch (e) {
    bad(`第 8 组跑不出场景树：${String(e && e.message).split('\n')[0]}`)
  }
}

/** 线色 × 部件描边色 的最小 ΔE，返回 (值, 哪条线, 哪个框)。 */
function wireVsModule(vision) {
  const sim = (c) => (vision === 'normal' ? c : cvd(c, vision))
  const wl = colors.map((c) => toLab(sim(c)))
  const ml = modStrokes.map((c) => toLab(sim(c)))
  let w = { d: Infinity, a: '', b: '' }
  for (let i = 0; i < wl.length; i++) {
    for (let j = 0; j < ml.length; j++) {
      const d = de2000(wl[i], ml[j])
      if (d < w.d) w = { d, a: `${WIRE_KINDS[i].label} ${colors[i]}`, b: modStrokes[j] }
    }
  }
  return w
}

let wmNormal = null
let wmCvd = null
if (modStrokes && modStrokes.length) {
  wmNormal = wireVsModule('normal')
  wmCvd = ['protan', 'deutan', 'tritan']
    .map((v) => ({ v, ...wireVsModule(v) }))
    .sort((a, b) => a.d - b.d)[0]
  if (wmNormal.d < MIN_WIRE_MODULE) {
    bad(`线色与部件描边色最像的一对 ΔE 只有 ${wmNormal.d.toFixed(2)}（要求 >= ${MIN_WIRE_MODULE}）：`
      + `${wmNormal.a} vs 部件描边 ${wmNormal.b} —— 线插进这个框时线框分不干净`)
  }
}

// --- 报告 ------------------------------------------------------------------
const dist = WIRE_KINDS.map((k) => `${k.kind}=${layout.wires.filter((w) => w.kind === k.kind).length}`).join(' ')
console.log(`  线色 ${WIRE_KINDS.length} 类，${layout.wires.length} 条线的分布：${dist}`)
console.log(`  高亮色：module=${HILITE.module} trap=${HILITE.trap}`)
console.log(`  最像的一对：${worst.a} vs ${worst.b} —— ${worst.vision} 下 ΔE=${worst.d.toFixed(2)}`
  + `（阈值 正常 ${MIN_NORMAL} / 色盲 ${MIN_CVD}）`)
if (wmNormal) {
  console.log(`  线 vs 部件框：${modStrokes.length} 种框色 ${modStrokes.join(' ')}`)
  console.log(`    正常视觉最差 ΔE=${wmNormal.d.toFixed(2)}（${wmNormal.a} vs ${wmNormal.b}，阈值 ${MIN_WIRE_MODULE}）`)
  console.log(`    色盲最差 ΔE=${wmCvd.d.toFixed(2)}（${wmCvd.v}：${wmCvd.a} vs ${wmCvd.b}）`
    + ' —— 已知旧问题，未拦，见 datapathPalette.ts 顶部')
}

if (fails.length) {
  console.log(`\n断言失败 ${fails.length} 处：`)
  for (const f of fails) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('  ✓ 配色标准一致（CSS ↔ 调色板 ↔ 布局）')
process.exit(0)
