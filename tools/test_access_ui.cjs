// 真实页面验证：网络检测、取消与失败反馈、排队退出及自动准入、窄屏布局。
const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const root = path.resolve(__dirname, '..')
const out = path.join(root, 'tools/out/ui-access')
fs.mkdirSync(out, { recursive: true })
const service = spawn('python', ['-B', 'server.py'], {
  cwd: path.join(root, 'backend/python'), windowsHide: true,
  env: { ...process.env, WS_PORT: '25180', COMPILE_PORT: '25181', RV32I_SERVER_MODE: '1',
    RV32I_BIND_HOST: '127.0.0.1', RV32I_MAX_SESSIONS: '1', RV32I_MAX_WAITING: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
service.stdout.on('data', data => { logs += data })
service.stderr.on('data', data => { logs += data })
const errors = []
let browser

async function open(width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto('http://127.0.0.1:25181/', { waitUntil: 'networkidle' })
  return { context, page }
}

async function main() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch('http://127.0.0.1:25181/api/network/ping')).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const a = await open()
  await a.page.getByText('已连接', { exact: true }).waitFor()
  await a.page.getByRole('button', { name: '网络检测', exact: true }).click()
  await a.page.getByRole('button', { name: '开始检测', exact: true }).click()
  await a.page.locator('.network-result dd').first().waitFor()
  assert.equal(await a.page.locator('.network-result dd').count(), 3)
  await a.page.screenshot({ path: path.join(out, 'network-desktop.png') })
  await a.page.setViewportSize({ width: 390, height: 844 })
  const modal = await a.page.locator('.network-dialog').boundingBox()
  assert(modal && modal.x >= 0 && modal.x + modal.width <= 391, '测速弹窗在窄屏溢出')
  await a.page.screenshot({ path: path.join(out, 'network-mobile.png') })
  await a.page.keyboard.press('Escape')
  const b = await open(390)
  await b.page.getByRole('button', { name: '退出排队', exact: true }).waitFor()
  await b.page.getByRole('navigation', { name: '工作区视图' }).getByRole('button', { name: '汇编代码', exact: true }).click()
  assert(await b.page.getByRole('button', { name: /编译.*加载/ }).isDisabled())
  await b.page.screenshot({ path: path.join(out, 'queue-mobile.png') })
  const footer = await b.page.locator('.app-footer').evaluate(el => ({ overflow: el.scrollWidth > el.clientWidth }))
  assert.equal(footer.overflow, false, '排队控件造成底栏横向溢出')
  const c = await open()
  await c.page.getByRole('button', { name: '重新加入', exact: true }).waitFor()
  assert(await c.page.getByText('等待人数已达上限，请稍后重新加入', { exact: true }).count())
  await c.context.close()
  await b.page.getByRole('button', { name: '退出排队', exact: true }).click()
  await b.page.getByRole('button', { name: '重新加入', exact: true }).click()
  await b.page.getByRole('button', { name: '退出排队', exact: true }).waitFor()
  await a.context.close()
  await b.page.getByText('已连接', { exact: true }).waitFor()
  assert(await b.page.getByRole('button', { name: /编译.*加载/ }).isEnabled())
  await b.page.getByRole('button', { name: /编译.*加载/ }).click()
  await b.page.waitForFunction(() => document.querySelector('.footer-status')?.textContent.includes('程序已加载'))
  await b.page.getByRole('button', { name: '网络检测', exact: true }).click()
  await b.page.route('**/api/network/ping', route => route.fulfill({ status: 503, body: 'busy' }))
  await b.page.getByRole('button', { name: '开始检测', exact: true }).click()
  await b.page.getByText('网络检测失败（503）', { exact: true }).waitFor()
  await b.page.unroute('**/api/network/ping')
  await b.page.route('**/api/network/download?*', async route => {
    await new Promise(resolve => setTimeout(resolve, 1000))
    await route.abort().catch(() => {})
  })
  await b.page.getByRole('button', { name: '重新检测', exact: true }).click()
  await b.page.getByText('正在检测下载…', { exact: true }).waitFor()
  await b.page.getByRole('button', { name: '取消检测', exact: true }).click()
  await b.page.getByText('检测已取消', { exact: true }).waitFor()
  await b.context.close()
  assert.deepEqual(errors, [])
  console.log('通过：真实网络检测、取消及错误反馈、队列满员/退出/重入/准入、编译和390px布局；无页面异常')
}
main().catch(error => { console.error(error); console.error(logs.slice(-3000)); process.exitCode = 1 })
  .finally(async () => {
    if (browser) await browser.close()
    await new Promise(resolve => setTimeout(resolve, 200))
    service.kill()
  })
