// ============================================================================
// simulator.ts —— 仿真核心状态（Pinia）
//
// 管理: WebSocket 连接、编译加载、step/run/pause/reset、断点、历史快照
// ============================================================================

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWebSocket } from '@/composables/useWebSocket'
import type { CycleSnapshot, DisassemblyEntry, SimStatus, WsMessage } from '@/types/simulation'

// 默认直连后端 WebSocket（ws://hostname:8080）；也可通过 VITE_WS_URL 覆盖
const WS_URL =
  (import.meta.env.VITE_WS_URL as string) || `ws://${location.hostname}:8080`
const COMPILE_URL = '/api/compile'

export const useSimulatorStore = defineStore('simulator', () => {
  // ---------------- 连接状态 ----------------
  const connected = ref(false)
  const status = ref<SimStatus>('idle')
  const statusText = ref('未连接')

  // ---------------- 仿真数据 ----------------
  const cycleState = ref<CycleSnapshot | null>(null)
  const cycleCount = ref(0)
  const stateHistory = ref<CycleSnapshot[]>([])
  const historyIndex = ref(-1)
  const breakpoints = ref<Set<string>>(new Set())
  const disassembly = ref<DisassemblyEntry[]>([])
  const programEntry = ref('0x80000000')
  const programLoaded = ref(false)
  // 程序已终止（halted）：不受历史回退/暂停状态影响，用于禁用「下一步」
  const programHalted = ref(false)
  const errorMessage = ref('')
  const runSpeed = ref(3) // 每秒步数

  // ---------------- 编译 ----------------
  const compiling = ref(false)
  const compileStatus = ref<'idle' | 'compiling' | 'success' | 'error'>('idle')
  const compileErrors = ref<string[]>([])

  // ---------------- 内存转储 ----------------
  const memoryDump = ref<{ addr: string; bytes: number[] } | null>(null)

  function fetchMemory(addr = '0x80000000', count = 32) {
    ws.send({ type: 'get_memory', addr, count })
  }

  // ---------------- WebSocket ----------------
  const ws = useWebSocket({
    url: WS_URL,
    onMessage: handleMessage,
    onOpen: () => {
      connected.value = true
      statusText.value = '已连接'
    },
    onClose: () => {
      connected.value = false
      statusText.value = '连接断开，正在重连…'
    },
  })

  let runTimer: number | null = null

  // ---------------- 消息处理 ----------------
  function handleMessage(msg: WsMessage) {
    switch (msg.type) {
      case 'ready':
        connected.value = true
        statusText.value = `已连接 (v${msg.version})`
        break
      case 'cycle_state':
        pushState({ ...msg.state, cycle: msg.cycle })
        break
      case 'halted': {
        status.value = 'halted'
        statusText.value = `程序停机 (exit=${msg.exit_code ?? 0})`
        stopRunTimer()
        break
      }
      case 'breakpoint_hit':
        status.value = 'paused'
        statusText.value = `断点命中 ${msg.addr}`
        stopRunTimer()
        break
      case 'paused':
        status.value = 'paused'
        statusText.value = '已暂停'
        stopRunTimer()
        break
      case 'loaded':
        status.value = 'idle'
        statusText.value = `程序已加载 entry=${msg.entry}`
        programEntry.value = msg.entry ?? '0x80000000'
        programLoaded.value = true
        programHalted.value = false
        // 拉取反汇编列表
        ws.send({ type: 'get_disassembly', addr: programEntry.value, count: 256 })
        break
      case 'error':
        status.value = 'error'
        statusText.value = '错误'
        errorMessage.value = msg.message ?? ''
        stopRunTimer()
        break
      case 'reset_done':
        status.value = 'idle'
        statusText.value = '已复位'
        break
      case 'disassembly':
        if (Array.isArray(msg.instructions)) {
          disassembly.value = msg.instructions
        }
        break
      case 'memory_dump':
        memoryDump.value = { addr: msg.addr ?? '0x80000000', bytes: msg.bytes ?? [] }
        break
    }
  }

  // ---------------- 历史快照 ----------------
  function pushState(state: CycleSnapshot) {
    cycleState.value = state
    cycleCount.value = state.cycle
    programHalted.value = !!state.halted
    // 丢弃当前索引之后的历史（当用户在历史中又执行了新步骤）
    stateHistory.value = stateHistory.value.slice(0, historyIndex.value + 1)
    stateHistory.value.push(state)
    historyIndex.value = stateHistory.value.length - 1
  }

  function goBack() {
    if (historyIndex.value > 0) {
      historyIndex.value--
      cycleState.value = stateHistory.value[historyIndex.value]
      status.value = 'paused'
    }
  }

  function goForward() {
    if (historyIndex.value < stateHistory.value.length - 1) {
      historyIndex.value++
      cycleState.value = stateHistory.value[historyIndex.value]
    }
  }

  // ---------------- 编译 + 加载 ----------------
  async function compileAndLoad(source: string) {
    compiling.value = true
    compileStatus.value = 'compiling'
    compileErrors.value = []
    statusText.value = '正在编译…'
    try {
      const resp = await fetch(COMPILE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      })
      const data = await resp.json()
      if (!data.success) {
        compileStatus.value = 'error'
        compileErrors.value = data.errors ?? ['编译失败']
        status.value = 'error'
        statusText.value = '编译失败'
        return false
      }
      compileStatus.value = 'success'
      // 通过 WebSocket 加载到模拟器
      const sent = ws.send({ type: 'load_elf', path: data.elf_path })
      if (!sent) {
        status.value = 'error'
        statusText.value = 'WebSocket 未连接'
        return false
      }
      return true
    } catch (e) {
      compileStatus.value = 'error'
      compileErrors.value = [String(e)]
      status.value = 'error'
      statusText.value = '编译请求失败'
      return false
    } finally {
      compiling.value = false
    }
  }

  // 用后端返回的 ELF 路径加载后拉取反汇编
  async function fetchDisassembly(count = 200) {
    const sent = ws.send({ type: 'get_disassembly', addr: programEntry.value, count })
    return sent
  }

  // ---------------- 步进 / 运行 ----------------
  function step() {
    stopRunTimer()
    ws.send({ type: 'step' })
    status.value = 'running'
  }

  function run() {
    status.value = 'running'
    statusText.value = '运行中…'
    if (runTimer) stopRunTimer()
    runTimer = window.setInterval(() => {
      if (status.value === 'halted' || status.value === 'error') {
        stopRunTimer()
        return
      }
      ws.send({ type: 'step' })
    }, Math.max(20, 1000 / runSpeed.value))
  }

  function pause() {
    ws.send({ type: 'pause' })
    status.value = 'paused'
    statusText.value = '已暂停'
    stopRunTimer()
  }

  function stopRunTimer() {
    if (runTimer) {
      window.clearInterval(runTimer)
      runTimer = null
    }
  }

  function reset() {
    stopRunTimer()
    stateHistory.value = []
    historyIndex.value = -1
    cycleState.value = null
    cycleCount.value = 0
    programHalted.value = false
    ws.send({ type: 'reset' })
    status.value = 'idle'
    statusText.value = '已复位'
  }

  // ---------------- 断点 ----------------
  function toggleBreakpoint(addr: string) {
    const a = addr.toLowerCase()
    if (breakpoints.value.has(a)) {
      breakpoints.value.delete(a)
      ws.send({ type: 'clear_breakpoint', addr: a })
    } else {
      breakpoints.value.add(a)
      ws.send({ type: 'set_breakpoint', addr: a })
    }
    breakpoints.value = new Set(breakpoints.value)
  }

  // ---------------- 派生状态 ----------------
  const isHalted = computed(() => status.value === 'halted')
  const isRunning = computed(() => status.value === 'running')

  return {
    connected,
    status,
    statusText,
    programLoaded,
    programHalted,
    cycleState,
    cycleCount,
    stateHistory,
    historyIndex,
    breakpoints,
    disassembly,
    programEntry,
    errorMessage,
    runSpeed,
    compiling,
    compileStatus,
    compileErrors,
    memoryDump,
    isHalted,
    isRunning,
    compileAndLoad,
    fetchDisassembly,
    fetchMemory,
    step,
    run,
    pause,
    reset,
    goBack,
    goForward,
    toggleBreakpoint,
  }
})
