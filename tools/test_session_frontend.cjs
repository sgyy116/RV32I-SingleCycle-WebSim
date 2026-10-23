// 使用真实 Vue/Pinia 状态管理，仅替换网络边界，验证断线和重连状态。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const ts = require(path.join(root, 'frontend/node_modules/typescript'))
const vue = require(path.join(root, 'frontend/node_modules/vue'))
const pinia = require(path.join(root, 'frontend/node_modules/pinia'))
let callbacks
let closed = 0
let reconnects = 0
const source = fs.readFileSync(path.join(root, 'frontend/src/stores/simulator.ts'), 'utf8')
  .replace('import.meta.env.VITE_WS_URL', 'undefined')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exportsObject = {}
vm.runInNewContext(compiled, {
  exports: exportsObject,
  location: { protocol: 'http:', host: 'localhost' },
  require(name) {
    if (name === 'vue') return vue
    if (name === 'pinia') return pinia
    if (name === '@/composables/useWebSocket') return {
      useWebSocket(options) { callbacks = options; return {
        send: () => true, close: () => closed++, reconnect: () => reconnects++,
      } },
    }
    throw Error(`未知依赖 ${name}`)
  },
})
pinia.setActivePinia(pinia.createPinia())
const store = exportsObject.useSimulatorStore()
callbacks.onOpen()
callbacks.onMessage({ type: 'ready', version: '1.0', session_id: 'a'.repeat(32) })
callbacks.onMessage({ type: 'loaded', entry: '0x80000000' })
callbacks.onMessage({ type: 'cycle_state', state: { cycle: 3, halted: true, regfile: [] } })
callbacks.onMessage({ type: 'memory_dump', addr: '0x80000000', bytes: [17] })
store.toggleBreakpoint('0x80000004')
callbacks.onClose()
assert.equal(store.cycleState, null, '断线必须清除旧周期状态')
assert.equal(store.stateHistory.length, 0)
assert.equal(store.memoryDump, null)
assert.equal(store.breakpoints.size, 0)
assert.equal(store.disassembly.length, 0)
assert.equal(store.isHalted, false, '旧会话停机状态不能阻止新会话执行')
callbacks.onOpen()
callbacks.onMessage({ type: 'ready', version: '1.0', session_id: 'b'.repeat(32) })
assert.equal(store.sessionId, 'b'.repeat(32))
assert.equal(store.compileStatus, 'idle')
assert.equal(store.statusText, '程序未加载')
console.log('通过：断线清理与新会话初始化')

async function queueRegression() {
callbacks.onClose()
callbacks.onOpen()
assert.equal(store.connected, false, '握手完成不代表已获实验名额')
callbacks.onMessage({ type: 'queued', position: 3, active: 1, capacity: 1 })
assert.equal(store.admission, 'queued')
assert.equal(store.queuePosition, 3)
assert.equal(store.compiling, false)
assert.equal(await store.compileAndLoad('nop'), false, '排队期间不能提交源码')
store.leaveQueue()
assert.equal(store.admission, 'cancelled')
assert.equal(closed, 1)
store.joinQueue()
assert.equal(reconnects, 1)
callbacks.onMessage({ type: 'queue_full', message: '等待人数已达上限' })
assert.equal(store.admission, 'full')
assert.equal(closed, 2, '满队列不能自动重连形成请求风暴')
callbacks.onMessage({ type: 'ready', version: '1.0', session_id: 'c'.repeat(32) })
assert.equal(store.connected, true)
assert.equal(store.admission, 'ready')
assert.equal(store.queuePosition, 0)
console.log('通过：排队、取消、重试及准入状态')
}
queueRegression().catch(error => { console.error(error); process.exitCode = 1 })
