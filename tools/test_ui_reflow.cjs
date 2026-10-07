// 重排回归：真实 Edge、中间层和核心；断点往返、几何和状态保留分别核对。
const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = process.env.REFLOW_ROOT || path.resolve(__dirname, '..')
const out = path.join(path.resolve(__dirname, '..'), 'tools/out/ui-reflow')
fs.mkdirSync(out, { recursive: true })
const server = spawn('python', ['-B', 'server.py'], {
  cwd: path.join(root, 'backend/python'), windowsHide: true,
  env: { ...process.env, WS_PORT: '19080', COMPILE_PORT: '19081', TEMP: out, TMP: out },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = '', browser
server.stdout.on('data', b => { logs += b })
server.stderr.on('data', b => { logs += b })
const results = [], errors = []
async function open(width = 1600, height = 900) {
  const context = await browser.newContext({ viewport: { width, height } })
  await context.addInitScript(() => {
    const Native = window.WebSocket
    window.WebSocket = class extends Native {
      constructor(url, protocols) { super(String(url).replace(':8080', ':19080'), protocols) }
    }
  })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('http://localhost:19081', { waitUntil: 'networkidle' })
  await page.getByText('后端已连接', { exact: true }).waitFor()
  return { page, context }
}
async function check(name, fn) {
  const { page, context } = await open()
  try { await fn(page); results.push({ name, passed: true }) }
  catch (e) { results.push({ name, passed: false, error: e.message }); process.exitCode = 1 }
  finally { await context.close() }
}
async function resize(p, width, height, mode) {
  await p.setViewportSize({ width, height })
  await p.waitForFunction(mode => document.querySelector('.workspace-grid')?.classList.contains(`is-${mode}`), mode, { timeout: 3000 })
  await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
async function geometry(p) {
  return p.evaluate(() => {
    const box = sel => {
      const r = document.querySelector(sel).getBoundingClientRect()
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    return { graph: box('#workspace-datapath'), editor: box('#workspace-editor'), state: box('#workspace-state'),
      footer: box('.app-footer'), overflow: document.documentElement.scrollWidth > innerWidth,
      clipped: [...document.querySelectorAll('.app-header button')].filter(b => b.getBoundingClientRect().right > innerWidth + 1).length }
  })
}
function stacked(m) {
  assert(m.graph.bottom <= m.editor.y + 1 && m.graph.bottom <= m.state.y + 1, '数据通路没有位于面板上方')
  assert(Math.abs(m.editor.y - m.state.y) < 1, '下方面板未对齐')
  assert(m.editor.right <= m.state.x + 1, '下方面板重叠')
  assert(m.graph.height >= 299 && m.editor.height >= 299 && m.state.height >= 299, '工作区高度不足')
}
async function main() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch('http://localhost:19081')).ok) break } catch {}
    if (server.exitCode !== null || i === 79) throw Error(logs || '服务启动失败')
    await new Promise(r => setTimeout(r, 250))
  }
  browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
  await check('临界宽度往返有缓冲且可直接跨越多个布局', async p => {
    for (const [w, mode] of [[1360,'wide'],[1320,'wide'],[1319,'stacked'],[1330,'stacked'],[1370,'stacked'],[1399,'stacked'],[1400,'wide'],[800,'stacked'],[759,'single'],[770,'single'],[839,'single'],[840,'stacked'],[360,'single'],[1920,'wide']]) {
      await resize(p, w, 900, mode)
    }
  })
  if (process.argv.includes('--probe')) return
  await check('不同宽高比按实际空间重排且底栏贴底', async p => {
    for (const [w,h,mode] of [[1680,720,'wide'],[1440,810,'wide'],[1200,900,'stacked'],[1024,768,'stacked'],[900,500,'stacked'],[720,1280,'single'],[360,740,'single']]) {
      await resize(p, w, h, mode)
      const m = await geometry(p)
      assert(!m.overflow && m.clipped === 0, `窗口 ${w}x${h} 出现横向溢出或按钮裁切`)
      assert(Math.abs(m.footer.bottom - h) < 1, '底栏未贴底')
      if (mode === 'stacked') stacked(m)
      if (mode === 'single') {
        assert(await p.locator('#workspace-datapath').isVisible())
        assert(!(await p.locator('#workspace-editor').isVisible()))
        assert(await p.locator('#workspace-editor .cm-content').evaluate(e => e.getBoundingClientRect().width > 0), '隐藏编辑器失去测量宽度')
      }
      await p.screenshot({ path: path.join(out, `${w}x${h}.png`) })
    }
    // 给真实页面注入错误布局，验证上述几何判据能捕获上下重排失效。
    await resize(p, 1200, 900, 'stacked')
    const mutation = await p.addStyleTag({ content: '.is-stacked > .workspace-editor { grid-row: 1 !important; }' })
    const broken = await geometry(p)
    assert.throws(() => stacked(broken), '几何检查未捕获重排变异')
    await mutation.evaluate(e => e.remove())
    stacked(await geometry(p))
  })
  await check('连续拖动与浏览器缩放对应有效宽度不改变图形视角', async p => {
    const slider = p.locator('.zoom-bar [role="slider"]')
    await slider.focus()
    for (let i = 0; i < 5; i++) await p.keyboard.press('ArrowRight')
    const view = await p.locator('.dp-svg').getAttribute('viewBox')
    let changes = 0, last = 'wide'
    for (const width of [...Array.from({ length: 32 }, (_,i) => 1600-i*40), ...Array.from({ length: 32 }, (_,i) => 360+i*40),1600]) {
      await p.setViewportSize({ width, height: 900 })
      await p.waitForTimeout(30)
      const mode = await p.locator('.workspace-grid').evaluate(e => ['wide','stacked','single'].find(m => e.classList.contains(`is-${m}`)))
      if (mode !== last) { changes++; last = mode }
      assert.equal(await p.locator('.dp-svg').getAttribute('viewBox'), view, '窗口拖动重置了手动缩放')
    }
    assert.equal(changes, 4, '连续往返发生多余布局切换')
    // 相当于 1920px 窗口在 100%、125%、150%、200% 下的有效 CSS 视口。
    for (const width of [1920,1536,1280,960,1920]) {
      await p.setViewportSize({ width, height: 900 })
      await p.waitForTimeout(50)
      assert(!(await geometry(p)).overflow)
      assert.equal(await p.locator('.dp-svg').getAttribute('viewBox'), view)
    }
  })
  await check('编辑内容撤销与面板选择在重排后保留', async p => {
    const editor = p.locator('.cm-content')
    const before = await editor.innerText()
    await editor.press('Control+End')
    await p.keyboard.type('\naddi x5, x0, 13')
    const edited = await editor.innerText()
    await editor.evaluate(e => { window.__reflowEditor = e })
    await p.locator('#right-panel-content .n-tabs-tab').filter({ hasText: /^寄存器$/ }).click()
    await editor.focus()
    await resize(p, 360, 740, 'single')
    assert(await p.locator('#workspace-editor').isVisible(), '编辑中拖窄窗口未继续显示编辑区')
    assert.equal(await editor.innerText(), edited)
    assert(await editor.evaluate(e => e === window.__reflowEditor), '编辑器被重建')
    await p.getByRole('button', { name: '运行状态', exact: true }).click()
    assert(await p.locator('#workspace-state').isVisible())
    assert((await p.locator('#right-panel-content .n-tabs-tab').filter({ hasText: /^寄存器$/ }).getAttribute('class')).includes('n-tabs-tab--active'))
    await p.getByRole('button', { name: '汇编代码', exact: true }).click()
    await editor.press('Control+z')
    assert.equal(await editor.innerText(), before, '编辑撤销记录丢失')
    await resize(p, 1200, 900, 'stacked')
    assert(await editor.evaluate(e => e === window.__reflowEditor))
    await resize(p, 1600, 900, 'wide')
  })
  await check('重排不改变真实仿真快照或触发 Edge 原生拖放', async p => {
    await p.evaluate(async () => {
      const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator')
      if (!await s.compileAndLoad('addi a0,zero,5\naddi a1,a0,7\necall')) throw Error('编译失败')
    })
    await p.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator').disassembly.length > 0)
    for (let i = 1; i <= 2; i++) {
      await p.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator').step())
      await p.waitForFunction(i => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator').stateHistory.length === i, i)
    }
    const snapshot = () => p.evaluate(() => JSON.stringify(document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator').cycleState))
    const before = await snapshot()
    assert.equal(JSON.parse(before).regfile[10], 5)
    assert.equal(JSON.parse(before).regfile[11], 12)
    for (const [width,mode] of [[1200,'stacked'],[360,'single'],[1600,'wide']]) { await resize(p,width,900,mode); assert.equal(await snapshot(),before) }
    const svg = p.locator('.dp-svg')
    assert(await svg.evaluate(e => !e.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }))))
    assert.equal(await p.locator('.dp-svg text').first().evaluate(e => getComputedStyle(e).userSelect), 'none')
  })
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  await browser?.close()
  server.kill()
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2))
  console.log(JSON.stringify({ results, errors }, null, 2))
  if (errors.length) process.exitCode = 1
})
