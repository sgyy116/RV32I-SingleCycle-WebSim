// ============================================================================
// useWebSocket.ts —— WebSocket 连接管理（自动重连 + JSON 消息分发）
//
// 注意：此组合式函数在 Pinia store 的 setup 中调用（无组件实例），
// 因此不注册 onUnmounted，连接生命周期跟随 store 存活。
// ============================================================================

import { ref } from 'vue'

export interface UseWebSocketOptions {
  url: string
  onMessage: (msg: any) => void
  onOpen?: () => void
  onClose?: () => void
}

export function useWebSocket(options: UseWebSocketOptions) {
  const connected = ref(false)
  const connecting = ref(false)
  let ws: WebSocket | null = null
  let reconnectTimer: number | null = null
  let shouldReconnect = true
  let handshakeTimer: number | null = null
  let reconnectAttempts = 0

  function clearHandshake() {
    if (handshakeTimer !== null) window.clearTimeout(handshakeTimer)
    handshakeTimer = null
  }

  function detach(socket: WebSocket) {
    socket.onclose = null
    socket.onmessage = null
    socket.onopen = null
    socket.onerror = null
  }

  function connect() {
    if (connecting.value || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return
    if (ws) { detach(ws); ws.close(); ws = null }
    connecting.value = true
    let socket: WebSocket
    try {
      socket = new WebSocket(options.url)
      ws = socket
    } catch (e) {
      connecting.value = false
      scheduleReconnect()
      return
    }

    socket.onopen = () => {
      if (ws !== socket) return
      clearHandshake()
      reconnectAttempts = 0
      connected.value = true
      connecting.value = false
      options.onOpen?.()
    }

    socket.onmessage = (ev) => {
      if (ws !== socket) return
      try {
        const msg = JSON.parse(ev.data as string)
        options.onMessage(msg)
      } catch (e) {
        console.warn('[WS] 消息解析失败:', ev.data, e)
      }
    }

    socket.onclose = () => {
      if (ws !== socket) return
      clearHandshake()
      ws = null
      connected.value = false
      connecting.value = false
      options.onClose?.()
      scheduleReconnect()
    }

    socket.onerror = () => {
      if (ws !== socket) return
      connected.value = false
      // 浏览器随后发送 close；保持握手标记，避免重试创建第二条连接。
    }
    handshakeTimer = window.setTimeout(() => {
      handshakeTimer = null
      if (ws === socket && socket.readyState === WebSocket.CONNECTING) socket.close()
    }, 10000)
  }

  function scheduleReconnect() {
    if (!shouldReconnect) return
    if (reconnectTimer !== null) return
    // 连续失败逐步退避并加入抖动，减少全班网络恢复时的同时重连。
    const base = Math.min(30000, 1500 * 2 ** Math.min(reconnectAttempts++, 5))
    const delay = Math.min(30000, base * (1 + Math.random() * 0.2))
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function send(payload: unknown) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload))
      return true
    }
    return false
  }

  function close() {
    shouldReconnect = false
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
    reconnectTimer = null
    clearHandshake()
    if (ws) {
      detach(ws)
      ws.close()
      ws = null
    }
    connected.value = false
    connecting.value = false
  }

  function reconnect() {
    shouldReconnect = true
    reconnectAttempts = 0
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
    reconnectTimer = null
    connect()
  }

  connect()

  return { connected, connecting, send, close, reconnect }
}
