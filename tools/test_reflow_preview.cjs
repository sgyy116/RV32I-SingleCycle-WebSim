// 专门检查独立预览，避免只有生产构建通过而开发页面缺失工具栏样式。
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const out = path.join(__dirname, 'out/ui-reflow')
fs.mkdirSync(out, { recursive: true })
const errors = [], results = []
let browser
async function main() {
  browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1312, height: 1106 } })
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(process.env.REFLOW_PREVIEW_URL || 'http://127.0.0.1:5175/', { waitUntil: 'networkidle' })
  await page.getByText('已连接', { exact: true }).waitFor()
  // 变异只注入到本测试页，用同一判据确认能抓住校徽尺寸回退。
  if (process.env.REFLOW_HEADER_MUTATION === '1') {
    await page.addStyleTag({ content: '.app-header img { width: 474px !important; height: 474px !important; }' })
  }
  const checkZoomLocation = async () => {
    assert.equal(await page.locator('.app-footer .zoom-bar').count(), 1, '缩放控件未放入底栏')
    assert.equal(await page.locator('.dp-wrap .zoom-bar').count(), 0, '图区仍残留缩放控件')
  }
  for (const [width, height] of [[1312,1106],[1920,1080],[1024,768],[1280,800],[938,800],[774,800],[538,740],[390,740],[360,740]]) {
    await page.setViewportSize({ width, height })
    const m = await page.locator('.app-header').evaluate(el => {
      const logo = el.querySelector('img').getBoundingClientRect()
      const h = el.getBoundingClientRect()
      return { logoWidth: logo.width, logoHeight: logo.height, height: h.height,
        mode: document.querySelector('.workspace-grid').className, display: getComputedStyle(el).display, background: getComputedStyle(el).backgroundColor,
        buttons: [...el.querySelectorAll('button')].map(b => {
          const r = b.getBoundingClientRect(), s = getComputedStyle(b)
          return { width: r.width, height: r.height, display: s.display,
            visible: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= h.top && r.bottom <= h.bottom }
        }) }
    })
    assert.equal(m.logoWidth, 32, '校徽未被限制在 32px，预览可能缺少工具样式')
    assert.equal(m.logoHeight, 32)
    assert.equal(m.display, m.mode.includes('is-wide') ? 'flex' : 'grid', '顶栏布局样式缺失')
    assert.equal(m.background, 'rgb(51, 65, 85)', '顶栏背景样式缺失')
    assert(m.height <= (width <= 600 ? 160 : 120), '顶栏高度异常')
    assert(m.buttons.length >= 8, '顶部控制按钮缺失')
    assert(m.buttons.every(b => b.height === 32 && ['inline-flex', 'flex'].includes(b.display) && b.visible), `按钮样式或操作区域异常 ${JSON.stringify(m.buttons)}`)
    await page.screenshot({ path: path.join(out, `preview-header-${width}.png`) })
    if (width <= 600) {
      const run = await page.getByRole('button', { name: '运行', exact: true }).boundingBox()
      const pause = await page.getByRole('button', { name: '暂停', exact: true }).boundingBox()
      const reset = await page.getByRole('button', { name: '复位', exact: true }).boundingBox()
      const glossary = await page.locator('.header-glossary').boundingBox()
      assert(pause.y >= run.y + run.height && pause.y === reset.y && reset.y === glossary.y, '暂停、复位、词典没有固定在第二行')
      assert.equal(await page.locator('.app-header button svg:visible').count(), 0, '窄屏按钮仍显示图标')
    }
    await checkZoomLocation()
    const z = await page.locator('.zoom-bar').boundingBox()
    const footer = await page.locator('.app-footer').boundingBox()
    assert(z.x >= 0 && z.x + z.width <= width && z.y >= footer.y && z.y + z.height <= footer.y + footer.height, '缩放控件被裁切或脱离底栏')
    const f = await page.locator('.app-footer').evaluate(el => {
      const r = el.getBoundingClientRect()
      return { bottom: r.bottom, overflow: el.scrollWidth > el.clientWidth, summary: el.querySelector('.footer-summary').getBoundingClientRect().top,
        execution: el.querySelector('.footer-execution').getBoundingClientRect().top }
    })
    assert(Math.abs(f.bottom - height) < 1 && !f.overflow, '底栏未贴底或出现横向溢出')
    if (width <= 1200) assert(f.execution > f.summary, '窄屏底栏未分成两行')
    results.push({ name: `${width}x${height} 工具栏分组与统一底栏`, passed: true })
  }
  const checkHeaderLayout = async () => {
    const m = await page.locator('.app-header').evaluate(el => {
      const box = sel => { const r = el.querySelector(sel).getBoundingClientRect(); return { y: r.y, height: r.height, bottom: r.bottom } }
      return { wide: document.querySelector('.workspace-grid').classList.contains('is-wide'), height: el.offsetHeight,
        controls: box('.primary-controls'), speed: box('.header-speed'), history: box('.header-history') }
    })
    if (m.wide) assert.equal(m.height, 56, '三栏布局的顶栏未保持单行')
    else {
      assert(m.speed.y >= m.controls.bottom, '速度条未随工作区模式下移')
      assert(Math.abs(m.speed.y + m.speed.height / 2 - m.history.y - m.history.height / 2) < 1, '速度和历史按钮未同排')
      assert(m.height >= 88 && m.height <= 90, '中等窗口出现额外换行')
    }
  }
  for (const width of [...Array.from({length:44}, (_,i) => 1500-i*20), ...Array.from({length:44}, (_,i) => 640+i*20)]) {
    await page.setViewportSize({ width, height: 800 })
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    await checkHeaderLayout()
  }
  for (const height of [700,900,924,883,882,800]) {
    await page.setViewportSize({ width: 1200, height })
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    await checkHeaderLayout()
  }
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.waitForTimeout(80)
  const headerMutation = await page.addStyleTag({ content: '.header-mode-stacked .header-speed { grid-row: 1 !important; }' })
  await assert.rejects(checkHeaderLayout, /速度条未随工作区模式下移/)
  await headerMutation.evaluate(el => el.remove())
  await page.waitForTimeout(80)
  await checkHeaderLayout()
  results.push({ name: '速度和历史按钮跟随工作区模式同步换行，连续往返无中间状态', passed: true })

  await page.setViewportSize({ width: 1500, height: 800 })
  await page.waitForTimeout(80)
  await page.locator('.lg-toggle[title="收起图例"]').waitFor()
  await page.setViewportSize({ width: 1300, height: 800 })
  await page.locator('.lg-toggle[title="展开图例"]').waitFor()
  assert.equal(await page.locator('.legend-content').isVisible(), false, '图例不足两行宽度时没有自动收起')
  await page.locator('.lg-toggle[title="展开图例"]').click()
  const checkLegendRows = async () => {
    const rows = await page.locator('.lg-row').evaluateAll(els => els.map(el => [...el.children].map(child => child.getBoundingClientRect().top)))
    assert.equal(rows.length, 2)
    assert(rows.every(tops => tops.length > 0 && Math.max(...tops)-Math.min(...tops) < 2), '图例内容发生额外换行')
  }
  await checkLegendRows()
  const legendMutation = await page.addStyleTag({ content: '.legend .lg-row { width: 300px !important; flex-wrap: wrap !important; }' })
  await assert.rejects(checkLegendRows, /图例内容发生额外换行/)
  await legendMutation.evaluate(el => el.remove())
  await checkLegendRows()
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.locator('.lg-toggle[title="展开图例"]').waitFor()
  results.push({ name: '图例按图区宽度自动收起，手动展开不额外换行', passed: true })
  const checkUnique = async () => {
    assert.equal(await page.locator('.status-pill').count(), 0, '图区存在重复执行状态')
    assert.equal(await page.locator('.footer-cycle').count(), 1, '周期信息必须只显示一次')
    assert.equal(await page.locator('.footer-pc').count(), 1)
    assert.equal(await page.locator('.footer-instruction').count(), 1)
  }
  await checkUnique()
  // 注入重复状态条，用同一判据验证去重检查确实有效；随后删除临时节点。
  await page.evaluate(() => { const el = document.createElement('div'); el.className = 'status-pill'; document.querySelector('.dp-wrap').append(el) })
  await assert.rejects(checkUnique, /图区存在重复执行状态/)
  await page.locator('.status-pill').evaluate(el => el.remove())
  await checkUnique()
  // 把实际缩放控件临时移回图区，确认位置检查会失败；随后按原 DOM 位置恢复。
  await page.evaluate(() => {
    const bar = document.querySelector('.zoom-bar')
    window.__zoomParent = bar.parentNode; window.__zoomNext = bar.nextSibling
    document.querySelector('.dp-wrap').append(bar)
  })
  await assert.rejects(checkZoomLocation, /缩放控件未放入底栏/)
  await page.evaluate(() => window.__zoomParent.insertBefore(document.querySelector('.zoom-bar'), window.__zoomNext))
  await checkZoomLocation()
  const initialView = await page.locator('.dp-svg').getAttribute('viewBox')
  await page.locator('.zoom-bar [role="slider"]').focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => document.querySelector('.zoom-value').textContent.trim() === '1.25×')
  assert.notEqual(await page.locator('.dp-svg').getAttribute('viewBox'), initialView, '底栏缩放没有更新图形')
  await page.getByRole('button', { name: '1:1', exact: true }).click()
  assert.equal(await page.locator('.dp-svg').getAttribute('viewBox'), initialView, '底栏 1:1 未恢复原视角')
  assert.equal(await page.locator('.footer-connection').getAttribute('title'), 'ws://localhost:18880')
  await page.setViewportSize({ width: 360, height: 740 })
  await page.locator('.header-glossary').click()
  await page.getByRole('button', { name: '关闭（ESC）', exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭（ESC）', exact: true }).click()
  await page.evaluate(async () => {
    const sim = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator')
    if (!await sim.compileAndLoad('addi a0,zero,5\naddi a1,a0,7\necall')) throw Error('真实编译失败')
  })
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator').disassembly.length > 0)
  await page.getByRole('button', { name: '单条指令', exact: true }).click()
  await page.waitForFunction(() => {
    const stores = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
    return stores.get('simulator').stateHistory.length === 1 && !stores.get('wave').playing
  })
  assert.equal(await page.locator('.footer-instruction').innerText(), 'addi a0, zero, 5')
  assert((await page.locator('.footer-wave').innerText()).includes('波'), '波次信息迁移后丢失')
  await page.setViewportSize({ width: 774, height: 800 })
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  const loadedFooter = await page.locator('.app-footer').evaluate(el => ({ height: el.getBoundingClientRect().height,
    execution: el.querySelector('.footer-execution').getBoundingClientRect().top,
    wave: el.querySelector('.footer-wave').getBoundingClientRect().top }))
  assert(loadedFooter.height <= 72 && Math.abs(loadedFooter.execution - loadedFooter.wave) < 2, '波次被挤到第三行')
  await page.screenshot({ path: path.join(out, 'footer-loaded-774.png') })
  await page.getByRole('button', { name: '复位', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulator').stateHistory.length === 0)
  results.push({ name: '工具栏词典、真实单条执行与复位可点击', passed: true })
  assert.equal(errors.length, 0)
}
main().catch(e => { results.push({ name: '预览回归', passed: false, error: e.message }); process.exitCode = 1 }).finally(async () => {
  await browser?.close()
  fs.writeFileSync(path.join(out, 'preview-results.json'), JSON.stringify({ results, errors }, null, 2))
  console.log(JSON.stringify({ results, errors }, null, 2))
})
