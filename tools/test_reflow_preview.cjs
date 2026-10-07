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
  await page.getByText('后端已连接', { exact: true }).waitFor()
  // 变异只注入到本测试页，用同一判据确认能抓住校徽尺寸回退。
  if (process.env.REFLOW_HEADER_MUTATION === '1') {
    await page.addStyleTag({ content: '.app-header img { width: 474px !important; height: 474px !important; }' })
  }
  for (const [width, height] of [[1312,1106],[1920,1080],[1024,768],[360,740]]) {
    await page.setViewportSize({ width, height })
    const m = await page.locator('.app-header').evaluate(el => {
      const logo = el.querySelector('img').getBoundingClientRect()
      const h = el.getBoundingClientRect()
      return { logoWidth: logo.width, logoHeight: logo.height, height: h.height,
        display: getComputedStyle(el).display, background: getComputedStyle(el).backgroundColor,
        buttons: [...el.querySelectorAll('button')].map(b => {
          const r = b.getBoundingClientRect(), s = getComputedStyle(b)
          return { width: r.width, height: r.height, display: s.display,
            visible: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= h.top && r.bottom <= h.bottom }
        }) }
    })
    assert.equal(m.logoWidth, 32, '校徽未被限制在 32px，预览可能缺少工具样式')
    assert.equal(m.logoHeight, 32)
    assert.equal(m.display, 'flex', '顶栏布局样式缺失')
    assert.equal(m.background, 'rgb(51, 65, 85)', '顶栏背景样式缺失')
    assert(m.height <= (width <= 480 ? 200 : 120), '顶栏高度异常')
    assert(m.buttons.length >= 8, '顶部控制按钮缺失')
    assert(m.buttons.every(b => b.height === 32 && ['inline-flex', 'flex'].includes(b.display) && b.visible), `按钮样式或操作区域异常 ${JSON.stringify(m.buttons)}`)
    await page.screenshot({ path: path.join(out, `preview-header-${width}.png`) })
    results.push({ name: `${width}x${height} 工具栏样式`, passed: true })
  }
  await page.setViewportSize({ width: 1312, height: 1106 })
  await page.locator('.app-header > button').click()
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
