// UI 回归：用真实中间层与核心，Playwright 由工作站测试环境提供。
// 捕获：收起仍占整条空间、缩放范围不足、部件边框虚线、端口误亮、停机后无法完成动画。
const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const out = path.join(root, 'tools/out/ui-v1.4.1')
fs.mkdirSync(out, { recursive: true })
const server = spawn('python', ['-B', 'server.py'], {
  cwd: path.join(root, 'backend/python'), windowsHide: true,
  env: { ...process.env, WS_PORT: '18080', COMPILE_PORT: '18081', TEMP: out, TMP: out },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = '', browser
server.stdout.on('data', b => { logs += b })
server.stderr.on('data', b => { logs += b })
const results = [], errors = []
const delay = ms => new Promise(r => setTimeout(r, ms))
async function open(width = 1920, height = 1080) {
  const context = await browser.newContext({ viewport: { width, height } })
  await context.addInitScript(() => {
    const Native = window.WebSocket
    window.WebSocket = class extends Native {
      constructor(url, protocols) { super(String(url).replace(':8080', ':18080'), protocols) }
    }
  })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('http://localhost:18081', { waitUntil: 'networkidle' })
  await page.getByText('后端已连接', { exact: true }).waitFor()
  return { page, context }
}
async function check(name, body) {
  const { page, context } = await open()
  try { await body(page); results.push({ name, passed: true }) }
  catch (e) { results.push({ name, passed: false, error: e.message }); process.exitCode = 1 }
  finally { await context.close() }
}
async function load(page, source) {
  await page.evaluate(async source => {
    const sim = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator')
    if (!await sim.compileAndLoad(source)) throw Error(sim.compileErrors.join('\n'))
  }, source)
  await page.waitForFunction(() => {
    const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator')
    return s.statusText.startsWith('程序已加载') && s.disassembly.length > 0
  })
}
async function step(page) {
  const count = await page.evaluate(() => {
    const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator')
    const c = s.stateHistory.length; s.step(); return c
  })
  await page.waitForFunction(c => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator').stateHistory.length > c, count)
}
async function main() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch('http://localhost:18081')).ok) break } catch {}
    if (server.exitCode !== null || i === 79) throw Error(logs || '服务启动失败')
    await delay(250)
  }
  browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
  await check('缩放范围与1:1复位', async p => {
    const svg = p.locator('svg.dp-svg'), original = await svg.getAttribute('viewBox')
    const slider = p.locator('.zoom-bar [role="slider"]')
    await slider.focus()
    // Naive Slider 只实现方向键，不实现 Home/End；通过真实键盘操作到边界。
    for (let i = 0; i < 60; i++) await p.keyboard.press('ArrowRight')
    await p.waitForTimeout(80)
    const v = (await svg.getAttribute('viewBox')).split(' ').map(Number)
    assert(Math.abs(2405 / v[2] - 3) < .01, '最大缩放未达到3倍')
    for (let i = 0; i < 60; i++) await p.keyboard.press('ArrowLeft')
    await p.waitForTimeout(80)
    assert(Math.abs(2405 / Number((await svg.getAttribute('viewBox')).split(' ')[2]) - .6) < .01)
    await p.getByRole('button', { name: '1:1', exact: true }).click()
    assert.equal(await svg.getAttribute('viewBox'), original)
  })
  await check('工具条统一与画布背景一致', async p => {
    const style = await p.evaluate(() => {
      const a = getComputedStyle(document.querySelector('.zoom-bar')), b = getComputedStyle(document.querySelector('.status-pill'))
      const rect = document.querySelector('.dp-svg > rect') || document.querySelector('.dp-svg > g > rect')
      return { a: [a.backgroundColor, a.borderRadius, a.color], b: [b.backgroundColor, b.borderRadius, b.color],
        wrap: getComputedStyle(document.querySelector('.dp-wrap')).backgroundColor, svg: getComputedStyle(rect).fill }
    })
    assert.deepEqual(style.a, style.b, '缩放和周期栏视觉规范不同')
    assert.equal(style.wrap, style.svg, '中央留白与图样背景色不同')
  })
  await check('侧栏收起仅留按钮且保留撤销', async p => {
    const e = p.locator('.cm-content')
    await e.click(); await p.keyboard.press('Control+End'); await p.keyboard.type('\n# KEEP_UNDO')
    await p.locator('.n-tabs-tab').filter({ hasText: /^波形$/ }).click()
    await p.getByRole('button', { name: /选择信号/ }).click()
    await p.getByRole('button', { name: 'x28/t3', exact: true }).click()
    for (const side of ['左', '右']) {
      await p.getByRole('button', { name: `收起${side}侧面板`, exact: true }).click()
      const button = p.getByRole('button', { name: `展开${side}侧面板`, exact: true })
      await p.waitForFunction(side => {
        const b = document.querySelector(`button[aria-label="展开${side}侧面板"]`)
        return b && b.closest('aside').getBoundingClientRect().width <= 1
      }, side)
      const box = await button.boundingBox()
      assert(box && box.height <= 44 && box.width <= 44)
      const asideWidth = await button.evaluate(el => el.closest('aside').getBoundingClientRect().width)
      assert(asideWidth <= 1, `${side}侧收起后仍占据竖栏空间`)
      await button.click()
      await p.waitForFunction(side => document.querySelector(`#${side === '左' ? 'left' : 'right'}-panel-content`).closest('aside').getBoundingClientRect().width >= 200, side)
    }
    assert((await p.locator('.n-tabs-tab').filter({ hasText: /^波形$/ }).getAttribute('class')).includes('n-tabs-tab--active'))
    assert(await p.getByText('常用信号', { exact: true }).isVisible())
    assert((await p.getByRole('button', { name: 'x28/t3', exact: true }).getAttribute('class')).includes('bg-violet-100'))
    assert((await e.innerText()).includes('KEEP_UNDO'))
    await e.click(); await p.keyboard.press('Control+z')
    assert(!(await e.innerText()).includes('KEEP_UNDO'))
  })
  await check('波形去除PC和ALU并保留控制与寄存器', async p => {
    await p.locator('.n-tabs-tab').filter({ hasText: /^波形$/ }).click()
    await p.getByRole('button', { name: /选择信号/ }).click()
    for (const name of ['PC', 'ALU']) assert.equal(await p.getByRole('button', { name, exact: true }).count(), 0, `${name}仍可选`)
    for (const name of ['RegWrite', 'TRAP']) assert(await p.getByRole('button', { name, exact: true }).isVisible())
    await p.getByRole('button', { name: 'x5/t0', exact: true }).click()
    await load(p, 'addi t0,zero,1\nlui t0,0x80000\necall')
    await step(p); await step(p)
    const labels = await p.locator('.n-tab-pane svg text').allTextContents()
    assert(labels.includes('8000…'), '长寄存器值未省略')
  })
  await check('激活框实线、端口闪烁与线路同期', async p => {
    await load(p, 'addi t0, zero, 1\necall'); await step(p)
    const state = await p.evaluate(() => {
      const shape = document.querySelector('g.module.dp-lit > :first-child')
      const port = document.querySelector('.dp-port-active'), wire = document.querySelector('path.dp-lit')
      return { dash: getComputedStyle(shape).strokeDasharray, frameAnimation: getComputedStyle(shape).animationName,
        ports: document.querySelectorAll('.dp-port-active').length,
        duration: port && getComputedStyle(port).animationDuration,
        wireDuration: wire && getComputedStyle(wire).animationDuration }
    })
    assert.equal(state.dash, 'none', '部件边框仍是虚线')
    assert.equal(state.frameAnimation, 'none', '部件边框仍有流动动画')
    assert(state.ports > 0, '没有激活的输入/输出端口')
    assert.equal(state.duration, state.wireDuration)
    // 每个指示点只能由真正激活的连线贡献，不能让整个模块的所有端口闪。
    const mismatch = await p.evaluate(() => {
      const w = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('wave')
      return [...document.querySelectorAll('.dp-port-active')].filter(el => !el.getAttribute('data-wires').split(',').some(id => w.shown.wires.has(id))).length
    })
    assert.equal(mismatch, 0)
    const missing = await p.evaluate(layout => {
      const wave = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('wave')
      const framed = new Set(layout.modules.filter(m => m.shape !== 'text').map(m => m.id))
      const expected = new Set(layout.wires.filter(w => wave.shown.wires.has(w.id)).flatMap(w => [w.from, w.to]))
      const wanted = layout.ports.filter(port => expected.has(port.id) && framed.has(port.module)).map(port => port.id)
      const shown = new Set([...document.querySelectorAll('.dp-port-active')].map(el => el.getAttribute('data-port')))
      return wanted.filter(id => !shown.has(id))
    }, JSON.parse(fs.readFileSync(path.join(root, 'frontend/src/data/datapathLayout.json'), 'utf8')))
    assert.deepEqual(missing, [], '激活端口漏画')
    await p.screenshot({ path: path.join(out, 'active-ports.png') })
    await p.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await p.locator('.dp-port-active').first().evaluate(el => getComputedStyle(el).animationName), 'none')
  })
  await check('离线高亮SVG也显示实际传输端口', async p => {
    const { pathToFileURL } = require('node:url')
    await p.goto(pathToFileURL(path.join(root, 'tools/out/hl-cycle1.svg')).href)
    assert(await p.locator('circle.dp-port-active').count() > 0, '离线导出丢失端口高亮')
  })
  await check('静态参考图不显示未激活的传输端口', async p => {
    const { pathToFileURL } = require('node:url')
    await p.goto(pathToFileURL(path.join(root, 'frontend/datapath_visual_export.svg')).href)
    const port = p.locator('circle.dp-port').first()
    assert.equal(await port.evaluate(el => getComputedStyle(el).opacity), '0', '无样式静态SVG出现未激活指示点')
  })
  await check('停机异常仍能单步播完而不执行下一拍', async p => {
    await load(p, 'ecall')
    await p.getByRole('button', { name: '单步', exact: true }).click()
    await p.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator').isHalted)
    const before = await p.evaluate(() => {
      const stores = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
      return { index: stores.get('wave').index, total: stores.get('wave').total, cycle: stores.get('simulator').cycleCount }
    })
    assert(before.index < before.total, '夹具未停在动画中途')
    assert(!(await p.getByRole('button', { name: '单步', exact: true }).isDisabled()), '停机锁死了未完成动画')
    for (let i = before.index; i < before.total; i++) await p.getByRole('button', { name: '单步', exact: true }).click()
    assert(await p.getByRole('button', { name: '单步', exact: true }).isDisabled())
    assert(await p.getByText(/mtvec=0.*停机/).isVisible(), '停机异常提示错误声称跳转')
    assert.equal(await p.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator').cycleCount), before.cycle)
  })
  await check('异常往返与计时器中断真实执行', async p => {
    await load(p, fs.readFileSync(path.join(root, 'backend/asm_examples/trap_roundtrip.s'), 'utf8'))
    for (let i = 0; i < 40; i++) {
      await step(p)
      if (await p.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator').isHalted)) break
    }
    const end = await p.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator').cycleState)
    assert.equal(end.regfile[10], 2); assert.equal(end.regfile[11], 99); assert(end.trap.taken && end.halted)
    await load(p, fs.readFileSync(path.join(root, 'backend/asm_examples/timer_intr.s'), 'utf8'))
    for (let i = 0; i < 300; i++) {
      await step(p)
      if (await p.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator').isHalted)) break
    }
    const timer = await p.evaluate(() => {
      const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator')
      return { halted: s.isHalted, count: s.cycleState.regfile[28], result: s.cycleState.regfile[11],
        traps: s.stateHistory.filter(h => h.trap.taken && h.trap.cause === 0x80000007).length }
    })
    assert(timer.halted && timer.traps > 0 && timer.count === timer.traps && timer.result === timer.traps, JSON.stringify(timer))
  })
  await check('停机补播再暂停不解除执行保护', async p => {
    await load(p, 'addi t0,zero,7\necall')
    await step(p)
    await p.getByRole('button', { name: '单步', exact: true }).click()
    await p.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator').isHalted)
    await p.getByRole('button', { name: '单条指令', exact: true }).click()
    await p.getByRole('button', { name: '暂停', exact: true }).click()
    const stopped = await p.evaluate(() => {
      const all = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
      const s = all.get('simulator'), w = all.get('wave')
      return { halted: s.isHalted, index: w.index, total: w.total, count: s.stateHistory.length }
    })
    assert(stopped.halted, '暂停解除后端停机保护')
    for (let i = stopped.index; i < stopped.total; i++) await p.getByRole('button', { name: '单步', exact: true }).click()
    assert(await p.getByRole('button', { name: '单步', exact: true }).isDisabled())
    // 保护还应覆盖翻阅历史（只浏览，不回滚后端）。
    await p.getByRole('button', { name: '上一步', exact: true }).click()
    assert(await p.getByRole('button', { name: '单步', exact: true }).isDisabled(), '浏览历史解除停机保护')
    await p.getByRole('button', { name: '下一步', exact: true }).click()
    const kept = await p.evaluate(() => {
      const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator')
      return { count: s.stateHistory.length, pc: s.cycleState.pc, t0: s.cycleState.regfile[5], trap: s.cycleState.trap.taken }
    })
    assert.equal(kept.count, stopped.count); assert.equal(kept.pc, '0x80000004'); assert.equal(kept.t0, 7); assert(kept.trap)
    await p.getByRole('button', { name: '复位', exact: true }).click()
    await p.waitForFunction(() => !document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator').isHalted)
    assert(!(await p.getByRole('button', { name: '单步', exact: true }).isDisabled()))
  })
  for (const [width, height] of [[1920,1080],[1366,768],[1024,768],[768,1024],[390,844],[360,740]]) {
    const { page, context } = await open(width, height)
    const metrics = await page.evaluate(() => ({ bottom: document.querySelector('footer').getBoundingClientRect().bottom,
      mainHeight: document.querySelector('main').getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > innerWidth,
      clipped: [...document.querySelectorAll('header button')].filter(b => { const r = b.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 }).length }))
    assert(Math.abs(metrics.bottom - height) < 2 && metrics.mainHeight > 100 && !metrics.overflow && metrics.clipped === 0, JSON.stringify(metrics))
    await page.screenshot({ path: path.join(out, `${width}x${height}.png`) })
    results.push({ name: `${width}x${height}`, passed: true, metrics })
    await context.close()
  }
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log(JSON.stringify({ results, browserErrors: errors }, null, 2))
}
main().catch(e => { console.error(e); console.error(logs.slice(-1500)); process.exitCode = 1 }).finally(async () => {
  if (browser) await browser.close()
  server.kill()
})
