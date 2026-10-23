// 固定传输字节和时长，独立验证 Mbps 换算、异常及进度反馈。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const ts = require(path.join(root, 'frontend/node_modules/typescript'))
const source = fs.readFileSync(path.join(root, 'frontend/src/utils/networkCheck.ts'), 'utf8')
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022 } }).outputText
let time = 0
let fail = false
const calls = []
const exportsObject = {}
vm.runInNewContext(output, {
  exports: exportsObject,
  performance: { now: () => time },
  crypto: { getRandomValues: data => data.fill(23) },
  fetch: async (url, options) => {
    calls.push({ url, options })
    if (fail) throw Error('连接失败')
    time += 20
    return {
      ok: true, status: 200,
      async json() {
        if (url.includes('upload')) { time += 1000; return { bytes: options.body.byteLength } }
        return { ok: true }
      },
      async arrayBuffer() { time += 1000; return new ArrayBuffer(1048576) },
    }
  },
})
async function main() {
  const stages = []
  const result = await exportsObject.checkNetwork(new AbortController().signal, stage => stages.push(stage))
  assert.equal(result.latencyMs, 20)
  assert(Math.abs(result.downloadMbps - 8.22) < .01, '下载速率换算错误')
  assert(Math.abs(result.uploadMbps - 2.06) < .01, '上传速率换算错误')
  assert.equal(stages.length, 3)
  assert.equal(calls.length, 5)
  assert(calls.every(call => call.options.cache === 'no-store' && call.options.signal))
  fail = true
  await assert.rejects(() => exportsObject.checkNetwork(new AbortController().signal), /连接失败/)
  console.log('通过：网络检测计算、进度和连接失败处理')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
