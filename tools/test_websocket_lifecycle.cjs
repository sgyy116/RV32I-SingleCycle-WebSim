// 固定时钟和网络事件，复现连接未关闭就重试、旧连接回调及握手超时。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const ts = require(path.join(root, 'frontend/node_modules/typescript'))
const vue = require(path.join(root, 'frontend/node_modules/vue'))
const source = fs.readFileSync(path.join(root, 'frontend/src/composables/useWebSocket.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText

function setup() {
  const sockets = [], timers = new Map(), events = []
  let nextId = 0
  class Socket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    readyState = Socket.CONNECTING
    constructor() { sockets.push(this) }
    close() { this.readyState = Socket.CLOSED; this.onclose?.() }
    open() { this.readyState = Socket.OPEN; this.onopen?.() }
    send() {}
  }
  const result = {}
  vm.runInNewContext(compiled, {
    exports: result, console, WebSocket: Socket,
    Math: { min: Math.min, random: () => 0 },
    require: name => { assert.equal(name, 'vue'); return vue },
    window: {
      setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, delay }); return id },
      clearTimeout: id => timers.delete(id),
    },
  })
  const api = result.useWebSocket({ url: 'ws://test', onMessage: msg => events.push(msg),
    onOpen: () => events.push('open'), onClose: () => events.push('close') })
  function tick(delay) {
    const entry = [...timers].find(([, timer]) => timer.delay === delay)
    assert(entry, `没有找到 ${delay}ms 定时器`)
    timers.delete(entry[0]); entry[1].callback()
  }
  return { api, sockets, timers, events, tick }
}

{
  const { api, sockets } = setup()
  sockets[0].onerror()
  api.reconnect()
  assert.equal(sockets.length, 1, '错误事件后，未关闭的连接不能被重复创建')
  api.close()
}
{
  const { api, sockets, tick, events } = setup()
  const obsoleteClose = sockets[0].onclose
  const obsoleteMessage = sockets[0].onmessage
  sockets[0].close()
  tick(1500)
  sockets[1].open()
  const count = events.length
  obsoleteClose()
  obsoleteMessage({ data: '{"type":"ready","session_id":"obsolete"}' })
  assert.equal(api.connected.value, true, '旧连接关闭事件不能清除新连接状态')
  assert.equal(events.length, count, '旧连接消息不能进入新实验')
  api.close()
}
{
  const { api, sockets, tick, timers } = setup()
  sockets[0].close(); tick(1500)
  sockets[1].close(); tick(3000)
  sockets[2].open(); sockets[2].close(); tick(1500)
  api.close()
  assert.equal(timers.size, 0, '退出必须清除握手与重连定时器')
}
{
  const { api, sockets, tick } = setup()
  tick(10000)
  assert.equal(sockets[0].readyState, 3, '握手超时必须关闭连接')
  tick(1500)
  assert.equal(sockets.length, 2)
  api.close()
}
console.log('通过：防重复连接、旧回调隔离、退避重连、握手超时与退出清理')
