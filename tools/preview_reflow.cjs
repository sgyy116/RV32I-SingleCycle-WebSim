// 独立预览端口，避免占用稳定版的 8080、8081 和 5173。
const { spawn } = require('node:child_process')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..')
let backend, vite, closing = false
async function close() {
  if (closing) return
  closing = true
  await vite?.close()
  backend?.kill()
}
async function main() {
  backend = spawn('python', ['-u', '-B', 'server.py'], {
    cwd: path.join(root, 'backend/python'), windowsHide: true,
    env: { ...process.env, WS_PORT: '18880', COMPILE_PORT: '18881' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  backend.on('error', e => { console.error(e); close().finally(() => process.exit(1)) })
  backend.stdout.on('data', b => process.stdout.write(b))
  backend.stderr.on('data', b => process.stderr.write(b))
  for (let i = 0; i < 80; i++) {
    if (backend.exitCode !== null) throw Error('预览后端启动失败，请检查 18880/18881 端口。')
    try { if ((await fetch('http://127.0.0.1:18881')).ok) break } catch {}
    if (i === 79) throw Error('预览后端未就绪。')
    await new Promise(r => setTimeout(r, 250))
  }
  const { createServer } = await import(pathToFileURL(path.join(root, 'frontend/node_modules/vite/dist/node/index.js')).href)
  vite = await createServer({
    root: path.join(root, 'frontend'), configFile: path.join(root, 'frontend/vite.config.ts'),
    define: { 'import.meta.env.VITE_WS_URL': JSON.stringify('ws://localhost:18880') },
    server: { host: '127.0.0.1', port: 5175, strictPort: true, proxy: {
      '/api': { target: 'http://127.0.0.1:18881', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:18880', ws: true, changeOrigin: true },
    } },
  })
  await vite.listen()
  console.log('重排试验预览：http://127.0.0.1:5175/  （Ctrl+C 停止）')
}
process.on('SIGINT', () => close().finally(() => process.exit()))
process.on('SIGTERM', () => close().finally(() => process.exit()))
main().catch(e => { console.error(e); close().finally(() => process.exit(1)) })
